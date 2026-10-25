import * as THREE from 'three';
import type { CosmoCamera } from '../../core/camera';
import type { HygRow } from './catalog';

const MAX_LABELS = 24;
const MAX_LABEL_DISTANCE_LY = 1_500;
const LABEL_FADE_START_LY = 900;
const PC_TO_LY = 3.26156;

const LABEL_SCALE = 0.025;
const COLLISION_PADDING_PX = 7;

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type StarLabel = {
  row: HygRow;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  position: Float64Array;
  textFraction: number;
  rect: Rect;
};

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

/**
 * Brightest-first stellar labels.
 * Screen-space collisions hide lower-priority labels.
 * All render-loop scratch objects are reused.
 */
export class StellarLabels {
  readonly object3D = new THREE.Group();

  private readonly labels: StarLabel[] = [];
  private readonly occupied: Rect[] = [];

  private static readonly EXCLUSION_IDS = [
    'search',
    'info',
    'help',
    'help-btn',
    'constellations-btn',
    'zone',
    'tour',
    'scale',
  ] as const;

  private readonly exclusions: Rect[] = Array.from(
    { length: StellarLabels.EXCLUSION_IDS.length },
    () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
  );

  private exclusionCount = 0;

  private readonly scratch = new THREE.Vector3();
  private readonly cameraSpace = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();

  constructor(private readonly camera: CosmoCamera) {
    this.object3D.name = 'stellar-labels';
  }

  build(rows: readonly HygRow[]): void {
    this.dispose();

    const selected = rows
      .filter(row =>
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

      ctx.font = '500 36px sans-serif';

      const textFraction = Math.min(
        1,
        (ctx.measureText(row[7]).width + 24) / 512,
      );

      ctx.clearRect(0, 0, 512, 96);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
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
        textFraction,
        rect: { left: 0, top: 0, right: 0, bottom: 0 },
        position: new Float64Array([
          row[1], row[2], row[3],
        ]),
      });
    }
  }

  update(cameraDistanceLy: number, starOpacity: number): void {
    const fade = THREE.MathUtils.clamp(
      (MAX_LABEL_DISTANCE_LY - cameraDistanceLy) /
        (MAX_LABEL_DISTANCE_LY - LABEL_FADE_START_LY),
      0,
      1,
    );

    const opacity = fade * starOpacity;
    const active = opacity > 0.001;

    const cam = this.camera.three;
    const canvas = document.querySelector<HTMLCanvasElement>(
      '#app canvas',
    );
    const viewport = canvas?.getBoundingClientRect();

    const viewportLeft = viewport?.left ?? 0;
    const viewportTop = viewport?.top ?? 0;
    const viewportWidth =
      viewport?.width ?? document.documentElement.clientWidth;
    const viewportHeight =
      viewport?.height ?? document.documentElement.clientHeight;

    this.occupied.length = 0;
    this.exclusionCount = 0;

    for (const id of StellarLabels.EXCLUSION_IDS) {
      const el = document.getElementById(id);

      if (
        !el ||
        el.hidden ||
        getComputedStyle(el).display === 'none'
      ) continue;

      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;

      const zone = this.exclusions[this.exclusionCount++];
      zone.left = r.left;
      zone.top = r.top;
      zone.right = r.right;
      zone.bottom = r.bottom;
    }

    for (const label of this.labels) {
      const { sprite, material, position } = label;
      sprite.visible = false;

      if (!active) continue;

      const starDistanceLy = label.row[9] * PC_TO_LY;
      if (starDistanceLy >= MAX_LABEL_DISTANCE_LY) continue;

      this.camera.toCameraRelative(
        position,
        'galactic',
        this.scratch,
      );

      const distanceRender = this.scratch.length();

      const height = Math.max(
        distanceRender * LABEL_SCALE,
        0.0001,
      );
      const width = height * (512 / 96);

      sprite.position.copy(this.scratch);
      sprite.scale.set(width, height, 1);

      // Depth in the perspective camera's local frame.
      this.cameraSpace
        .copy(this.scratch)
        .applyMatrix4(cam.matrixWorldInverse);

      const depth = -this.cameraSpace.z;
      if (depth <= cam.near) continue;

      this.projected.copy(this.scratch).project(cam);

      const p = this.projected;
      if (
        p.z < -1 || p.z > 1 ||
        Math.abs(p.x) > 1.1 ||
        Math.abs(p.y) > 1.1
      ) continue;

      const x =
        viewportLeft + (p.x + 1) * viewportWidth * 0.5;
      const y =
        viewportTop + (1 - p.y) * viewportHeight * 0.5;

      const heightPx =
        height *
        cam.projectionMatrix.elements[5] *
        viewportHeight * 0.5 /
        depth;

      const widthPx =
        heightPx * (512 / 96) * label.textFraction;

      const pad = COLLISION_PADDING_PX;

      // Sprite anchor is bottom-center.
      const rect = label.rect;
      rect.left = x - widthPx / 2 - pad;
      rect.right = x + widthPx / 2 + pad;
      rect.top = y - heightPx - pad;
      rect.bottom = y + pad;

      let blocked = false;

      // Keep the brighter labels already accepted.
      for (const other of this.occupied) {
        if (overlaps(rect, other)) {
          blocked = true;
          break;
        }
      }

      // Prevent labels from overlapping HUD and controls.
      if (!blocked) {
        for (let i = 0; i < this.exclusionCount; i++) {
          if (overlaps(rect, this.exclusions[i])) {
            blocked = true;
            break;
          }
        }
      }

      if (blocked) continue;

      this.occupied.push(rect);
      sprite.visible = true;
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
    this.occupied.length = 0;
  }
}
