// Leaving free-fly (Lumi, P0 from Stephon's 10:48 PM report): give the orbit
// controls a real object to orbit and zoom around again.
//
// While free-flying, the camera's look-at point is just a spot ahead at the
// nearest surface's distance (that keeps the render scale right). Leaving
// free-fly used to keep that empty spot as the orbit pivot and the free-fly
// roll as the camera's up, so wheel / pinch zoomed into nothing and drags
// orbited around nothing, tilted. On exit, main.ts now picks a body with
// chooseOrbitTarget(), turns the camera to face it (eased with
// createExitTurn(), instant with reduced motion) and puts the orbit axis back
// (orbitUpFor + CosmoControls' own up easing).

import type { FramedPoint } from '../core/camera';

export interface OrbitCandidate {
  id: string;
  point: FramedPoint;
  /** Surface radius, metres (0 for points such as galaxy centres). */
  radius: number;
}

/**
 * The last pick may be farther than the nearest body by up to this factor
 * (surface gaps) and still win: you usually exit free-fly near what you were
 * looking at, and it keeps the readout and the orbit on the same object.
 */
export const LAST_PICK_PREFERENCE = 3;

/**
 * Orbit target after free-fly: the body whose surface is nearest, unless the
 * last picked object is within LAST_PICK_PREFERENCE x that gap.
 */
export function chooseOrbitTarget(
  cands: readonly OrbitCandidate[],
  distanceTo: (p: FramedPoint) => number,
  lastPickId: string | null,
): OrbitCandidate | null {
  let best: OrbitCandidate | null = null;
  let bestGap = Infinity;
  let pick: OrbitCandidate | null = null;
  let pickGap = Infinity;
  for (const c of cands) {
    const gap = Math.max(0, distanceTo(c.point) - c.radius);
    if (!Number.isFinite(gap)) continue;
    if (gap < bestGap) { bestGap = gap; best = c; }
    if (c.id === lastPickId) { pick = c; pickGap = gap; }
  }
  if (pick && pickGap <= LAST_PICK_PREFERENCE * Math.max(bestGap, 1)) return pick;
  return best;
}

/** Spherical interpolation between unit vectors a and b (t in [0, 1]). */
export function slerpDir(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out = new Float64Array(3)): Float64Array {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) {
    out[0] = b[0]; out[1] = b[1]; out[2] = b[2];
    return out;
  }
  if (Math.PI - omega < 1e-6) {
    // Opposite directions: lerp and renormalise through any perpendicular.
    const p = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
    const pl = Math.hypot(p[0], p[1], p[2]);
    const ang = t * Math.PI;
    for (let i = 0; i < 3; i++) out[i] = a[i] * Math.cos(ang) + (p[i] / pl) * Math.sin(ang);
    return out;
  }
  const s = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / s;
  const wb = Math.sin(t * omega) / s;
  for (let i = 0; i < 3; i++) out[i] = wa * a[i] + wb * b[i];
  const len = Math.hypot(out[0], out[1], out[2]);
  out[0] /= len; out[1] /= len; out[2] /= len;
  return out;
}

/** Smoothstep ease used by the exit turn. */
export function easeInOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Seconds the camera takes to turn onto the new orbit target. */
export const EXIT_TURN_S = 0.6;
