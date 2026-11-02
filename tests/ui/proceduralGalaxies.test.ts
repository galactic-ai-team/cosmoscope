import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { countGalaxyPoints, createProceduralGalaxiesLayer, skyBasis, tierFor } from '../../src/ui/proceduralGalaxies';
import { createProceduralGalaxy } from '../../src/galaxies/generator';
import { GALAXY_PROFILES, generatorParamsFor } from '../../src/layers/galaxyProfiles';
import type { CosmoCamera, FrameApi } from '../../src/core/camera';
import type { ResolvedTarget } from '../../src/core/layers';

describe('proceduralGalaxies glue (Lumi)', () => {
  it('skyBasis: Z points back at the Sun, X is sky north, Y is sky east', () => {
    // A galaxy on the celestial equator at RA 0: r = +x.
    const m = skyBasis([1000, 0, 0]);
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
    m.extractBasis(x, y, z);
    expect(z.x).toBeCloseTo(-1);           // toward the Sun
    expect(x.z).toBeCloseTo(1);            // north = celestial pole
    expect(y.y).toBeCloseTo(1);            // east = increasing RA
    expect(new THREE.Vector3().crossVectors(x, y).dot(z)).toBeCloseTo(1); // right-handed
  });

  it('skyBasis survives a galaxy at the celestial pole', () => {
    const m = skyBasis([0, 0, 500]);
    expect(m.determinant()).toBeCloseTo(1);
  });

  it('tierFor steps down with distance in diameters', () => {
    expect(tierFor(1, 1)).toBe(0);
    expect(tierFor(5, 1)).toBe(1);
    expect(tierFor(20, 1)).toBe(2);
    expect(tierFor(1000, 1)).toBe(3);
  });

  it('renderBudget reports the star + dust points actually generated', () => {
    const scene = new THREE.Scene();
    const resolve = (id: string): ResolvedTarget => ({
      frameId: 'galactic',
      worldPos: new Float64Array([1000, 2000, 3000]),
      approachRadius: 10,
    }) as ResolvedTarget;
    const layer = createProceduralGalaxiesLayer(scene, {} as CosmoCamera, resolve);
    expect(layer.renderBudget).toBe(0); // nothing built before enter()
    layer.enter({} as FrameApi);
    let expected = 0;
    for (const id of Object.keys(GALAXY_PROFILES)) {
      const params = generatorParamsFor(id);
      if (!params) continue;
      expected += countGalaxyPoints(createProceduralGalaxy(params).container);
    }
    expect(expected).toBeGreaterThan(0);
    expect(layer.renderBudget).toBe(expected);
    layer.exit();
  });

  it('countGalaxyPoints counts the tier-0 draw range plus dust', () => {
    const g = createProceduralGalaxy(generatorParamsFor('galaxy:messier:M31')!);
    const pts: THREE.Points[] = [];
    g.container.traverse((o) => { if (o instanceof THREE.Points) pts.push(o); });
    const stars = pts[0].geometry.getAttribute('position').count;
    const dust = pts.length > 1 ? pts[1].geometry.getAttribute('position').count : 0;
    expect(dust).toBeGreaterThan(0);
    expect(countGalaxyPoints(g.container)).toBe(stars + dust);
  });
});
