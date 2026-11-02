// src/ui/proceduralGalaxies.ts (Lumi, glue)
// Puts Gemini's procedural galaxies (src/galaxies/generator.ts) into the
// scene for every galaxy with one of Nova's verified profiles
// (src/layers/galaxyProfiles.ts). This file only does the plumbing:
//   - position: the galaxies layer's resolveTarget worldPos (galactic
//     frame = Sun-centred ICRS cartesian, parsecs) -> camera-relative
//   - scale: generator authors in metres -> render units
//   - orientation: generator disk is local XY with R = Rz(PA)·Rx(incl);
//     here local X = sky north, Y = sky east, Z = toward the Sun, so
//     incl 0 is face-on and PA is measured north through east.
//   - LOD: tier from camera distance / galaxy diameter (placeholder until
//     Dee's galaxy LOD tiers land), hidden when it would be < ~2 px.
// No generation or profile logic lives here.

import * as THREE from 'three';
import type { CosmoCamera, FrameApi } from '../core/camera';
import { METERS, type FrameId } from '../core/frames';
import type { ResolvedTarget, ScaleLayer } from '../core/layers';
import type { LodState } from '../core/lod';
import { createProceduralGalaxy, type GeneratedGalaxy } from '../galaxies/generator';
import { GALAXY_PROFILES, generatorParamsFor } from '../layers/galaxyProfiles';

interface Placed {
  id: string;
  galaxy: GeneratedGalaxy;
  posPc: Float64Array;
  diameterM: number;
}

/** Sky basis at a Sun-centred ICRS direction: X north, Y east, Z toward the Sun. */
export function skyBasis(posPc: ArrayLike<number>, out = new THREE.Matrix4()): THREE.Matrix4 {
  const r = new THREE.Vector3(posPc[0], posPc[1], posPc[2]).normalize();
  const pole = new THREE.Vector3(0, 0, 1);
  const east = new THREE.Vector3().crossVectors(pole, r);
  if (east.lengthSq() < 1e-12) east.set(0, 1, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(r, east).normalize();
  const toSun = r.clone().negate();
  return out.makeBasis(north, east, toSun);
}

export function tierFor(distanceM: number, diameterM: number): number {
  const k = distanceM / diameterM;
  if (k < 3) return 0;
  if (k < 10) return 1;
  if (k < 40) return 2;
  return 3;
}

/**
 * Star + dust points a generated galaxy actually holds at tier 0: each
 * Points' draw range (stars start at tierCounts[0]) capped by its buffer.
 */
export function countGalaxyPoints(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((o) => {
    if (!(o instanceof THREE.Points)) return;
    const g = o.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    total += Math.min(pos.count, g.drawRange.count);
  });
  return total;
}

export function createProceduralGalaxiesLayer(
  scene: THREE.Scene,
  camera: CosmoCamera,
  resolve: (id: string) => ResolvedTarget | null,
): ScaleLayer {
  const group = new THREE.Group();
  group.name = 'procedural-galaxies';
  const placed: Placed[] = [];
  let built = false;
  // Real point count (stars after the tier-0 count + dust), set in build()
  // so FrameBudget sees an honest renderBudget (Nova's #65 review).
  let pointBudget = 0;

  function build(): void {
    built = true;
    for (const id of Object.keys(GALAXY_PROFILES)) {
      const params = generatorParamsFor(id);
      const target = resolve(id);
      if (!params || !target || target.frameId !== 'galactic') continue;
      const galaxy = createProceduralGalaxy(params);
      const holder = galaxy.container;
      holder.matrixAutoUpdate = true;
      holder.quaternion.setFromRotationMatrix(skyBasis(target.worldPos));
      holder.frustumCulled = false;
      holder.traverse((o) => { o.frustumCulled = false; });
      group.add(holder);
      pointBudget += countGalaxyPoints(holder);
      placed.push({
        id,
        galaxy,
        posPc: Float64Array.from(target.worldPos as ArrayLike<number>),
        diameterM: params.diameterLy * METERS.ly,
      });
    }
  }

  const frame: FrameId = 'galactic';
  return {
    idPrefix: 'galaxy-mesh',
    frames: ['galactic', 'cosmic'],
    get renderBudget(): number {
      return pointBudget;
    },
    enter(_api: FrameApi): void {
      if (!built) build();
      scene.add(group);
    },
    exit(): void {
      group.removeFromParent();
    },
    update(_dt: number, _d: number, _api: FrameApi, _lod: Readonly<LodState>): void {
      const s = camera.layerScale(frame) / METERS.pc; // render units per metre
      const viewportH = window.innerHeight;
      const fovRad = THREE.MathUtils.degToRad(camera.three.fov);
      for (const p of placed) {
        const c = p.galaxy.container;
        camera.toCameraRelative(p.posPc, frame, c.position);
        c.scale.setScalar(s);
        const dist = camera.distanceTo({ frame, position: p.posPc });
        const px = (p.diameterM / Math.max(dist, 1)) / fovRad * viewportH;
        c.visible = px > 2;
        if (c.visible) p.galaxy.setLODTier(tierFor(dist, p.diameterM));
      }
    },
    resolveTarget: () => null,
  };
}
