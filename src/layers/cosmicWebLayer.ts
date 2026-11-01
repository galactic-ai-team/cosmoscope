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
  private pointsGeometry: THREE.BufferGeometry | null = null;
  private pointsMaterial: THREE.PointsMaterial | null = null;
  private pointTexture: THREE.CanvasTexture | null = null;
  private galaxyMap = new Map<string, CosmicGalaxyPoint>();

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
      return data.points.length;
    } catch (err) {
      console.warn('CosmicWebLayer: data unavailable or failed to load', err);
      return 0;
    }
  }

  private createSoftCircleTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private buildCosmicWeb(pointsData: CosmicGalaxyPoint[]): void {
    this.pointsGeometry = new THREE.BufferGeometry();
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
      const uniqueId = `cosmicweb:2mrs:${i}`;

      const galaxyPoint: CosmicGalaxyPoint = {
        ...pt,
        id: uniqueId
      };

      this.galaxyMap.set(uniqueId, galaxyPoint);

      catalogEntries.push({
        id: uniqueId,
        name: pt.name || `2MRS Galaxy ${i}`,
        kind: 'galaxy',
        distanceM: distMpc * METERS.mpc,
        blurb: `2MRS Galaxy with K-band magnitude ${pt.mk}, redshift z=${pt.z}.`
      });
    });

    this.pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.pointTexture = this.createSoftCircleTexture();
    this.pointsMaterial = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 3.5,
      sizeAttenuation: false, // Prevents giant squares at extreme zoom out
      transparent: true,
      opacity: 0.0,
      map: this.pointTexture,
      alphaMap: this.pointTexture,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.pointsMesh = new THREE.Points(this.pointsGeometry, this.pointsMaterial);
    this.container.add(this.pointsMesh);

    register(catalogEntries);
  }

  public enter(_api: unknown): void {
    if (!this.container.parent) {
      this.scene.add(this.container);
    }
  }

  public update(_dt: number, _distanceMeters: number): void {
    if (!this.pointsMesh) return;

    // Camera-relative positioning for floating-origin precision in 'cosmic' frame
    this.camera.toCameraRelative(CosmicWebLayer.ORIGIN, 'cosmic', this.container.position);
    this.container.scale.setScalar(this.camera.layerScale('cosmic'));

    // Robust physical distance in Mpc from cosmic origin
    const distanceMpc = this.camera.distanceTo({
      frame: 'cosmic',
      position: CosmicWebLayer.ORIGIN,
    }) / METERS.mpc;

    // Fade in past ~1 Mpc out to 50 Mpc cosmological distance
    const fadeStart = 1.0;
    const fadeEnd = 50.0;
    const alpha = THREE.MathUtils.smoothstep(distanceMpc, fadeStart, fadeEnd);

    if (this.pointsMaterial) {
      this.pointsMaterial.opacity = alpha * 0.85;
      // Keep point size visually stable across scale steps
      this.pointsMaterial.size = Math.max(2.0, Math.min(5.0, 3.5 * this.camera.layerScale('cosmic')));
    }
  }

  public lodLevel(): number {
    const distMpc = this.camera.distanceTo({
      frame: 'cosmic',
      position: CosmicWebLayer.ORIGIN,
    }) / METERS.mpc;

    if (distMpc < 10) return 0;
    if (distMpc < 100) return 1;
    return 2;
  }

  public resolveTarget(id: string) {
    const found = this.galaxyMap.get(id);
    if (!found) return null;

    const worldPos = new Float64Array([found.xyz[0], found.xyz[1], found.xyz[2]]);
    return {
      frameId: 'cosmic' as FrameId,
      worldPos,
      approachRadius: 0.05 // 50 kpc in cosmic-frame Mpc
    };
  }

  public dispose(): void {
    if (this.pointsGeometry) this.pointsGeometry.dispose();
    if (this.pointsMaterial) this.pointsMaterial.dispose();
    if (this.pointTexture) this.pointTexture.dispose();
    this.galaxyMap.clear();
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