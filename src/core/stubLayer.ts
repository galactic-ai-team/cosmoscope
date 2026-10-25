// src/core/stubLayer.ts — placeholder layer (owner: Claude).
//
// Something real for Dee's ScaleLayer registry to register before any data
// lane lands: a wireframe Earth-sized sphere in the 'planet' frame and a
// 1 AU ring in the 'helio' frame. Replace or delete once real layers exist.
// The minimal shape below is NOT the ScaleLayer contract; Dee owns that.

import * as THREE from 'three';

import type { CosmoCamera } from './camera';
import type { FrameId } from './frames';

export interface StubLayer {
  readonly id: string;
  readonly frame: FrameId;
  readonly object3D: THREE.Object3D;
  update(camera: CosmoCamera): void;
  dispose(): void;
}

const ORIGIN = [0, 0, 0] as const;
const EARTH_RADIUS_KM = 6371;

/** Wireframe sphere of Earth's radius at the planet-frame origin. */
export function createStubPlanetLayer(): StubLayer {
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS_KM, 32, 16); // km = planet units
  const material = new THREE.MeshBasicMaterial({ color: 0x4fa3ff, wireframe: true });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    id: 'stub-planet',
    frame: 'planet',
    object3D: mesh,
    update(camera) {
      camera.toCameraRelative(ORIGIN, 'planet', mesh.position);
      mesh.scale.setScalar(camera.layerScale('planet'));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** 1 AU ring around the helio origin, in the shared ICRS axes (equatorial plane). */
export function createStubOrbitLayer(): StubLayer {
  const SEGMENTS = 256;
  const pts = new Float32Array(SEGMENTS * 3);
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    pts[i * 3] = Math.cos(a); // AU = helio units
    pts[i * 3 + 1] = Math.sin(a);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xffd166 });
  const ring = new THREE.LineLoop(geometry, material);
  return {
    id: 'stub-orbit',
    frame: 'helio',
    object3D: ring,
    update(camera) {
      camera.toCameraRelative(ORIGIN, 'helio', ring.position);
      ring.scale.setScalar(camera.layerScale('helio'));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}