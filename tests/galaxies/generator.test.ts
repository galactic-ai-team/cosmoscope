import { describe, expect, it } from 'vitest';
import { createProceduralGalaxy } from '../../src/galaxies/generator';
import type { GalaxyGeneratorParams } from '../../src/layers/galaxyProfiles';

describe('Procedural Galaxy Generator', () => {
  const testProfile: GalaxyGeneratorParams = {
    id: 'm31',
    name: 'Andromeda Galaxy',
    morphology: 'Sb',
    diameterLy: 220000,
    inclinationDeg: 77,
    positionAngleDeg: 38,
    armCount: 2,
    pitchDeg: 12,
    bulgeFraction: 0.3,
    dustStrength: 0.8,
    starCountNear: 5000,
    seed: 12345
  };

  it('generates deterministic positions with the same seed', () => {
    const gal1 = createProceduralGalaxy(testProfile);
    const gal2 = createProceduralGalaxy(testProfile);

    const mesh1 = gal1.container.children[0] as THREE.Points;
    const mesh2 = gal2.container.children[0] as THREE.Points;

    const pos1 = (mesh1.geometry.getAttribute('position') as THREE.BufferAttribute).array;
    const pos2 = (mesh2.geometry.getAttribute('position') as THREE.BufferAttribute).array;

    expect(pos1[0]).toBe(pos2[0]);
    expect(pos1[100] || 0).toBe(pos2[100] || 0);

    gal1.dispose();
    gal2.dispose();
  });

  it('supports LOD tier draw range adjustments without rebuilding', () => {
    const galaxy = createProceduralGalaxy(testProfile);
    const mesh = galaxy.container.children[0] as THREE.Points;

    expect(mesh.geometry.drawRange.count).toBe(5000); // Full tier 0

    galaxy.setLODTier(2);
    expect(mesh.geometry.drawRange.count).toBeLessThan(5000);
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);

    galaxy.dispose();
  });
});