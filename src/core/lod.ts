// src/core/lod.ts
// LOD distance-basis resolution, tier selection with hysteresis, and
// crossfade weight. Consumed by LayerRegistry (layers.ts), which hands a
// LodState to ScaleLayer.update() as an optional 4th argument.
//
// Design: ONE distance basis per layer, never per tier. Tier 0 cannot use a
// different anchor than tier 1 — that would make tier selection depend on
// itself (tier → anchor → distance → tier), and it oscillates at boundaries.
// If a layer wants "near camera objects while far from Sun", it sets basis
// 'nearer', which takes Math.min(anchorDistance, focusDistance) every frame
// that a focus target exists.

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
 */
export interface LodState {
  /** Active tier index (0 = nearest), or -1 if the layer is LOD-inactive. */
  readonly level: number;
  /**
   * Weight of the ACTIVE tier. The layer draws tier `level` at `crossfade`
   * and, if it exists, tier `level + 1` at `1 - crossfade`.
   *
   * The last tier (no `level + 1` to pair with) simply fades out by its own
   * crossfade going to 0 across [(1 - crossfadeRatio) × maxDistance,
   * maxDistance]. An Infinity last tier never fades (crossfade always 1).
   *
   * Note: in the hysteresis band (1.0×..1.2× maxDistance), the level is
   * *held* by hysteresis while crossfade is at 0 — the layer should be
   * showing tier `level + 1` at 1.0 weight by then. A layer that only ever
   * draws the active tier goes dark in that band; do not implement it so.
   */
  readonly crossfade: number;
  /** 0..1 normalized budget share across active layers. */
  readonly budgetFrac: number;
  /**
   * Distance (metres) used for tier selection this frame, resolved per the
   * layer's DistanceBasis.
   */
  readonly focusDistance: number;
  /**
   * Always the camera→focus distance, regardless of which basis drove tier
   * selection. Lets a layer override its own near-tier behavior.
   */
  readonly cameraFocusDistance: number;
  /**
   * Which basis produced focusDistance. "anchor" = layer.defaultAnchor,
   * "focus" = getFocusDistance() with no anchor, "frame-origin" = fallback
   * when no target and no anchor. Null only when the layer has no lodTiers
   * or is currently LOD-inactive (level === -1); whenever level >= 0,
   * distanceBasis is set.
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
    level: -1,
    crossfade: 0,
    budgetFrac: 0,
    focusDistance: Infinity,
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
 * 'nearer' takes Math.min(anchorDistance, focusDistance) — but ONLY when a
 * focus target exists. With no target, getFocusDistance() falls back to
 * distance-to-Sun, so 'nearer' would collapse to the anchor distance anyway;
 * we gate explicitly so the behavior is obvious and does not depend on the
 * current fallback semantics of getFocusDistance().
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
  if (basis === 'nearer' && hasTarget && focus < a) {
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
 * (if it exists) at `1 - crossfade`.
 *
 * The active tier fades from 1 to 0 across
 *   [(1 - crossfadeRatio) × maxDistance,  maxDistance].
 *
 * In the hysteresis band (1.0×..1.2× maxDistance), the active tier's
 * crossfade is 0 — the level is *held* by hysteresis, but its weight is 0,
 * and the layer should be showing the next tier at full weight. A layer that
 * draws only the active tier goes dark in that band; do not implement it so.
 *
 * The last tier has no next tier to pair with, so it simply fades out by its
 * own crossfade going to 0 across the same interval.
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
