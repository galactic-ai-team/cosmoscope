import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  MAX_ORBIT_PLANETS,
  ORBIT_SEGMENTS,
  approachDistanceAu,
  buildOrbitGeometry,
  drawableOrbits,
} from './orbits';

import type { ExoplanetSystem } from './catalog';

const system: ExoplanetSystem = {
  id: 'exo:Example',
  hostname: 'Example',
  positionPc: [3, 4, 0],
  distancePc: 5,
  raDeg: 53.13010235,
  decDeg: 0,
  starCount: 1,
  planets: [
    {
      name: 'Example c',
      periodDays: 200,
      semiMajorAu: 2,
      radiusEarth: 3,
      massEarth: null,
    },
    {
      name: 'Example b',
      periodDays: 20,
      semiMajorAu: 0.5,
      radiusEarth: 1,
      massEarth: null,
    },
    {
      name: 'Example d',
      periodDays: null,
      semiMajorAu: null,
      radiusEarth: null,
      massEarth: null,
    },
  ],
};

describe('schematic exoplanet orbits', () => {
  it('sorts drawable planets by semi-major axis', () => {
    expect(
      drawableOrbits(system).map((p) => p.name),
    ).toEqual(['Example b', 'Example c']);
  });

  it('does not invent orbits for missing parameters', () => {
    expect(drawableOrbits(system)).toHaveLength(2);
    expect(
      buildOrbitGeometry(system).planetNames,
    ).not.toContain('Example d');
  });

  it('uses an arrival distance derived from orbit scale', () => {
    expect(approachDistanceAu(system)).toBe(3);
  });

  it('generates bounded geometry for each ring', () => {
    const geometry = buildOrbitGeometry(system);

    expect(geometry.linePositions.length).toBe(
      2 * ORBIT_SEGMENTS * 2 * 3,
    );
    expect(geometry.lineColors.length).toBe(
      geometry.linePositions.length,
    );
    expect(geometry.pointPositions.length).toBe(9);
    expect(geometry.pointColors.length).toBe(9);
    expect(geometry.outerRadiusAu).toBe(2);
  });

  it('places the host marker at the origin', () => {
    const geometry = buildOrbitGeometry(system);
    expect(
      Array.from(geometry.pointPositions.slice(0, 3)),
    ).toEqual([0, 0, 0]);
  });

  it('creates closed, finite orbital rings', () => {
    const geometry = buildOrbitGeometry(system);

    expect(
      Array.from(geometry.linePositions).every(
        Number.isFinite,
      ),
    ).toBe(true);

    const p = geometry.linePositions;
    const firstX = p[0];
    const firstY = p[1];

    const last = ORBIT_SEGMENTS * 6 - 3;

    expect(p[last]).toBeCloseTo(firstX, 5);
    expect(p[last + 1]).toBeCloseTo(firstY, 5);
  });

  it('is deterministic across builds', () => {
    const a = buildOrbitGeometry(system);
    const b = buildOrbitGeometry(system);

    expect(a.linePositions).toEqual(b.linePositions);
    expect(a.pointPositions).toEqual(b.pointPositions);
  });

  it('respects planet and segment budgets', () => {
    const many: ExoplanetSystem = {
      ...system,
      planets: Array.from({ length: 60 }, (_, i) => ({
        name: `Planet ${i}`,
        periodDays: null,
        semiMajorAu: i + 1,
        radiusEarth: null,
        massEarth: null,
      })),
    };

    const geometry = buildOrbitGeometry(many, 999);

    expect(geometry.planetNames.length).toBeLessThanOrEqual(
      MAX_ORBIT_PLANETS,
    );
    expect(geometry.linePositions.length).toBeLessThanOrEqual(
      MAX_ORBIT_PLANETS * 96 * 6,
    );
  });

  it('preserves a host marker when no orbital data exists', () => {
    const unknown: ExoplanetSystem = {
      ...system,
      planets: system.planets.map((p) => ({
        ...p,
        semiMajorAu: null,
      })),
    };

    const geometry = buildOrbitGeometry(unknown);

    expect(geometry.linePositions.length).toBe(0);
    expect(geometry.pointPositions.length).toBe(3);
    expect(approachDistanceAu(unknown)).toBe(0.25);
  });
});
