import { describe, it, expect } from 'vitest';
import { orbitUpFor, CELESTIAL_NORTH } from '../../src/ui/orbitUp';
import { ECLIPTIC_NORTH } from '../../src/core/frames';

describe('orbitUpFor', () => {
  it('uses ecliptic north for solar-system frames', () => {
    expect(orbitUpFor('helio')).toBe(ECLIPTIC_NORTH);
    expect(orbitUpFor('planet')).toBe(ECLIPTIC_NORTH);
  });
  it('keeps the celestial pole for stars and beyond', () => {
    expect(orbitUpFor('galactic')).toBe(CELESTIAL_NORTH);
    expect(orbitUpFor('cosmic')).toBe(CELESTIAL_NORTH);
  });
  it('returns unit vectors', () => {
    for (const v of [orbitUpFor('helio'), orbitUpFor('cosmic')]) {
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 9);
    }
  });
});
