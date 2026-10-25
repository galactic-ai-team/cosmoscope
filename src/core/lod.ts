// src/core/lod.ts
// LOD distance-basis resolution, tier selection with hysteresis, and
// crossfade weight. Consumed by LayerRegistry (layers.ts), which hands a
// LodState to ScaleLayer.update() as an optional 4th argument.
//
// Design: ONE distance basis per layer, never per tier. Tier 0 cannot use a
// different anchor than tier 1 — that would make tier selection depend on
// itself (tier → anchor → distance → tier), and it oscillates at boundaries.
// If a layer wants "near camera objects while far from Sun", it sets basis
// 'nearer', which takes Math.min(anchorDistance, focusDistance) every frame.

import type { FrameApi, FramedPoint } from './camera';

/** How a layer measures distance for tier selection. One basis per layer. */
export type DistanceBasis = 'anchor' | 'focus' | 'nearer';

export interface LodTier {
  /**
   * Max distance (metres) at which this tier is eligible to draw. The last
   * tier may use Infinity for an always-eligible tier (drawn at crossfade 1,
   * never fades out).
   */
  maxDistance: number;
  /** Relative budget desire for this tier (0..1). Normalized across layers. */
  budgetFrac: number;
  /**
   * Ratio of maxDistance over which to fade in. Default 0.15.
   * See computeCrossfade for the paired-tier weight contract.
   */
  crossfadeRatio?: number;
}

/**
 * Read-only LOD snapshot for the current frame, one reused record per layer.
 *
 * IMPORTANT: the registry reuses one LodState object per layer across frames
 * and mutates it in place. Do NOT retain the reference across frames.
 *
 * This object is ALWAYS passed to ScaleLayer.update() — even for layers
 * without lodTiers. Non-tiered layers should check `isTiered` and read
 * `frameOpacity`; the tier fields are meaningless for them (level -1,
 * crossfade 1). This differs from earlier versions of the API that passed
 * `undefined`; the change makes frameOpacity reachable for all layers.
 */
export interface LodState {
  /** True if this layer registered lodTiers. False means tier fields are N/A. */
  readonly isTiered: boolean;
  /**
   * Frame-membership fade (0..1): how fully this layer is "in" the current
   * frame, driven by the registry's enter/exit crossfade. Layers fading out
   * after a frame change read this. Layers that also have tiers multiply:
   * effective opacity = frameOpacity × crossfade.
   */
  readonly frameOpacity: number;
  /** Active tier index (0 = nearest), or -1 if LOD-inactive / no tiers. */
  readonly level: number;
  /**
   * Weight of the ACTIVE tier (0..1). The layer draws tier `level` at
   * `crossfade` and, if it exists, tier `level + 1` at `1 - crossfade`.
   * The last tier's fade-out weight is captured by the layer drawing it at
   * `1 - crossfade` of the tier *above* it. A layer that only ever draws the
   * active tier goes dark in the hysteresis band (1.0×..1.2× maxDistance) —
   * do not implement it that way; see computeCrossfade docs.
   *
   * Non-tiered layers: always 1.
   */
  readonly crossfade: number;
  /** 0..1 normalized budget share across active layers. */
  readonly budgetFrac: number;
  /**
   * Distance (metres) used for tier selection this frame, resolved per the
   * layer's DistanceBasis. Non-tiered layers: 0 (unused).
   */
  readonly focusDistance: number;
  /**
   * Always the camera→focus distance in metres, regardless of which basis
   * drove tier selection and regardless of the camera's current frame.
   * Lets a layer override its own near-tier behavior.
   */
  readonly cameraFocusDistance: number;
  /**
   * Which basis produced focusDistance. "anchor" = layer.defaultAnchor,
   * "focus" = getFocusDistance() with no anchor, "frame-origin" = fallback
   * when no target and no anchor. null only when level === -1 or untiered.
   */
  readonly distanceBasis: 'anchor' | 'focus' | 'frame-origin' | null;
  /** Whether hysteresis held the level at its previous value this frame. */
  readonly heldByHysteresis: boolean;
}

/** Registry-level tuning. Not per-tier — consistency across layers matters. */
export const HYSTERESIS_RATIO = 1.2;
export const DEFAULT_CROSSFADE_RATIO = 0.15;
export const DEFAULT_GLOBAL_OBJECT_CAP = 50_000;

/** The mutable backing for LodState, used by the registry. */
export interface MutableLodState {
  isTiered: boolean;
  frameOpacity: number;
  level: number;
  crossfade: number;
  budgetFrac: number;
  focusDistance: number;
  cameraFocusDistance: number;
  distanceBasis: LodState['distanceBasis'];
  heldByHysteresis: boolean;
}

export function makeLodState(): MutableLodState {
  return {
    isTiered: false,
    frameOpacity: 0,
    level: -1,
    crossfade: 1,
    budgetFrac: 0,
    focusDistance: 0,
    cameraFocusDistance: Infinity,
    distanceBasis: null,
    heldByHysteresis: false,
  };
}

export function validateLodTiers(tiers: LodTier[], idPrefix: string): void {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error(`Layer "${idPrefix}": lodTiers must be a non-empty array`);
  }
  let prevMax = -Infinity;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const isLast = i === tiers.length - 1;
    if (!Number.isFinite(t.maxDistance) && !(isLast && t.maxDistance === Infinity)) {
      throw new Error(
        `Layer "${idPrefix}": lodTiers[${i}].maxDistance must be finite (except last tier may be Infinity)`,
      );
    }
    if (t.maxDistance <= prevMax) {
      throw new Error(
        `Layer "${idPrefix}": lodTiers[${i}].maxDistance must be strictly ascending (${t.maxDistance} <= ${prevMax})`,
      );
    }
    prevMax = t.maxDistance;
    if (!Number.isFinite(t.budgetFrac) || t.budgetFrac < 0 || t.budgetFrac > 1) {
      throw new Error(
        `Layer "${idPrefix}": lodTiers[${i}].budgetFrac must be in [0,1] (${t.budgetFrac})`,
      );
    }
    const cr = t.crossfadeRatio ?? DEFAULT_CROSSFADE_RATIO;
    if (!Number.isFinite(cr) || cr <= 0 || cr >= 1) {
      throw new Error(
        `Layer "${idPrefix}": lodTiers[${i}].crossfadeRatio must be in (0,1) (${cr})`,
      );
    }
  }
}

// Reused scratch, module scope — resolveLayerDistance writes into this to
// detect whether a focus target exists without allocating.
const targetScratch = new Float64Array(3);

/**
 * Resolve the layer's selection distance into `state`. No allocation.
 * Writes focusDistance, cameraFocusDistance, distanceBasis.
 *
 * 'anchor' requires layer.defaultAnchor; without one it behaves like 'focus'.
 * 'nearer' takes Math.min(anchorDistance, focusDistance) per frame — this is
 * stable (min of two smooth functions of camera position) and does not loop.
 */
export function resolveLayerDistance(
  basis: DistanceBasis,
  anchor: FramedPoint | undefined,
  api: FrameApi,
  state: MutableLodState,
): void {
  const hasTarget = api.getTargetPosition(undefined, targetScratch) !== null;
  const focus = api.getFocusDistance();
  state.cameraFocusDistance = focus;
  const focusBasis: LodState['distanceBasis'] = hasTarget ? 'focus' : 'frame-origin';

  if (!anchor || basis === 'focus') {
    state.focusDistance = focus;
    state.distanceBasis = focusBasis;
    return;
  }

  const a = api.getFocusDistance(anchor);
  if (basis === 'nearer' && focus < a) {
    state.focusDistance = focus;
    state.distanceBasis = focusBasis;
  } else {
    state.focusDistance = a;
    state.distanceBasis = 'anchor';
  }
}

/**
 * Tier selection with hysteresis, writing into `state` (no allocation).
 * Reads state.level as the previous level; writes state.level and
 * state.heldByHysteresis.
 */
export function selectTierInto(
  tiers: LodTier[],
  distance: number,
  state: MutableLodState,
): void {
  const prev = state.level;
  const prevMax =
    prev >= 0 && prev < tiers.length ? tiers[prev].maxDistance : Infinity;

  if (prev >= 0 && distance > prevMax && distance <= prevMax * HYSTERESIS_RATIO) {
    state.heldByHysteresis = true;
    return;
  }

  state.heldByHysteresis = false;
  for (let i = 0; i < tiers.length; i++) {
    if (distance <= tiers[i].maxDistance) {
      state.level = i;
      return;
    }
  }
  state.level = -1;
}

/**
 * Weight of the ACTIVE tier at the given distance.
 *
 * Contract: the layer draws tier `level` at `crossfade` and tier `level + 1`
 * (if it exists) at `1 - crossfade`. This is what makes the hysteresis band
 * visible: between 1.0× and 1.2× maxDistance, the level is *held* by
 * hysteresis (does not demote), but crossfade drops toward 0 — so the layer
 * fades the current tier out while fading the next tier in. A layer that only
 * draws the active tier goes dark in that band; do not implement it that way.
 *
 * An Infinity maxDistance (always-on last tier) never fades — returns 1.
 */
export function computeCrossfade(tier: LodTier, distance: number): number {
  if (tier.maxDistance === Infinity) return 1;
  const fadeInDist = tier.maxDistance * (tier.crossfadeRatio ?? DEFAULT_CROSSFADE_RATIO);
  const lowEdge = tier.maxDistance - fadeInDist;
  if (distance <= lowEdge) return 1;
  if (distance >= tier.maxDistance) return 0;
  return (tier.maxDistance - distance) / fadeInDist;
}

