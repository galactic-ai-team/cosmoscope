// src/core/galaxyLod.ts
// Tier-table helpers for procedural galaxies and other deep-sky objects.
// Wraps the existing LodPolicy from project 2 so galaxy generators can declare
// tiers in one line without re-implementing the schema. The tier values here
// are tuned for a galaxy that's got thousands of stars: full render near,
// arms-only mid, point sprite at range, glow dot far.

import type { LodTier } from './lod';
import { METERS } from './frames';

/** Rough distance constants (metres) used by the tier builders. */
const LY = METERS.ly;
const KLY = 1_000 * LY;
const MLY = 1_000_000 * LY;

export interface GalaxyTierOptions {
  /** Galaxy's major-axis radius in light-years. Andromeda ≈ 110,000; Triangulum ≈ 60,000; LMC ≈ 14,000. */
  radiusLy: number;
  /** Distance at which the galaxy's fully-rendered form starts fading in. Default 3× radius. */
  fullDistanceMultiple?: number;
}

/**
 * Build a 4-tier LOD table for a galaxy: full → arms → point sprite → glow.
 * Thresholds are multiples of the galaxy's radius so large galaxies get
 * proportionally farther LOD cutoffs than small ones.
 */
export function galaxyLodTiers(opts: GalaxyTierOptions): LodTier[] {
  const r = opts.radiusLy * LY;
  const k = opts.fullDistanceMultiple ?? 3;

  return [
    // Tier 0: full render (thousands of stars, dust lanes, bulge shader).
    { maxDistance: k * r, budgetFrac: 0.55, crossfadeRatio: 0.2 },
    // Tier 1: arms only (hundreds of stars, no dust), for mid-range.
    { maxDistance: 10 * r, budgetFrac: 0.30, crossfadeRatio: 0.2 },
    // Tier 2: single point sprite with a spiral-ish glow.
    { maxDistance: 100 * r, budgetFrac: 0.10, crossfadeRatio: 0.25 },
    // Tier 3: tiny glow dot; always eligible so a distant galaxy never
    // disappears entirely from the sky.
    { maxDistance: Infinity, budgetFrac: 0.05, crossfadeRatio: 0.3 },
  ];
}

/** Convenience presets for the well-known galaxies in the Local Group. */
export const GALAXY_PRESETS: Record<'andromeda' | 'triangulum' | 'lmc' | 'smc', LodTier[]> = {
  // Andromeda (M31): ~110,000 ly radius.
  andromeda: galaxyLodTiers({ radiusLy: 110_000 }),
  // Triangulum (M33): ~60,000 ly radius.
  triangulum: galaxyLodTiers({ radiusLy: 60_000 }),
  // Large Magellanic Cloud: ~14,000 ly radius.
  lmc: galaxyLodTiers({ radiusLy: 14_000 }),
  // Small Magellanic Cloud: ~7,000 ly radius.
  smc: galaxyLodTiers({ radiusLy: 7_000 }),
};

/**
 * Free-fly speed tiering. Returns a speed in metres/second appropriate for
 * the given camera distance from origin. Cross-fades are handled by the
 * caller; this just picks a value. Uses log-linear interpolation within a
 * decade so acceleration feels smooth at boundaries.
 */
export function speedForDistance(distanceMetres: number): number {
  // Target: cover 1/10 of the current distance per second at cruise.
  // So at 1 AU (1.5e11 m) you cross 1.5e10 m/sec — outer solar system in
  // seconds, not hours. At 100 Mly (1e24 m) you cross 1e23 m/sec.
  // Clamp to a floor/ceiling so near-surface flight isn't glacial and
  // intergalactic flight isn't instant.
  const FLOOR = 50;      // m/s — walking-to-car speed for near-ground flight
  const CEILING = 1e25;  // m/s — absurdly fast but stops at universal scale
  const raw = distanceMetres / 10;
  return Math.min(CEILING, Math.max(FLOOR, raw));
}

/**
 * Suggested intergalactic "boost" multiplier when the user holds Shift.
 * Scales up at larger distances so pressing boost near the Sun gives a
 * noticeable kick without teleporting; pressing it at galactic scale gets
 * you between galaxies in seconds.
 */
export function boostMultiplierForDistance(distanceMetres: number): number {
  const decade = Math.log10(Math.max(1, distanceMetres));
  // 2× at near-ground, up to 20× at intergalactic.
  return 2 + 1.8 * Math.max(0, decade - 8);
}

// Re-export so callers have one import path for both halves.
export type { LodTier } from './lod';
export { KLY, MLY };
