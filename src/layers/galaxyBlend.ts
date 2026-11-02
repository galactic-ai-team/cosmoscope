// src/layers/galaxyBlend.ts (Lumi, P0 fix for Stephon's 10:48 PM report)
//
// One shared rule for how a galaxy is drawn at a given on-screen size, so the
// glow-sprite layer (galaxies.ts) and the procedural layer
// (ui/proceduralGalaxies.ts) never stack into "glow + random coloured dots":
//   - procedural mesh: hidden below PROC_MIN_PX, fades in up to PROC_FULL_PX,
//     and its fixed-pixel stars shrink with the galaxy so a small galaxy is
//     never a clump of fat 3-5 px dots;
//   - glow sprite of a profiled galaxy: the whole galaxy while the mesh is
//     hidden (it is at most PROC_MIN_PX there), tapering to a faint core halo
//     as the mesh fades in;
//   - glow sprite of an unprofiled galaxy or cluster: never a big blob, just a
//     subtle point of at most UNPROFILED_MAX_PX (Milky Way included, until it
//     gets its own procedural model).
// Sizes are CSS pixels of the galaxy's apparent diameter.

/** Procedural mesh starts to fade in at this apparent diameter. */
export const PROC_MIN_PX = 24;
/** Procedural mesh fully visible from this apparent diameter. */
export const PROC_FULL_PX = 72;
/** Largest glow an unprofiled galaxy or cluster ever gets. */
export const UNPROFILED_MAX_PX = 8;
/** Glow intensity for unprofiled galaxies and clusters. */
export const UNPROFILED_ALPHA = 0.7;
/** Halo left behind a fully visible procedural mesh (fraction of diameter). */
export const HALO_SIZE = 0.3;
export const HALO_ALPHA = 0.35;

/** Apparent diameter in CSS px for a vertical fov (radians) and viewport height (CSS px). */
export function apparentPx(diameter: number, distance: number, fovRad: number, viewportH: number): number {
  if (!(distance > 0) || !(diameter > 0)) return 0;
  return (diameter / distance / fovRad) * viewportH;
}

function smooth(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Procedural mesh visibility 0..1 for an apparent diameter in CSS px. */
export function proceduralFade(px: number): number {
  return smooth(px, PROC_MIN_PX, PROC_FULL_PX);
}

/**
 * Point size (CSS px) for the procedural mesh's stars: the generator's size,
 * shrunk while the galaxy is small so its dots never clump into a blob.
 */
export function proceduralPointSize(baseSize: number, px: number): number {
  return Math.min(baseSize, Math.max(1, px / 24));
}

export interface GlowStyle {
  /** Sprite diameter, CSS px. */
  px: number;
  /** Sprite intensity 0..1. */
  alpha: number;
}

/** Glow sprite size + intensity for a galaxy of apparent diameter px. */
export function glowStyle(px: number, profiled: boolean, out: GlowStyle = { px: 0, alpha: 1 }): GlowStyle {
  if (!profiled) {
    out.px = Math.min(px, UNPROFILED_MAX_PX);
    out.alpha = UNPROFILED_ALPHA;
    return out;
  }
  const f = proceduralFade(px);
  out.px = px * (1 - (1 - HALO_SIZE) * f);
  out.alpha = 1 - (1 - HALO_ALPHA) * f;
  return out;
}
