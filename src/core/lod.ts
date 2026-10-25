// src/core/lod.ts
// LOD tier selection, hysteresis, and per-frame budget normalization.
// Consumed by LayerRegistry (layers.ts) — computes a LodState per layer each
// frame and hands it to ScaleLayer.update() as an optional 4th argument.

import type { FrameApi, FramedPoint } from './camera';

export interface LodTier {
  /** Max distance (metres) at which this tier is eligible to draw. */
  maxDistance: number;
  /** Relative budget desire for this tier (0..1). Normalized across layers. */
  budgetFrac: number;
  /** Ratio of maxDistance over which to fade in. Default 0.15. */
  crossfadeRatio?: number;
  /**
   * Distance basis for this tier:
   *  - FramedPoint      : explicit anchor (e.g. Sun, a specific galaxy)
   *  - 'camera-focus'   : Claude's camera.getTargetPosition / frame-origin fallback
   *  - undefined        : inherit layer.defaultAnchor, else 'camera-focus'
   * Per-tier override is what allows a star layer to mix Sun-anchored coarse
   * tiers with camera-focus near tier (for labels/detail).
   */
  anchor?: FramedPoint | 'camera-focus';
}

/**
 * Read-only LOD snapshot, one reused record per layer across frames.
 *
 * IMPORTANT: the registry mutates this in place. Do NOT retain the reference
 * across frames. Copy fields you need to compare against.
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
   * Which anchor produced focusDistance. null when level === -1 (LOD-inactive).
   */
  readonly focusId: 'tier' | 'layer-default' | 'camera-focus' | null;
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
    const a = t.anchor;
    if (a !== undefined && a !== 'camera-focus') {
      if (
        typeof a !== 'object' ||
        a === null ||
        !('frame' in a) ||
        !('point' in a) ||
        !(a.point instanceof Float64Array) ||
        a.point.length !== 3
      ) {
        throw new Error(
          `Layer "${idPrefix}": lodTiers[${i}].anchor must be a FramedPoint or 'camera-focus'`,
        );
      }
    }
  }
}

/**
 * Distance for a given tier, honoring per-tier anchor override.
 * Precedence: tier.anchor (FramedPoint) > tier.anchor === 'camera-focus' >
 *             layer.defaultAnchor > camera focus fallback.
 */
export function resolveTierDistance(
  tier: LodTier,
  layerDefaultAnchor: FramedPoint | undefined,
  api: FrameApi,
): { distance: number; focusId: LodState['focusId'] } {
  if (tier.anchor !== undefined) {
    if (tier.anchor === 'camera-focus') {
      return { distance: api.getFocusDistance(), focusId: 'camera-focus' };
    }
    return { distance: api.getFocusDistance(tier.anchor), focusId: 'tier' };
  }
  if (layerDefaultAnchor) {
    return { distance: api.getFocusDistance(layerDefaultAnchor), focusId: 'layer-default' };
  }
  return { distance: api.getFocusDistance(), focusId: 'camera-focus' };
}

/** Compute crossfade opacity for a given level and distance. */
export function computeCrossfade(tier: LodTier, distance: number): number {
  const fadeInDist = tier.maxDistance * (tier.crossfadeRatio ?? DEFAULT_CROSSFADE_RATIO);
  const lowEdge = tier.maxDistance - fadeInDist;
  if (distance <= lowEdge) return 1;
  if (distance >= tier.maxDistance) return 0;
  return (tier.maxDistance - distance) / fadeInDist;
}

/**
 * Select the tier whose anchor-distance puts us inside its maxDistance.
 * Because each tier can use a different anchor, we must evaluate EVERY tier's
 * own distance to decide eligibility — not compare raw camera distance to
 * maxDistance. Selection rule: the highest-detail (lowest-index) tier whose
 * anchor-distance <= its maxDistance. Hysteresis applies to the previously
 * selected tier: if the previous tier would still be eligible but we've moved
 * to a farther eligible tier's band, we honor the previous tier until we exit
 * HYSTERESIS_RATIO * its maxDistance.
 */
export function selectTier(
  tiers: LodTier[],
  layerDefaultAnchor: FramedPoint | undefined,
  api: FrameApi,
  currentLevel: number,
): {
  level: number;
  distance: number;
  focusId: LodState['focusId'];
  heldByHysteresis: boolean;
} {
  // Pre-compute each tier's anchor-distance this frame.
  const distances: number[] = new Array(tiers.length);
  const focusIds: LodState['focusId'][] = new Array(tiers.length);
  for (let i = 0; i < tiers.length; i++) {
    const r = resolveTierDistance(tiers[i], layerDefaultAnchor, api);
    distances[i] = r.distance;
    focusIds[i] = r.focusId;
  }

  // Highest-detail eligible tier: lowest i with distances[i] <= maxDistance[i].
  let eligible = -1;
  for (let i = 0; i < tiers.length; i++) {
    if (distances[i] <= tiers[i].maxDistance) {
      eligible = i;
      break;
    }
  }

  // Hysteresis: if currently active at prevLevel, and the previous tier is
  // still "within stretch" of its maxDistance (<= HYSTERESIS_RATIO * max),
  // hold at prevLevel rather than switching to the newly eligible tier.
  if (
    currentLevel >= 0 &&
    currentLevel < tiers.length &&
    eligible !== currentLevel
  ) {
    const prevMax = tiers[currentLevel].maxDistance;
    const prevDist = distances[currentLevel];
    const withinStretch = prevDist <= prevMax * HYSTERESIS_RATIO;
    if (withinStretch) {
      return {
        level: currentLevel,
        distance: prevDist,
        focusId: focusIds[currentLevel],
        heldByHysteresis: true,
      };
    }
  }

  if (eligible === -1) {
    // Not eligible at any tier. Report the closest tier's distance so callers
    // can log/debug; focusId from tier 0.
    const d0 = tiers.length > 0 ? distances[0] : Infinity;
    const f0 = tiers.length > 0 ? focusIds[0] : null;
    return { level: -1, distance: d0, focusId: f0, heldByHysteresis: false };
  }

  return {
    level: eligible,
    distance: distances[eligible],
    focusId: focusIds[eligible],
    heldByHysteresis: false,
  };
}
