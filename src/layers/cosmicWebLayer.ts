import * as THREE from 'three';
import { ScaleLayer } from '../core/layers';
import { CosmoCamera } from '../core/camera';
import { FrameId } from '../core/frames';
import { METERS } from '../core/frames';
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

  public idPrefix = 'cosmicweb';
  public frames: FrameId[] = ['cosmic'];
  public minZoom = 1e22;
  public maxZoom = 1e27;
  public renderBudget = 25;

  private scene: THREE.Scene;
  private camera: CosmoCamera;
  private container: THREE.Group;
  private pointsMesh: THREE.Points | null = null;
  private pointsMaterial: THREE.PointsMaterial | null = null;
  private galaxyPoints: CosmicGalaxyPoint[] = [];

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
      this.galaxyPoints = data.points;
      this.buildCosmicWeb(data.points);
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
      const x = pt.xyz[0];
      const y = pt.xyz[1];
      const z = pt.xyz[2];

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const distMpc = Math.sqrt(x * x + y * y + z * z);

      catalogEntries.push({
        id: pt.id || `cosmicweb:2mrs:${i}`,
        name: pt.name || `2MRS Galaxy ${i}`,
        kind: 'galaxy',
        distanceM: distMpc * METERS.mpc,
        blurb: `2MRS Galaxy with K-band magnitude ${pt.mk}, redshift z=${pt.z}.`
      });
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

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

  public update(_dt: number, distanceMeters: number): void {
    if (!this.pointsMesh) return;

    // Camera-relative positioning for floating-origin precision in 'cosmic' frame
    this.camera.toCameraRelative(CosmicWebLayer.ORIGIN, 'cosmic', this.container.position);
    this.container.scale.setScalar(this.camera.layerScale('cosmic'));

    // Convert distance from meters to Mpc for correct fade threshold calculations
    const distanceMpc = distanceMeters / METERS.mpc;

    // Fade in past ~1 Mpc out to 50 Mpc cosmological distance
    const fadeStart = 1.0;
    const fadeEnd = 50.0;
    const alpha = THREE.MathUtils.smoothstep(distanceMpc, fadeStart, fadeEnd);

    if (this.pointsMaterial) {
      this.pointsMaterial.opacity = alpha * 0.85;
    }
  }

  public lodLevel(): number {
    // Return discrete tier index based on camera distance in Mpc
    const distMpc = this.camera.getCameraDistanceToOrigin() / METERS.mpc;
    if (distMpc < 10) return 0;
    if (distMpc < 100) return 1;
    return 2;
  }

  public resolveTarget(id: string) {
    const found = this.galaxyPoints.find(pt => pt.id === id || `cosmicweb:2mrs:${this.galaxyPoints.indexOf(pt)}` === id);
    if (!found) return null;

    const worldPos = new Float64Array([found.xyz[0], found.xyz[1], found.xyz[2]]);
    return {
      frameId: 'cosmic' as FrameId,
      worldPos,
      approachRadius: 2.5
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

