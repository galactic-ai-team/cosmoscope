// src/layers/galaxyProfiles.ts
// Nova's per-galaxy catalog data for the built-out galaxies round.
// Consumed by the procedural galaxy generator (whoever owns it): for
// each named galaxy, the real morphology the generator should build —
// type, size, viewing inclination, major-axis position angle, arm
// structure, bulge/dust balance, a near-LOD star budget, and a
// deterministic seed (same galaxy, same build, every load, every
// device).
//
// Ids are the galaxies layer's BODIES ids (src/layers/galaxies.ts).
// Diameters deliberately match that file's DIAMETER_LY framing table
// so fly-to approach distances and sprite sizes don't change under
// the generator. Inclination (0 = face-on, 90 = edge-on) and position
// angle (major axis, degrees east of north, [0, 180)) are the
// standard published photometric values (RC3/NED-style); like the
// seed catalog data, they are flagged for a verification pass before
// launch. Ellipticals get null incl/PA where orientation isn't
// meaningful for a spheroid build.
//
// The Milky Way is intentionally absent: we view it from inside, so
// generatorParamsFor returns null for it (and for clusters, which
// are not single galaxies). Everything else — the Local Group
// dwarfs, the ultra-faints — gets a type-based default profile.

export type GalaxyMorphology =
  | 'Sa' | 'Sb' | 'Sc' | 'SBb' | 'SBc' | 'E' | 'Irr' | 'dSph';

export interface GalaxyProfile {
  id: string;
  morphology: GalaxyMorphology;
  /** Matches DIAMETER_LY in galaxies.ts (framing-consistent). */
  diameterLy: number;
  inclinationDeg: number | null;
  positionAngleDeg: number | null;
  /** Spiral arms; 0 for non-spirals, 1 for the one-armed LMC. */
  armCount: number;
  /** Log-spiral pitch angle, degrees; 0 for non-spirals. */
  pitchDeg: number;
  /** Fraction of stars in the bulge/halo component, 0..1. */
  bulgeFraction: number;
  /** Dust-lane darkening strength for the generator, 0..1. */
  dustStrength: number;
  /** Point budget at the nearest LOD tier. */
  starCountNear: number;
  /** Deterministic seed, derived from the id. */
  seed: number;
}

/** Global per-galaxy ceiling at the nearest tier (mobile budget). */
export const MAX_STAR_COUNT_NEAR = 12_000;

/** FNV-1a 32-bit — deterministic across runs, devices and reloads. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

type ProfileSeed = Omit<GalaxyProfile, 'seed'>;

const PROFILE_LIST: ProfileSeed[] = [
  { id: 'galaxy:messier:M31', morphology: 'Sb', diameterLy: 220_000, inclinationDeg: 77, positionAngleDeg: 38, armCount: 2, pitchDeg: 15, bulgeFraction: 0.3, dustStrength: 0.7, starCountNear: 12_000 },
  { id: 'galaxy:messier:M32', morphology: 'E', diameterLy: 8_000, inclinationDeg: null, positionAngleDeg: null, armCount: 0, pitchDeg: 0, bulgeFraction: 1, dustStrength: 0, starCountNear: 1_500 },
  { id: 'galaxy:messier:M110', morphology: 'E', diameterLy: 15_000, inclinationDeg: 63, positionAngleDeg: 148, armCount: 0, pitchDeg: 0, bulgeFraction: 1, dustStrength: 0.1, starCountNear: 2_000 },
  { id: 'galaxy:messier:M33', morphology: 'Sc', diameterLy: 55_000, inclinationDeg: 56, positionAngleDeg: 23, armCount: 3, pitchDeg: 24, bulgeFraction: 0.15, dustStrength: 0.5, starCountNear: 6_000 },
  { id: 'galaxy:messier:M51', morphology: 'Sc', diameterLy: 76_000, inclinationDeg: 22, positionAngleDeg: 10, armCount: 2, pitchDeg: 20, bulgeFraction: 0.2, dustStrength: 0.8, starCountNear: 8_000 },
  { id: 'galaxy:messier:M81', morphology: 'Sb', diameterLy: 90_000, inclinationDeg: 59, positionAngleDeg: 157, armCount: 2, pitchDeg: 16, bulgeFraction: 0.32, dustStrength: 0.6, starCountNear: 8_000 },
  { id: 'galaxy:messier:M82', morphology: 'Irr', diameterLy: 37_000, inclinationDeg: 80, positionAngleDeg: 65, armCount: 0, pitchDeg: 0, bulgeFraction: 0.1, dustStrength: 0.9, starCountNear: 5_000 },
  { id: 'galaxy:messier:M87', morphology: 'E', diameterLy: 120_000, inclinationDeg: null, positionAngleDeg: null, armCount: 0, pitchDeg: 0, bulgeFraction: 1, dustStrength: 0, starCountNear: 10_000 },
  { id: 'galaxy:messier:M101', morphology: 'Sc', diameterLy: 170_000, inclinationDeg: 18, positionAngleDeg: 39, armCount: 3, pitchDeg: 22, bulgeFraction: 0.12, dustStrength: 0.5, starCountNear: 10_000 },
  { id: 'galaxy:messier:M104', morphology: 'Sa', diameterLy: 130_000, inclinationDeg: 84, positionAngleDeg: 90, armCount: 2, pitchDeg: 10, bulgeFraction: 0.5, dustStrength: 0.85, starCountNear: 8_000 },
  { id: 'galaxy:pgc:17223', morphology: 'Irr', diameterLy: 14_000, inclinationDeg: 35, positionAngleDeg: 170, armCount: 1, pitchDeg: 18, bulgeFraction: 0.1, dustStrength: 0.4, starCountNear: 4_000 },
  { id: 'galaxy:pgc:3085', morphology: 'Irr', diameterLy: 7_000, inclinationDeg: 40, positionAngleDeg: 45, armCount: 0, pitchDeg: 0, bulgeFraction: 0.05, dustStrength: 0.3, starCountNear: 2_500 },
];

export const GALAXY_PROFILES: Record<string, GalaxyProfile> = {};
for (const p of PROFILE_LIST) {
  GALAXY_PROFILES[p.id] = { ...p, seed: hashSeed(p.id) };
}

export interface GalaxyGeneratorParams extends GalaxyProfile {
  /** True when this came from the verified profile table. */
  fromProfile: boolean;
}

/**
 * The generator's single lookup. Returns the verified profile for a
 * named galaxy; a dwarf-spheroidal default (seeded, size-scaled,
 * budget-capped) for any other galaxy id; and null for the Milky Way
 * and for clusters, which the generator must not build.
 */
export function generatorParamsFor(
  id: string,
  fallbackDiameterLy?: number,
): GalaxyGeneratorParams | null {
  if (id === 'galaxy:common:milkyway') return null;
  if (id.startsWith('cluster:')) return null;

  const profile = GALAXY_PROFILES[id];
  if (profile) return { ...profile, fromProfile: true };

  const d =
    fallbackDiameterLy !== undefined && fallbackDiameterLy > 0
      ? fallbackDiameterLy
      : 2_000;
  return {
    id,
    morphology: 'dSph',
    diameterLy: d,
    inclinationDeg: null,
    positionAngleDeg: null,
    armCount: 0,
    pitchDeg: 0,
    bulgeFraction: 0.9,
    dustStrength: 0,
    starCountNear: Math.max(200, Math.min(1_500, Math.round(d / 2))),
    seed: hashSeed(id),
    fromProfile: false,
  };
}
