// src/core/lod.ts (full file — only makeLodState + LodState docs change)

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
 * without lodTiers. Non-tiered layers see neutral values (`isTiered: false`,
 * `level: 0`, `crossfade: 1`) so a layer that only reads `level` and
 * `crossfade` draws normally and never has to check `isTiered`.
 *
 * DRAWING RULE — the weight to draw each tier at:
 *
 *     tier `level`     : frameOpacity × crossfade
 *     tier `level + 1` : frameOpacity × (1 − crossfade)   (if it exists)
 *
 * Draw tier `level` at full opacity when crossfade is 1; as crossfade falls
 * toward 0 near maxDistance, fade tier `level` out while fading tier
 * `level + 1` in. Non-tiered layers: draw at `frameOpacity` (crossfade is 1,
 * there is no level+1).
 */
export interface LodState {
  /** True if this layer registered lodTiers. False means tier fields are neutral. */
  readonly isTiered: boolean;
  /**
   * Frame-membership fade (0..1): how fully this layer is "in" the current
   * frame, driven by the registry's enter/exit crossfade. Layers fading out
   * after a frame change read this. Effective per-tier draw weight is
   * frameOpacity × crossfade (see the drawing rule in the LodState doc).
   */
  readonly frameOpacity: number;
  /**
   * Active tier index (0 = nearest). For non-tiered layers this is 0 (a
   * neutral "always-on" value), NOT -1. -1 means "this tiered layer is
   * currently outside all its tiers and should draw nothing this frame."
   */
  readonly level: number;
  /**
   * Weight of the ACTIVE tier (0..1). See the drawing rule above: tier
   * `level` draws at frameOpacity × crossfade, tier `level + 1` at
   * frameOpacity × (1 − crossfade). Always 1 for non-tiered layers.
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
   */
  readonly cameraFocusDistance: number;
  /**
   * Which basis produced focusDistance. "anchor" = layer.defaultAnchor,
   * "focus" = getFocusDistance() with no anchor, "frame-origin" = fallback
   * when no target and no anchor. null for non-tiered layers and for tiered
   * layers currently at level -1.
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
    // Neutral defaults for non-tiered layers: level 0 + crossfade 1 reads as
    // "always on, fully drawn." Phase 1 overwrites these for tiered layers.
    level: 0,
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

const targetScratch = new Float64Array(3);

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

export function computeCrossfade(tier: LodTier, distance: number): number {
  if (tier.maxDistance === Infinity) return 1;
  const fadeInDist = tier.maxDistance * (tier.crossfadeRatio ?? DEFAULT_CROSSFADE_RATIO);
  const lowEdge = tier.maxDistance - fadeInDist;
  if (distance <= lowEdge) return 1;
  if (distance >= tier.maxDistance) return 0;
  return (tier.maxDistance - distance) / fadeInDist;
}
