/**
 * GPT-6 — Cosmoscope exoplanet systems, stage 2.
 *
 * Static NASA host catalog + focused schematic orbital display.
 * The host positions are J2000 ICRS XYZ in parsecs.
 * The orbit geometry is local to the host, in AU.
 *
 * One LineSegments draw call, one Points draw call.
 * No per-frame vertex updates, requests, or allocations.
 */

import * as THREE from 'three';

import type {
  CosmoCamera,
  FrameApi,
} from '../../core/camera';
import type { FrameId } from '../../core/frames';
import type {
  ResolvedTarget,
  ScaleLayer,
} from '../../core/layers';

import {
  AU_METRES,
  getExoplanetSystem,
  type ExoplanetSystem,
} from './catalog';

import { PARSEC_METRES } from '../stars/catalog';

import {
  approachDistanceAu,
  buildOrbitGeometry,
} from './orbits';

const MAX_VIEW_DISTANCE_AU = 3000;
const MIN_VIEW_DISTANCE_AU = 300;

export class ExoplanetSystemsLayer implements ScaleLayer {
  readonly idPrefix = 'exo';
  readonly frames: FrameId[] = ['galactic'];
  readonly renderBudget = 2;
  readonly object3D = new THREE.Group();

  private readonly camera: CosmoCamera;
  private readonly scene: THREE.Scene;

  private active = false;
  private focused: ExoplanetSystem | null = null;
  private outerRadiusAu = 0;

  private orbitGeometry: THREE.BufferGeometry | null = null;
  private planetGeometry: THREE.BufferGeometry | null = null;

  private readonly orbitMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });

  private readonly planetMaterial = new THREE.PointsMaterial({
    size: 6,
    sizeAttenuation: false,
    vertexColors: true,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    opacity: 1,
    toneMapped: false,
  });

  private readonly scratch = new THREE.Vector3();

  constructor(scene: THREE.Scene, camera: CosmoCamera) {
    this.scene = scene;
    this.camera = camera;

    this.object3D.name = 'gpt6-exoplanet-systems';
    this.object3D.visible = false;
    this.object3D.frustumCulled = false;
  }

  /**
   * Select one known host. Null removes the active system.
   * Never constructs geometry during the frame update.
   */
  setFocus(id: string | null): boolean {
    const next = id ? getExoplanetSystem(id) ?? null : null;

    if (next?.id === this.focused?.id) return !!next;

    this.clearVisuals();
    this.focused = next;

    if (!next) {
      this.object3D.visible = false;
      return false;
    }

    const data = buildOrbitGeometry(next);
    this.outerRadiusAu = data.outerRadiusAu;

    this.orbitGeometry = new THREE.BufferGeometry();
    this.orbitGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        data.linePositions,
        3,
      ),
    );
    this.orbitGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(
        data.lineColors,
        3,
      ),
    );
    this.orbitGeometry.computeBoundingSphere();

    const lines = new THREE.LineSegments(
      this.orbitGeometry,
      this.orbitMaterial,
    );

    lines.name = `${next.hostname} schematic orbital rings`;
    lines.frustumCulled = false;
    this.object3D.add(lines);

    this.planetGeometry = new THREE.BufferGeometry();
    this.planetGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        data.pointPositions,
        3,
      ),
    );
    this.planetGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(
        data.pointColors,
        3,
      ),
    );
    this.planetGeometry.computeBoundingSphere();

    const points = new THREE.Points(
      this.planetGeometry,
      this.planetMaterial,
    );

    points.name = `${next.hostname} schematic planet markers`;
    points.frustumCulled = false;
    this.object3D.add(points);

    return true;
  }

  resolveTarget(id: string): ResolvedTarget | null {
    const system = getExoplanetSystem(id);
    if (!system) return null;

    return {
      frameId: 'galactic',
      worldPos: new Float64Array(system.positionPc),
      approachRadius:
        approachDistanceAu(system) *
        AU_METRES / PARSEC_METRES,
    };
  }

  enter(_api: FrameApi): void {
    this.active = true;

    if (!this.object3D.parent) {
      this.scene.add(this.object3D);
    }
  }

  exit(): void {
    this.active = false;
    this.object3D.visible = false;
    this.object3D.removeFromParent();
  }

  update(
    _dt: number,
    _distanceMetres: number,
    _api: FrameApi,
  ): void {
    const system = this.focused;

    if (!this.active || !system) {
      this.object3D.visible = false;
      return;
    }

    // float64 relative subtraction occurs inside Claude's
    // CosmoCamera, before conversion to render coordinates.
    this.camera.toCameraRelative(
      system.positionPc,
      'galactic',
      this.scratch,
    );

    const distanceMetres =
      this.scratch.length() * this.camera.renderScale;

    const cutoffAu = Math.max(
      MIN_VIEW_DISTANCE_AU,
      Math.min(
        MAX_VIEW_DISTANCE_AU,
        this.outerRadiusAu * 40,
      ),
    );

    if (
      !Number.isFinite(distanceMetres) ||
      distanceMetres > cutoffAu * AU_METRES
    ) {
      this.object3D.visible = false;
      return;
    }

    this.object3D.visible = true;
    this.object3D.position.copy(this.scratch);

    // Geometry is in local AU. Only the group's transform
    // changes per frame; vertex buffers remain static.
    this.object3D.scale.setScalar(
      AU_METRES / this.camera.renderScale,
    );
  }

  private clearVisuals(): void {
    this.object3D.clear();

    this.orbitGeometry?.dispose();
    this.planetGeometry?.dispose();

    this.orbitGeometry = null;
    this.planetGeometry = null;
    this.outerRadiusAu = 0;
  }

  dispose(): void {
    this.exit();
    this.clearVisuals();
    this.orbitMaterial.dispose();
    this.planetMaterial.dispose();
    this.focused = null;
  }
}

export function makeExoplanetSystemsLayer(
  scene: THREE.Scene,
  camera: CosmoCamera,
): ExoplanetSystemsLayer {
  return new ExoplanetSystemsLayer(scene, camera);
}
