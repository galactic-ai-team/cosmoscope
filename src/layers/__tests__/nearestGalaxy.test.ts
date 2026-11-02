// src/layers/__tests__/nearestGalaxy.test.ts — free-fly's nearest-galaxy query (owner: Claude).
import { describe, expect, it } from 'vitest';

import { GALAXY_ENTRIES, clustersRoute, nearestGalaxy } from '../galaxies';

// The resolver is the source of truth for positions; queries are built from it.

function pos(id: string): Float64Array {
  const r = clustersRoute.resolveTarget(id);
  if (!r) throw new Error(`no target ${id}`);
  return Float64Array.from(r.worldPos as ArrayLike<number>);
}

describe('nearestGalaxy', () => {
  it('finds Andromeda when you are next to it', () => {
    const m31 = pos('galaxy:messier:M31');
    const near = Float64Array.from(m31, (v, i) => v + (i === 0 ? 1_000 : 0)); // 1 kpc off
    const g = nearestGalaxy(near);
    expect(g?.id).toMatch(/galaxy:messier:M(31|32|110)/); // M31 or one of its satellites
    expect(g!.distancePc).toBeLessThan(10_000);
  });

  it('returns the exact body at its own centre, with a positive radius', () => {
    const m33 = pos('galaxy:messier:M33');
    const g = nearestGalaxy(m33);
    expect(g?.id).toBe('galaxy:messier:M33');
    expect(g!.distancePc).toBeCloseTo(0, 6);
    expect(g!.radiusPc).toBeGreaterThan(0);
  });

  it('reuses one result object (no per-frame allocation)', () => {
    const a = nearestGalaxy(pos('galaxy:messier:M31'));
    const b = nearestGalaxy(pos('galaxy:messier:M33'));
    expect(a).toBe(b);
  });

  it('covers the whole catalog: every body is its own nearest at its centre', () => {
    let checked = 0;
    for (const e of GALAXY_ENTRIES) {
      const r = clustersRoute.resolveTarget(e.id);
      if (!r) continue;
      const g = nearestGalaxy(r.worldPos as ArrayLike<number>);
      expect(g!.distancePc).toBeCloseTo(0, 3);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
