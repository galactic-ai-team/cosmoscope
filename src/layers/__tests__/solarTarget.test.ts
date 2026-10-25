// Lumi: a fly-to must aim at where the planet really is, even when the
// solar system layer hasn't updated yet (it only updates in the 'helio'
// frame, and the app starts in 'galactic').
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FrameStack } from '../../core/frames';
import { CosmoCamera } from '../../core/camera';
import { SolarSystemLayer } from '../solarSystemLayer';

describe('SolarSystemLayer.resolveTarget', () => {
  it('returns the Mars mesh position before the first update', () => {
    const camera = new CosmoCamera(new FrameStack(), undefined, 'galactic');
    const scene = new THREE.Scene();
    const layer = new SolarSystemLayer(scene, camera);
    const r = layer.resolveTarget('planet:mars')!;
    layer.enter(camera);
    layer.update(0, 1);
    const mars = scene.getObjectByName('planet:mars')!;
    expect(r.worldPos[0]).toBeCloseTo(mars.position.x, 9);
    expect(r.worldPos[2]).toBeCloseTo(mars.position.z, 9);
    // Not the placeholder (semi-major axis on +x).
    expect(Math.abs(r.worldPos[0] - 1.524) + Math.abs(r.worldPos[2])).toBeGreaterThan(1e-3);
  });
});
