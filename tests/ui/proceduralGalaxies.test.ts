import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { skyBasis, tierFor } from '../../src/ui/proceduralGalaxies';

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
});
