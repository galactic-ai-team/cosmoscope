import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { StellarConstellations } from '../../src/layers/stars/constellations';
import type { CosmoCamera } from '../../src/core/camera';
import type { HygRow } from '../../src/layers/stars/catalog';

const fakeCamera = {
  toCameraRelative(p: Float64Array, _f: string, out: THREE.Vector3) { return out.set(p[0], p[1], p[2]); },
} as unknown as CosmoCamera;

const row = (id: number, name: string, x: number): HygRow => [id, x, 0, 0, 0, 0, 'M', name, [], Math.abs(x)];

function make(): { c: StellarConstellations; lines: () => THREE.LineSegments } {
  const c = new StellarConstellations(fakeCamera);
  c.build([row(1, 'Betelgeuse', 100), row(2, 'Bellatrix', 110)]);
  return { c, lines: () => c.object3D.children[0] as THREE.LineSegments };
}

describe('StellarConstellations mode (Lumi toggle on GPT-6 layer)', () => {
  it('auto keeps the 30-100 ly fade', () => {
    const { c, lines } = make();
    expect(c.getMode()).toBe('auto');
    expect(c.segmentCount).toBe(1);
    c.update(10, 1);
    expect(lines().visible).toBe(true);
    c.update(150, 1);
    expect(lines().visible).toBe(false);
  });
  it('on shows at any distance and star fade', () => {
    const { c, lines } = make();
    c.setMode('on');
    c.update(5000, 0);
    expect(lines().visible).toBe(true);
    expect((lines().material as THREE.LineBasicMaterial).opacity).toBeCloseTo(0.35);
  });
  it('off hides even up close', () => {
    const { c, lines } = make();
    c.setMode('off');
    c.update(1, 1);
    expect(lines().visible).toBe(false);
    c.setMode('auto');
    c.update(1, 1);
    expect(lines().visible).toBe(true);
  });
});
