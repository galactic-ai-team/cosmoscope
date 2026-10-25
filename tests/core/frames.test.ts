// tests/core/frames.test.ts — frame stack math (owner: Claude).
import { describe, expect, it, vi } from 'vitest';

import { ECLIPTIC_NORTH, FRAME_ORDER, FrameStack, METERS } from '../../src/core/frames';

describe('FrameStack', () => {
  it('has the agreed frames, innermost to outermost, with the agreed units', () => {
    const f = new FrameStack();
    expect(FRAME_ORDER).toEqual(['planet', 'helio', 'galactic', 'cosmic']);
    expect(f.unitsPerFrame('planet')).toBe(METERS.km);
    expect(f.unitsPerFrame('helio')).toBe(METERS.au);
    expect(f.unitsPerFrame('galactic')).toBe(METERS.pc);
    expect(f.unitsPerFrame('cosmic')).toBe(METERS.mpc);
    expect(f.get('cosmic').parent).toBeNull();
    expect(f.get('planet').parent).toBe('helio');
  });

  it('converts units: 1 pc is ~206,265 AU, 1 AU is 149,597,870.7 km', () => {
    const f = new FrameStack();
    expect(f.toFrame([1, 0, 0], 'galactic', 'helio')[0]).toBeCloseTo(206264.806, 3);
    expect(f.toFrame([1, 0, 0], 'helio', 'planet')[0]).toBeCloseTo(149597870.7, 3);
  });

  it('accounts for a moved origin', () => {
    const f = new FrameStack();
    f.setOrigin('planet', [METERS.au, 0, 0]); // Earth-ish
    const sunInPlanet = f.toFrame([0, 0, 0], 'helio', 'planet');
    expect(sunInPlanet[0]).toBeCloseTo(-149597870.7, 3);
    const back = f.toFrame(sunInPlanet, 'planet', 'helio');
    expect(Math.abs(back[0])).toBeLessThan(1e-12);
  });

  it('round-trips through every frame pair to float64 precision', () => {
    // Round-trip error is bounded by float64 spacing at the LARGEST
    // magnitude the value passes through (meters from the farther origin),
    // not by the starting value. That is inherent, and why camera.ts keeps
    // the precision-critical subtraction in the camera's own frame.
    const f = new FrameStack();
    f.setOrigin('planet', [1.2e11, -8.7e10, 3.3e10]);
    f.setOrigin('galactic', [2.5e20, 0, -1e19]);
    const p = [123.456, -789.012, 3.5];
    for (const a of FRAME_ORDER) {
      for (const b of FRAME_ORDER) {
        const mid = f.toFrame(p, a, b);
        const q = f.toFrame(mid, b, a);
        const peakMeters =
          Math.max(Math.abs(mid[0]), Math.abs(mid[1]), Math.abs(mid[2])) * f.unitsPerFrame(b) +
          Math.max(...p.map(Math.abs)) * f.unitsPerFrame(a);
        const bound = (8 * Number.EPSILON * peakMeters) / f.unitsPerFrame(a);
        for (let i = 0; i < 3; i++) expect(Math.abs(q[i] - p[i])).toBeLessThanOrEqual(bound);
      }
    }
  });

  it('same-origin frames round-trip almost exactly', () => {
    const f = new FrameStack(); // helio, galactic, cosmic all share the Sun origin
    const p = [1.2345, -6.789, 0.5];
    const q = f.toFrame(f.toFrame(p, 'helio', 'cosmic'), 'cosmic', 'helio');
    for (let i = 0; i < 3; i++) expect(q[i]).toBeCloseTo(p[i], 12);
  });

  it('writes into `out` without allocating, and may alias the input', () => {
    const f = new FrameStack();
    const v = new Float64Array([1, 2, 3]);
    expect(f.toFrame(v, 'helio', 'planet', v)).toBe(v);
    expect(v[0]).toBeCloseTo(METERS.au / METERS.km, 3);
  });

  it('fires origin-change listeners once per real move and supports unsubscribe', () => {
    const f = new FrameStack();
    const spy = vi.fn();
    const off = f.onOriginChange(spy);
    f.setOrigin('planet', [1, 2, 3]);
    f.setOrigin('planet', [1, 2, 3]); // no-op
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('planet');
    off();
    f.setOrigin('planet', [4, 5, 6]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refuses to move the root origin', () => {
    expect(() => new FrameStack().setOrigin('cosmic', [1, 0, 0])).toThrow();
  });

  it('ecliptic north is a unit vector tilted ~23.44 deg from the celestial pole', () => {
    const [x, y, z] = ECLIPTIC_NORTH;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    expect((Math.acos(z) * 180) / Math.PI).toBeCloseTo(23.4393, 3);
  });
});