// tests/core/logLerp.test.ts (owner: Claude)
import { describe, expect, it } from 'vitest';

import { decadesBetween, logInverseLerp, logLerpDistance } from '../../src/core/logLerp';

describe('logLerpDistance', () => {
  it('hits the endpoints and clamps t', () => {
    expect(logLerpDistance(1, 1e26, 0)).toBe(1);
    expect(logLerpDistance(1, 1e26, 1)).toBe(1e26);
    expect(logLerpDistance(1, 1e26, -1)).toBe(1);
    expect(logLerpDistance(1, 1e26, 2)).toBe(1e26);
  });

  it('is uniform in log space: the midpoint of 1 m..1e26 m is 1e13 m', () => {
    expect(Math.log10(logLerpDistance(1, 1e26, 0.5))).toBeCloseTo(13, 9);
  });

  it('works zooming in as well as out', () => {
    expect(Math.log10(logLerpDistance(1e20, 1e2, 0.25))).toBeCloseTo(15.5, 9);
  });

  it('inverts', () => {
    const d = logLerpDistance(3e4, 7e22, 0.37);
    expect(logInverseLerp(3e4, 7e22, d)).toBeCloseTo(0.37, 9);
  });

  it('rejects non-positive distances', () => {
    expect(() => logLerpDistance(0, 1, 0.5)).toThrow(RangeError);
    expect(() => logLerpDistance(1, -1, 0.5)).toThrow(RangeError);
  });

  it('counts decades', () => {
    expect(decadesBetween(1e3, 1e9)).toBeCloseTo(6, 12);
    expect(decadesBetween(1e9, 1e3)).toBeCloseTo(6, 12);
  });
});