// tests/ui/flyExit.test.ts (Lumi, P0 c): orbit target + eased turn after free-fly.
import { describe, expect, it } from 'vitest';
import type { FramedPoint } from '../../src/core/camera';
import { LAST_PICK_PREFERENCE, chooseOrbitTarget, easeInOut, slerpDir, type OrbitCandidate } from '../../src/ui/flyExit';

const at = (x: number): FramedPoint => ({ frame: 'helio', position: [x, 0, 0] });
const dist = (p: FramedPoint): number => Math.abs(p.position[0] as number); // camera at the origin

describe('chooseOrbitTarget', () => {
  const sun: OrbitCandidate = { id: 'star:sol:sun', point: at(100), radius: 10 };
  const earth: OrbitCandidate = { id: 'planet:earth', point: at(20), radius: 1 };
  const m31: OrbitCandidate = { id: 'galaxy:messier:M31', point: at(1e9), radius: 0 };

  it('orbits the body whose surface is nearest', () => {
    expect(chooseOrbitTarget([sun, earth, m31], dist, null)?.id).toBe('planet:earth');
  });
  it('keeps the last pick when it is close enough (within LAST_PICK_PREFERENCE x the nearest gap)', () => {
    const mars: OrbitCandidate = { id: 'planet:mars', point: at(19 * LAST_PICK_PREFERENCE), radius: 1 };
    expect(chooseOrbitTarget([sun, earth, mars], dist, 'planet:mars')?.id).toBe('planet:mars');
  });
  it('drops a far-away last pick for the nearest body (you flew away from it)', () => {
    expect(chooseOrbitTarget([sun, earth, m31], dist, 'galaxy:messier:M31')?.id).toBe('planet:earth');
  });
  it('returns null with no candidates and skips non-finite distances', () => {
    expect(chooseOrbitTarget([], dist, null)).toBeNull();
    const bad: OrbitCandidate = { id: 'x', point: at(NaN), radius: 0 };
    expect(chooseOrbitTarget([bad, sun], dist, 'x')?.id).toBe('star:sol:sun');
  });
});

describe('slerpDir / easeInOut', () => {
  it('goes from a to b along the great circle, unit length throughout', () => {
    const a = [1, 0, 0], b = [0, 1, 0];
    expect(Array.from(slerpDir(a, b, 0))).toEqual([1, 0, 0]);
    const mid = slerpDir(a, b, 0.5);
    expect(mid[0]).toBeCloseTo(Math.SQRT1_2);
    expect(mid[1]).toBeCloseTo(Math.SQRT1_2);
    const end = slerpDir(a, b, 1);
    expect(end[0]).toBeCloseTo(0);
    expect(end[1]).toBeCloseTo(1);
  });
  it('handles opposite directions without NaN', () => {
    const m = slerpDir([1, 0, 0], [-1, 0, 0], 0.5);
    expect(Math.hypot(m[0], m[1], m[2])).toBeCloseTo(1);
    expect(m.every(Number.isFinite)).toBe(true);
  });
  it('easeInOut is clamped smoothstep', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(2)).toBe(1);
  });
});
