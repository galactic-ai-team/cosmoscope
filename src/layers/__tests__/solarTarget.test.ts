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

  it('resolves moons where they are drawn, with their rendered radius', () => {
    const camera = new CosmoCamera(new FrameStack(), undefined, 'galactic');
    const scene = new THREE.Scene();
    const layer = new SolarSystemLayer(scene, camera);
    layer.enter(camera);
    layer.update(3.7, 1); // spin the planets and moon pivots away from zero
    const r = layer.resolveTarget('moon:earth-moon')!;
    expect(r).not.toBeNull();
    expect(r.frameId).toBe('helio');
    expect(r.radius).toBeGreaterThan(0);

    // Where three.js actually draws it, in the layer's (helio, AU) coordinates.
    const container = scene.getObjectByName('SolarSystemLayer')!;
    container.position.set(0, 0, 0);
    container.scale.setScalar(1);
    container.updateMatrixWorld(true);
    const moon = new THREE.Vector3();
    const earth = scene.getObjectByName('planet:earth')!;
    const moonMesh = earth.children.flatMap((c) => c.children)[0] as THREE.Mesh;
    moonMesh.getWorldPosition(moon);
    expect(r.worldPos[0]).toBeCloseTo(moon.x, 9);
    expect(r.worldPos[1]).toBeCloseTo(moon.y, 9);
    expect(r.worldPos[2]).toBeCloseTo(moon.z, 9);
  });

  it('still returns null for unknown ids', () => {
    const layer = new SolarSystemLayer(new THREE.Scene(), new CosmoCamera(new FrameStack(), undefined, 'galactic'));
    expect(layer.resolveTarget('moon:nope')).toBeNull();
  });
});

describe('moon picks route to a flight', () => {
  it('kindFromId knows moon ids and flies them like planets', async () => {
    const { kindFromId, flightKind } = await import('../../ui/flyLink');
    expect(kindFromId('moon:earth-moon')).toBe('moon');
    expect(flightKind('moon')).toBe('planet');
  });
});
