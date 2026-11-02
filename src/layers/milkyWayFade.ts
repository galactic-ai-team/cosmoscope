// src/layers/milkyWayFade.ts (Lumi, P0 b): when the Milky Way's outside view
// (procedural SBbc mesh + its glow sprite) may show. Inside the galaxy the
// view is GPT-6's star field, which fades out 60,000-100,000 ly from the
// Sun; the Milky Way mesh fades in over the same range, so it never draws
// over the in-galaxy star view. Shared by galaxies.ts and the procedural glue.

/** Fade-in range, light-years of camera distance from the Sun (= the stars' fade-out). */
export const MW_FADE_LY = { start: 60_000, end: 100_000 } as const;

/** 0 inside the star field, 1 from MW_FADE_LY.end out, smoothstep between. */
export function milkyWayFade(distanceFromSunLy: number): number {
  const { start, end } = MW_FADE_LY;
  if (!(distanceFromSunLy > start)) return 0;
  if (distanceFromSunLy >= end) return 1;
  const t = (distanceFromSunLy - start) / (end - start);
  return t * t * (3 - 2 * t);
}
