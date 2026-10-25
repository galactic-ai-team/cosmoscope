
/**
 * GPT-6 — Cosmoscope Stellar Neighborhood.
 *
 * Coordinates: ICRS/J2000 equatorial xyz,
 * Sun-centered, measured in parsecs.
 *
 * Uses Claude's galactic-scale frame,
 * Dee's ScaleLayer registry,
 * and Lumi's searchable catalog.
 *
 * One draw call, no allocations in update(),
 * one static data request.
 */

import * as THREE from 'three';
import type { FrameId } from '../../core/frames';
import type { CosmoCamera, FrameApi } from '../../core/camera';
import type { ScaleLayer, ResolvedTarget } from '../../core/layers';
import {
  loadHygStars,
  PARSEC_METRES,
  type HygRow,
} from './catalog';
import { StellarLabels } from './labels';

const LIGHT_YEAR_METRES = 9.4607304725808e15;

export const STAR_FADE_START_LY = 60_000;
export const STAR_HANDOFF_LY = 100_000;

const SOLAR_RADIUS_PC = 6.957e8 / PARSEC_METRES;

const STAR_VS = /* glsl */ `
  attribute vec3 color;
  attribute float aMagnitude;

  uniform float uDpr;
  varying vec3 vColor;

  void main() {
    vColor = color;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    float brightness = (6.0 - aMagnitude) * 0.85;
    gl_PointSize = clamp(
      brightness * uDpr,
      1.1 * uDpr,
      7.0 * uDpr
    );
  }
`;

const STAR_FS = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;

  void main() {
    float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float core = pow(max(1.0 - r, 0.0), 1.65);

    gl_FragColor = vec4(vColor * 1.2, core * uOpacity);
  }
`;

/** Approximate stellar colors from B−V color index. */
const PALETTE = [
  [-0.4, new THREE.Color(0x7faaff)],
  [0.00, new THREE.Color(0xb1ceff)],
  [0.35, new THREE.Color(0xe4edff)],
  [0.75, new THREE.Color(0xfff0cf)],
  [1.25, new THREE.Color(0xffce91)],
  [2.00, new THREE.Color(0xff8657)],
] as const;

function bvColor(ci: number, out: THREE.Color): void {
  for (let i = 1; i < PALETTE.length; i++) {
    if (ci <= PALETTE[i][0]) {
      const [a, ca] = PALETTE[i - 1];
      const [b, cb] = PALETTE[i];

      const f = Math.max(
        0,
        Math.min(1, (ci - a) / (b - a)),
      );

      out.copy(ca).lerp(cb, f);
      return;
    }
  }

  out.copy(PALETTE[PALETTE.length - 1][1]);
}

export class StellarNeighborhood implements ScaleLayer {
  readonly idPrefix = 'star';
  readonly frames: FrameId[] = ['galactic'];
  readonly renderBudget = 2048;
  readonly object3D = new THREE.Group();

  private rows: HygRow[] = [];
  private readonly byId = new Map<string, number>();

  private mesh:
    THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
    | null = null;

  private loadPromise: Promise<number> | null = null;
  private active = false;
  private level = 0;

  // Reusable scratch objects, never allocated per frame.
  private readonly temp = new THREE.Vector3();
  private readonly pos = new Float64Array(3);
  private readonly color = new THREE.Color();

  private readonly camera: CosmoCamera;

  private readonly labels: StellarLabels;

  constructor(
    private readonly scene: THREE.Scene,
    camera: CosmoCamera,
  ) {
    this.camera = camera;
    this.labels = new StellarLabels(camera);
    this.object3D.add(this.labels.object3D);
    this.object3D.name = 'gpt6-stellar-neighborhood';
  }

  /**
   * Load once before enabling stellar search/flyTo.
   * Repeated calls reuse the same promise.
   */
  load(url = '/data/hyg-v41.json'): Promise<number> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = loadHygStars(url)
      .then((rows) => {
        this.rows = rows;
        this.labels.build(rows);

        for (let i = 0; i < rows.length; i++) {
          this.byId.set(`star:hyg:${rows[i][0]}`, i);
        }

        this.createMesh();
        return rows.length;
      })
      .catch((error) => {
        this.loadPromise = null;
        throw error;
      });

    return this.loadPromise;
  }

  /** Resolve a searchable star to a float64 target in parsecs. */
  resolveTarget(id: string): ResolvedTarget | null {
    if (id === 'star:sol:sun') {
      return {
        frameId: 'galactic',
        worldPos: new Float64Array(3),
        approachRadius: SOLAR_RADIUS_PC * 5,
      };
    }

    const i = this.byId.get(id);
    if (i === undefined) return null;

    const s = this.rows[i];

    return {
      frameId: 'galactic',
      worldPos: new Float64Array([
        s[1],
        s[2],
        s[3],
      ]),
      approachRadius: SOLAR_RADIUS_PC * 8,
    };
  }

  /** Called by Dee's layer registry when the stellar frame activates. */
  enter(_api: FrameApi): void {
    this.active = true;

    if (this.mesh && !this.object3D.parent) {
      this.scene.add(this.object3D);
    }
  }

  /** Removes the star field without destroying its data. */
  exit(): void {
    this.active = false;
    this.object3D.removeFromParent();
  }

  /**
   * Called each frame.
   * Camera-relative projection is handled by Claude's API.
   */
  update(
    _dt: number,
    _distance: number,
    _api: FrameApi,
  ): void {
    const pts = this.mesh;
    if (!this.active || !pts) return;

    const distLy =
      this.camera.getCameraDistanceToOrigin() / LIGHT_YEAR_METRES;

    // Fade into Nova's galaxy layer.
    const fade = 1 - Math.max(
      0,
      Math.min(
        1,
        (distLy - STAR_FADE_START_LY) /
          (STAR_HANDOFF_LY - STAR_FADE_START_LY),
      ),
    );

    pts.material.uniforms.uOpacity.value = fade;

    this.labels.update(distLy, fade);

    if (fade <= 0) {
      pts.visible = false;
      this.level = 3;
      return;
    }

    pts.visible = true;

    // HYG data is sorted by apparent brightness.
    // Draw fewer points at very large distances.
    const count =
      distLy > 8_000
        ? Math.min(this.rows.length, 256)
        : distLy > 1_500
          ? Math.min(this.rows.length, 768)
          : this.rows.length;

    this.level =
      count === this.rows.length ? 0 :
      count > 256 ? 1 : 2;

    pts.geometry.setDrawRange(0, count);

    const attr = pts.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;

    for (let i = 0; i < count; i++) {
      const row = this.rows[i];

      this.pos[0] = row[1];
      this.pos[1] = row[2];
      this.pos[2] = row[3];

      this.camera.toCameraRelative(
        this.pos,
        'galactic',
        this.temp,
      );

      attr.setXYZ(
        i,
        this.temp.x,
        this.temp.y,
        this.temp.z,
      );
    }

    attr.needsUpdate = true;
  }

  lodLevel(): number {
    return this.level;
  }

  dispose(): void {
    this.exit();
    this.labels.dispose();

    this.mesh?.geometry.dispose();
    this.mesh?.material.dispose();
    this.mesh?.removeFromParent();
    this.mesh = null;
  }

  private createMesh(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh.removeFromParent();
      this.mesh = null;
    }

    const n = this.rows.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const mags = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const row = this.rows[i];

      bvColor(row[5], this.color);

      colors[i * 3] = this.color.r;
      colors[i * 3 + 1] = this.color.g;
      colors[i * 3 + 2] = this.color.b;

      mags[i] = row[4];
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        positions,
        3,
      ).setUsage(THREE.DynamicDrawUsage),
    );

    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(colors, 3),
    );

    geometry.setAttribute(
      'aMagnitude',
      new THREE.BufferAttribute(mags, 1),
    );

    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VS,
      fragmentShader: STAR_FS,
      uniforms: {
        uOpacity: { value: 1 },
        uDpr: {
          value: Math.min(
            typeof devicePixelRatio === 'number'
              ? devicePixelRatio
              : 1,
            2,
          ),
        },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(
      geometry,
      material,
    );

    this.mesh.name = 'HYG J2000 stars';
    this.mesh.frustumCulled = false;

    // Search handles selection, not raycasting every sprite.
    this.mesh.raycast = () => {};

    this.object3D.add(this.mesh);

    // The JSON may finish loading after Dee's registry called enter().
    if (this.active && !this.object3D.parent) {
      this.scene.add(this.object3D);
    }
  }
}

export function makeStarsLayer(
  scene: THREE.Scene,
  camera: CosmoCamera,
): StellarNeighborhood {
  return new StellarNeighborhood(scene, camera);
}

