import * as THREE from 'three';
import { ScaleLayer } from '../core/layers';
import { CosmoCamera } from '../core/camera';
import { FrameId } from '../core/frames';
import { METERS } from '../core/units';
import { register, CatalogEntry } from '../catalog';

interface CosmicGalaxyPoint {
  id: string;
  name: string;
  xyz: [number, number, number]; // in Mpc
  z: number;
  mk: number; // K-band magnitude
}

interface CosmicWebData {
  provenance: string;
  points: CosmicGalaxyPoint[];
}

export class CosmicWebLayer implements ScaleLayer {
  public static readonly ORIGIN = new Float64Array([0, 0, 0]);

  public idPrefix = 'galaxy'; // or custom prefix matching cosmic catalog ids
  public frames: FrameId[] = ['cosmic'];
  public minZoom = 1e22; // Visible at cosmological scale (~10^22 - 10^26 meters)
  public maxZoom = 1e27;
  public renderBudget = 25;

  private scene: THREE.Scene;
  private camera: CosmoCamera;
  private container: THREE.Group;
  private pointsMesh: THREE.Points | null = null;
  private pointsMaterial: THREE.PointsMaterial | null = null;
  private isLoaded = false;

  constructor(scene: THREE.Scene, camera: CosmoCamera) {
    this.scene = scene;
    this.camera = camera;
    this.container = new THREE.Group();
    this.container.name = 'CosmicWebLayer';
  }

  public async load(url = '/data/cosmic-web-2mrs.json'): Promise<number> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load cosmic web data: ${response.statusText}`);
      }
      const data: CosmicWebData = await response.json();
      this.buildCosmicWeb(data.points);
      this.isLoaded = true;
      return data.points.length;
    } catch (err) {
      console.warn('CosmicWebLayer: data unavailable or failed to load', err);
      return 0;
    }
  }

  private buildCosmicWeb(pointsData: CosmicGalaxyPoint[]): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(pointsData.length * 3);
    const catalogEntries: CatalogEntry[] = [];

    pointsData.forEach((pt, i) => {
      // 1 Mpc in cosmic scale coordinates
      const x = pt.xyz[0];
      const y = pt.xyz[1];
      const z = pt.xyz[2];

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      catalogEntries.push({
        id: pt.id || `galaxy:2mrs:${i}`,
        name: pt.name || `2MRS Galaxy ${i}`,
        kind: 'galaxy',
        distanceM: x * 3.086e22, // Convert Mpc to meters
        blurb: `2MRS Galaxy with K-band magnitude ${pt.mk}, redshift z=${pt.z}.`
      });
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Points material with glowing additive blending and magnitude-responsive feel
    this.pointsMaterial = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 1.8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.pointsMesh = new THREE.Points(geometry, this.pointsMaterial);
    this.container.add(this.pointsMesh);

    register(catalogEntries);
  }

  public enter(_api: unknown): void {
    if (!this.container.parent) {
      this.scene.add(this.container);
    }
  }

  public update(_dt: number, distance: number): void {
    // Camera-relative positioning for floating-origin precision in 'cosmic' frame
    this.camera.toCameraRelative(CosmicWebLayer.ORIGIN, 'cosmic', this.container.position);
    this.container.scale.setScalar(this.camera.layerScale('cosmic'));

    // Fade in past ~1 Mpc out to 100+ Mpc cosmological distance
    const fadeStart = 1.0; // Mpc
    const fadeEnd = 50.0;  // Mpc
    const alpha = THREE.MathUtils.smoothstep(distance, fadeStart, fadeEnd);

    if (this.pointsMaterial) {
      this.pointsMaterial.opacity = alpha * 0.85;
    }
  }

  public lodLevel(): number {
    return this.camera.getCameraDistanceToOrigin();
  }

  public resolveTarget(id: string) {
    // Basic target resolution for 2MRS galaxies if searched
    return {
      frameId: 'cosmic' as FrameId,
      worldPos: new Float64Array([0, 0, 0]),
      approachRadius: 5.0
    };
  }

  public exit(): void {
    if (this.container.parent) {
      this.container.parent.remove(this.container);
    }
  }
}

export function createCosmicWebLayer(scene: THREE.Scene, camera: CosmoCamera): CosmicWebLayer {
  return new CosmicWebLayer(scene, camera);
}