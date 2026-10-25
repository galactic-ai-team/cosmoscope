// src/core/logLerp.ts — distance interpolation for flyTo (owner: Claude).
//
// Interpolating camera distance linearly across 20 orders of magnitude
// spends the whole flight crawling near one end, then jumps. Interpolating
// its logarithm gives a steady "zoom": every equal slice of t multiplies
// the distance by the same factor. flyTo (Dee) owns the path shape and
// easing; feed the eased t in here.

/** Distance at t in [0, 1] between d0 and d1 (both > 0), uniform in log space. */
export function logLerpDistance(d0: number, d1: number, t: number): number {
  if (!(d0 > 0) || !(d1 > 0)) throw new RangeError('logLerpDistance: distances must be > 0');
  if (t <= 0) return d0;
  if (t >= 1) return d1;
  return Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * t);
}

/** Inverse: where d sits between d0 and d1, as t in log space (unclamped). */
export function logInverseLerp(d0: number, d1: number, d: number): number {
  if (!(d0 > 0) || !(d1 > 0) || !(d > 0)) throw new RangeError('logInverseLerp: distances must be > 0');
  const span = Math.log(d1) - Math.log(d0);
  return span === 0 ? 0 : (Math.log(d) - Math.log(d0)) / span;
}

/** Orders of magnitude between two distances; handy for sizing flight time. */
export function decadesBetween(d0: number, d1: number): number {
  return Math.abs(Math.log10(d1 / d0));
}