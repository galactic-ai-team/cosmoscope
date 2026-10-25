// src/core/lod.ts
// LOD tier selection, hysteresis, and per-frame budget normalization.
// Consumed by LayerRegistry (layers.ts) — computes a LodState per layer each
// frame and hands it to ScaleLayer.update() as an optional 4th argument.

import type { FrameApi } from './camera';
import type { FramedPoint } from './frames';

export interface LodTier {
  /** Max distance (metres) at which this tier is eligible to draw. */
  maxDistance: number;
  /** Relative budget desire for this tier (0..1). Normalized across layers. */
  budgetFrac: number;
  /** Ratio of maxDistance over which to fade in. Default 0.15. */
  crossfadeRatio?: number;
  /**
   * Anchor to measure distance from for this tier. Shape: { frame, position },
   * where position is a Float64Array of length 3 in that frame.
   * If omitted, uses the layer's defaultAnchor. If that's also omitted,
   * uses camera focus. Per-tier override lets a layer mix anchors (e.g.
   * stars: Sun-anchored coarse tiers, focus-anchored near tier for labels).
   */
  anchor?: FramedPoint;
}

/**
 * Read-only LOD snapshot for the current frame, one reused record per layer.
 *
 * IMPORTANT: the registry reuses one LodState object per layer across frames
 * and mutates it in place. Do NOT retain the reference across frames. If you
 * need to compare against last frame, copy the fields you care about.
 */
export interface LodState {
  /** Active tier index (0 = nearest), or -1 if the layer is LOD-inactive. */
  readonly level: number;
  /** 0..1 fade-in opacity for the active tier. */
  readonly crossfade: number;
  /** 0..1 normalized budget share across active layers. */
  readonly budgetFrac: number;
  /** Distance (metres) used for tier selection this frame. */
  readonly focusDistance: number;
  /**
   * Which anchor produced focusDistance. "tier" = tier's own anchor,
   * "layer-default" = layer.defaultAnchor, "camera-focus" = FocusApi.getFocusDistance(),
   * "frame-origin" = fallback. null only when level === -1 (LOD-inactive).
   */
  readonly focusId: 'tier' | 'layer-default' | 'camera-focus' | 'frame-origin' | null;
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
  focusId: LodState['focusId'];
  heldByHysteresis: boolean;
}

export function makeLodState(): MutableLodState {
  return {
    level: -1,
    crossfade: 0,
    budgetFrac: 0,
    focusDistance: Infinity,
    focusId: null,
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
    if (!Number.isFinite(t.maxDistance) || t.maxDistance <= prevMax) {
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
    if (t.anchor !== undefined) {
      if (
        typeof t.anchor !== 'object' ||
        t.anchor === null ||
        typeof t.anchor.frame !== 'string' ||
        !(t.anchor.position instanceof Float64Array) ||
        t.anchor.position.length !== 3
      ) {
        throw new Error(
          `Layer "${idPrefix}": lodTiers[${i}].anchor must be { frame, position: Float64Array(3) }`,
        );
      }
    }
  }
}

/**
 * Compute the tier selection for a layer given its current distance.
 * Respects hysteresis: to move UP (nearer, higher detail), distance must be
 * <= tier.maxDistance; to move DOWN (farther, lower detail), distance must
 * exceed tier.maxDistance * HYSTERESIS_RATIO.
 *
 * `currentLevel` is the layer's level from last frame (-1 = inactive).
 * Returns the new level (-1 = inactive) and whether hysteresis held.
 */
export function selectTier(
  tiers: LodTier[],
  distance: number,
  currentLevel: number,
): { level: number; heldByHysteresis: boolean } {
  const prevLevel = currentLevel;
  const prevMax =
    prevLevel >= 0 && prevLevel < tiers.length
      ? tiers[prevLevel].maxDistance
      : Infinity;

  // If currently active and distance is within the hysteresis band above
  // prevMax (i.e. prevMax < distance <= prevMax * HYSTERESIS_RATIO), hold.
  if (prevLevel >= 0 && distance > prevMax && distance <= prevMax * HYSTERESIS_RATIO) {
    return { level: prevLevel, heldByHysteresis: true };
  }

  for (let i = 0; i < tiers.length; i++) {
    if (distance <= tiers[i].maxDistance) {
      return { level: i, heldByHysteresis: false };
    }
  }
  return { level: -1, heldByHysteresis: false };
}

/** Compute crossfade opacity for a given level and distance. */
export function computeCrossfade(tier: LodTier, distance: number): number {
  const fadeInDist = tier.maxDistance * (tier.crossfadeRatio ?? DEFAULT_CROSSFADE_RATIO);
  const lowEdge = tier.maxDistance - fadeInDist;
  if (distance <= lowEdge) return 1;
  if (distance >= tier.maxDistance) return 0;
  return (tier.maxDistance - distance) / fadeInDist;
}

/** Resolve the focusDistance for a tier given the layer and API. */
export function resolveTierDistance(
  tier: LodTier,
  layerDefaultAnchor: FramedPoint | undefined,
  api: FrameApi,
): { distance: number; focusId: LodState['focusId'] } {
  if (tier.anchor) {
    return { distance: api.getFocusDistance(tier.anchor), focusId: 'tier' };
  }
  if (layerDefaultAnchor) {
    return { distance: api.getFocusDistance(layerDefaultAnchor), focusId: 'layer-default' };
  }
  // getFocusDistance() with no anchor falls back to frame-origin distance
  // today; once Claude implements orbit-target / flight-target focus, this
  // will return camera focus automatically. focusId documents the current
  // contract, not a permanent guarantee.
  return { distance: api.getFocusDistance(), focusId: 'camera-focus' };
}