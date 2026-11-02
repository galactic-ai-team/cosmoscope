/**
 * GPT-6 — schematic exoplanet orbital geometry.
 *
 * Pure data construction. No DOM, GPU, network, or animation.
 * Positions are local to the host star, in astronomical units.
 *
 * Published semi-major axes supply circle radii.
 * Orbital planes, phases and circularity are illustrative.
 */

import type {
  ExoplanetSystem,
} from './catalog';

export const MAX_ORBIT_PLANETS = 12;
export const ORBIT_SEGMENTS = 48;
export const MAX_ORBIT_RADIUS_AU = 100;

export interface OrbitGeometryData {
  linePositions: Float32Array;
  lineColors: Float32Array;
  pointPositions: Float32Array;
  pointColors: Float32Array;
  planetNames: string[];
  outerRadiusAu: number;
}

const COLORS = [
  [0.42, 0.80, 1.00],
  [1.00, 0.67, 0.42],
  [0.58, 0.95, 0.75],
  [0.94, 0.65, 0.98],
  [0.98, 0.86, 0.50],
  [0.65, 0.72, 1.00],
] as const;

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function drawableOrbits(
  system: ExoplanetSystem,
  limit = MAX_ORBIT_PLANETS,
): Array<{ name: string; radiusAu: number }> {
  return system.planets
    .filter((planet) =>
      planet.semiMajorAu !== null &&
      Number.isFinite(planet.semiMajorAu) &&
      planet.semiMajorAu > 0 &&
      planet.semiMajorAu <= MAX_ORBIT_RADIUS_AU,
    )
    .map((planet) => ({
      name: planet.name,
      radiusAu: planet.semiMajorAu as number,
    }))
    .sort((a, b) =>
      a.radiusAu - b.radiusAu ||
      a.name.localeCompare(b.name),
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function approachDistanceAu(
  system: ExoplanetSystem,
): number {
  const orbits = drawableOrbits(system);
  const outer = orbits.length
    ? orbits[orbits.length - 1].radiusAu
    : 0;

  // Dee's FlyToController multiplies approachRadius by
  // three for its 'orbit' approach. The resulting arrival
  // is at least 0.75 AU from the host.
  return Math.max(0.25, outer * 1.5);
}

export function buildOrbitGeometry(
  system: ExoplanetSystem,
  segments = ORBIT_SEGMENTS,
): OrbitGeometryData {
  const countSegments = Math.max(
    8,
    Math.min(96, Math.floor(segments)),
  );
  const planets = drawableOrbits(system);
  const n = planets.length;

  const linePositions =
    new Float32Array(n * countSegments * 2 * 3);
  const lineColors =
    new Float32Array(linePositions.length);

  // One host marker plus one marker per drawable planet.
  const pointPositions = new Float32Array((n + 1) * 3);
  const pointColors = new Float32Array((n + 1) * 3);

  // Warm white central host marker.
  pointColors.set([1, 0.92, 0.68], 0);

  let cursor = 0;
  let colorCursor = 0;

  for (let i = 0; i < n; i++) {
    const { name, radiusAu } = planets[i];
    const color = COLORS[i % COLORS.length];

    // All orbit orientations/phases are deliberately schematic.
    const seed = hash(`${system.id}:${name}`);
    const phase = (seed / 0xffffffff) * Math.PI * 2;

    for (let j = 0; j < countSegments; j++) {
      const a = (j / countSegments) * Math.PI * 2;
      const b = ((j + 1) / countSegments) * Math.PI * 2;

      linePositions.set([
        radiusAu * Math.cos(a),
        radiusAu * Math.sin(a),
        0,
        radiusAu * Math.cos(b),
        radiusAu * Math.sin(b),
        0,
      ], cursor);

      cursor += 6;

      lineColors.set([
        ...color, ...color,
      ], colorCursor);

      colorCursor += 6;
    }

    pointPositions.set([
      radiusAu * Math.cos(phase),
      radiusAu * Math.sin(phase),
      0,
    ], (i + 1) * 3);

    pointColors.set(color, (i + 1) * 3);
  }

  return {
    linePositions,
    lineColors,
    pointPositions,
    pointColors,
    planetNames: planets.map((planet) => planet.name),
    outerRadiusAu: n ? planets[n - 1].radiusAu : 0,
  };
}
