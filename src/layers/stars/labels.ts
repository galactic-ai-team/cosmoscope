import * as THREE from 'three';
import type { CosmoCamera } from '../../core/camera';
import type { HygRow } from './catalog';

const MAX_LABELS = 24;
const MAX_LABEL_DISTANCE_LY = 1_500;
const LABEL_FADE_START_LY = 900;
const PC_TO_LY = 3.26156;

type StarLabel = {
  row: HygRow;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  position: Float64Array;
};

/**
 * Camera-relative, distance-aware labels for named HYG stars.
 * Builds textures once and reuses all objects during update().
 */
export class StellarLabels {
  readonly object3D = new THREE.Group();

  private readonly labels: StarLabel[] = [];
  private readonly scratch = new THREE.Vector3();

  constructor(private readonly camera: CosmoCamera) {
    this.object3D.name = 'stellar-labels';
  }

  build(rows: readonly HygRow[]): void {
    this.dispose();

    const selected = rows
      .filter((row) =>
        row[7].trim().length > 0 &&
        Number.isFinite(row[4]) &&
        row[9] > 0
      )
      .sort((a, b) => a[4] - b[4])
      .slice(0, MAX_LABELS);

    for (const row of selected) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 96;

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.clearRect(0, 0, 512, 96);
      ctx.font = '500 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.strokeText(row[7], 256, 48);

      ctx.fillStyle = '#eaf1ff';
      ctx.fillText(row[7], 256, 48);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;

      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        sizeAttenuation: true,
      });

      const sprite = new THREE.Sprite(material);
      sprite.center.set(0.5, 0);
      sprite.renderOrder = 10;
      sprite.visible = false;

      this.object3D.add(sprite);
      this.labels.push({
        row,
        sprite,
        material,
        texture,
        position: new Float64Array([
          row[1], row[2], row[3],
        ]),
      });
    }
  }

  update(cameraDistanceLy: number, starOpacity: number): void {
    const distanceFade = THREE.MathUtils.clamp(
      (MAX_LABEL_DISTANCE_LY - cameraDistanceLy) /
        (MAX_LABEL_DISTANCE_LY - LABEL_FADE_START_LY),
      0,
      1,
    );

    const opacity = distanceFade * starOpacity;
    const active = opacity > 0.001;

    for (const label of this.labels) {
      const { sprite, material, position } = label;

      if (!active) {
        sprite.visible = false;
        continue;
      }

      this.camera.toCameraRelative(
        position,
        'galactic',
        this.scratch,
      );

      // Camera-relative coordinates are expressed in parsecs.
      const distancePc = this.scratch.length();
      const starDistanceLy = label.row[9] * PC_TO_LY;

      // Nearby labels are useful; distant labels add clutter.
      const nearby = starDistanceLy < MAX_LABEL_DISTANCE_LY;

      sprite.visible = nearby;
      if (!nearby) continue;

      sprite.position.copy(this.scratch);

      // Maintain approximately constant angular label size.
      const scale = Math.max(distancePc * 0.018, 0.0001);
      sprite.scale.set(scale * (512 / 96), scale, 1);

      material.opacity = opacity;
    }
  }

  setVisible(visible: boolean): void {
    this.object3D.visible = visible;
  }

  dispose(): void {
    for (const label of this.labels) {
      label.sprite.removeFromParent();
      label.material.dispose();
      label.texture.dispose();
    }

    this.labels.length = 0;
  }
}

