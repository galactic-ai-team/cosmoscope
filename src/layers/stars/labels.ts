import * as THREE from 'three';
import type { CosmoCamera } from '../../core/camera';
import type { HygRow } from './catalog';
import {
  isLabelBlocked,
  type LabelRect,
} from './labelCollision';
import { LabelExclusions } from './labelExclusions';

const MAX_LABELS = 24;
const MAX_LABEL_DISTANCE_LY = 1_500;
const LABEL_FADE_START_LY = 900;
const PC_TO_LY = 3.26156;
const LIGHT_YEAR_METRES = 9.4607304725808e15;

const LABEL_SCALE = 0.025;
const COLLISION_PADDING_PX = 7;
// A flyTo target is a catalog coordinate; allow harmless float64 frame roundoff.
const TARGET_MATCH_PC = 1e-5;

type StarLabel = {
  row: HygRow;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  position: Float64Array;
  textFraction: number;
  rect: LabelRect;
};

/**
 * Brightest-first stellar labels with one reserved focused-star candidate.
 * The focused star is first in collision priority and can be outside the
 * brightest 24. At most MAX_LABELS labels are visible at any one time.
 */
export class StellarLabels {
  readonly object3D = new THREE.Group();

  private readonly labels: StarLabel[] = [];
  private readonly occupied: LabelRect[] = [];
  private allRows: readonly HygRow[] = [];
  private focused: StarLabel | null = null;
  private focusedRow: HygRow | null = null;
  private readonly targetPosition = new Float64Array(3);
  private readonly previousTarget = new Float64Array(3);
  private hasPreviousTarget = false;

  private exclusionCache: LabelExclusions | null = null;

  private readonly scratch = new THREE.Vector3();
  private readonly cameraSpace = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();

  constructor(
    private readonly camera: CosmoCamera,
    private readonly canvas?: HTMLCanvasElement,
  ) {
    this.object3D.name = 'stellar-labels';
  }

  startExclusionCache(doc: Document = document): void {
    this.exclusionCache?.dispose();
    this.exclusionCache = new LabelExclusions(doc);
    this.exclusionCache.start();
  }

  private makeLabel(row: HygRow): StarLabel | null {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const name = row[7].trim() || `HYG ${row[0]}`;
    ctx.font = '500 36px sans-serif';

    const textFraction = Math.min(
      1,
      (ctx.measureText(name).width + 24) / 512,
    );

    ctx.clearRect(0, 0, 512, 96);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(name, 256, 48);

    ctx.fillStyle = '#eaf1ff';
    ctx.fillText(name, 256, 48);

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

    return {
      row,
      sprite,
      material,
      texture,
      textFraction,
      rect: { left: 0, top: 0, right: 0, bottom: 0 },
      position: new Float64Array([row[1], row[2], row[3]]),
    };
  }

  private releaseLabel(label: StarLabel): void {
    label.sprite.removeFromParent();
    label.material.dispose();
    label.texture.dispose();
  }

  build(rows: readonly HygRow[]): void {
    this.clearLabels();
    this.allRows = rows;
    this.hasPreviousTarget = false;

    const selected = rows
      .filter(row =>
        row[7].trim().length > 0 &&
        Number.isFinite(row[4]) &&
        row[9] > 0
      )
      .sort((a, b) => a[4] - b[4])
      .slice(0, MAX_LABELS);

    for (const row of selected) {
      const label = this.makeLabel(row);
      if (label) this.labels.push(label);
    }
  }

  /**
   * Only rescan the HYG subset when the camera's focus target changes.
   * Exact catalog position matching avoids interpreting a nearby galaxy or
   * arbitrary look-at point as a selected star.
   */
  private updateFocus(): void {
    const target = this.camera.getTargetPosition('galactic', this.targetPosition);
    if (!target) {
      this.hasPreviousTarget = false;
      this.setFocusedRow(null);
      return;
    }

    if (
      this.hasPreviousTarget &&
      Math.abs(target[0] - this.previousTarget[0]) < TARGET_MATCH_PC &&
      Math.abs(target[1] - this.previousTarget[1]) < TARGET_MATCH_PC &&
      Math.abs(target[2] - this.previousTarget[2]) < TARGET_MATCH_PC
    ) return;

    this.previousTarget.set(target);
    this.hasPreviousTarget = true;

    let match: HygRow | null = null;
    const maxErrorSq = TARGET_MATCH_PC * TARGET_MATCH_PC;
    for (const row of this.allRows) {
      const dx = row[1] - target[0];
      const dy = row[2] - target[1];
      const dz = row[3] - target[2];
      if (dx * dx + dy * dy + dz * dz <= maxErrorSq) {
        match = row;
        break;
      }
    }
    this.setFocusedRow(match);
  }

  private setFocusedRow(row: HygRow | null): void {
    if (this.focusedRow === row) return;

    if (this.focused) {
      this.releaseLabel(this.focused);
      this.focused = null;
    }
    this.focusedRow = row;
    if (!row) return;

    // Reuse an existing label if this is already among the brightest 24.
    if (this.labels.some(label => label.row[0] === row[0])) return;
    this.focused = this.makeLabel(row);
  }

  update(cameraDistanceLy: number, starOpacity: number): void {
    this.updateFocus();

    const sunFade = THREE.MathUtils.clamp(
      (MAX_LABEL_DISTANCE_LY - cameraDistanceLy) /
        (MAX_LABEL_DISTANCE_LY - LABEL_FADE_START_LY),
      0,
      1,
    );

    const defaultOpacity = sunFade * starOpacity;
    const focusedLabel = this.focused ??
      this.labels.find(label => label.row === this.focusedRow) ?? null;

    // Focused labels depend on camera-to-star distance, not Sun distance.
    // The shared starOpacity still respects the distant galaxy handoff.
    const focusDistanceLy = focusedLabel
      ? this.camera.distanceTo({
          frame: 'galactic',
          position: focusedLabel.position,
        }) / LIGHT_YEAR_METRES
      : Infinity;
    const focusOpacity = THREE.MathUtils.clamp(
      (MAX_LABEL_DISTANCE_LY - focusDistanceLy) /
        (MAX_LABEL_DISTANCE_LY - LABEL_FADE_START_LY),
      0,
      1,
    ) * starOpacity;

    const cam = this.camera.three;
    const viewport = this.canvas?.getBoundingClientRect();
    const viewportLeft = viewport?.left ?? 0;
    const viewportTop = viewport?.top ?? 0;
    const viewportWidth = viewport?.width ?? document.documentElement.clientWidth;
    const viewportHeight = viewport?.height ?? document.documentElement.clientHeight;

    this.occupied.length = 0;
    const exclusionState = this.exclusionCache?.read();
    const exclusions = exclusionState?.rects ?? [];
    const exclusionCount = exclusionState?.count ?? 0;

    // Reset every sprite before applying brightest-first collision rules.
    for (const label of this.labels) label.sprite.visible = false;
    if (this.focused) this.focused.sprite.visible = false;

    const draw = (label: StarLabel, opacity: number): boolean => {
      if (opacity <= 0.001) return false;

      const { sprite, material, position } = label;
      this.camera.toCameraRelative(position, 'galactic', this.scratch);

      const distanceRender = this.scratch.length();
      const height = Math.max(distanceRender * LABEL_SCALE, 0.0001);
      const width = height * (512 / 96);
      sprite.position.copy(this.scratch);
      sprite.scale.set(width, height, 1);

      this.cameraSpace.copy(this.scratch).applyMatrix4(cam.matrixWorldInverse);
      const depth = -this.cameraSpace.z;
      if (depth <= cam.near) return false;

      this.projected.copy(this.scratch).project(cam);
      const p = this.projected;
      if (
        p.z < -1 || p.z > 1 ||
        Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1
      ) return false;

      const x = viewportLeft + (p.x + 1) * viewportWidth * 0.5;
      const y = viewportTop + (1 - p.y) * viewportHeight * 0.5;
      const heightPx =
        height * cam.projectionMatrix.elements[5] * viewportHeight * 0.5 / depth;
      const widthPx = heightPx * (512 / 96) * label.textFraction;
      const pad = COLLISION_PADDING_PX;

      const rect = label.rect;
      rect.left = x - widthPx / 2 - pad;
      rect.right = x + widthPx / 2 + pad;
      rect.top = y - heightPx - pad;
      rect.bottom = y + pad;

      if (isLabelBlocked(rect, this.occupied, exclusions, exclusionCount)) {
        return false;
      }

      this.occupied.push(rect);
      sprite.visible = true;
      material.opacity = opacity;
      return true;
    };

    let visibleCount = 0;
    if (focusedLabel && draw(focusedLabel, focusOpacity)) visibleCount++;

    for (const label of this.labels) {
      if (visibleCount >= MAX_LABELS) break;
      if (label === focusedLabel) continue;
      // Preserve the original Sun-distance limitation for background labels.
      if (label.row[9] * PC_TO_LY >= MAX_LABEL_DISTANCE_LY) continue;
      if (draw(label, defaultOpacity)) visibleCount++;
    }
  }

  setVisible(visible: boolean): void {
    this.object3D.visible = visible;
  }

  private clearLabels(): void {
    for (const label of this.labels) this.releaseLabel(label);
    this.labels.length = 0;
    if (this.focused) this.releaseLabel(this.focused);
    this.focused = null;
    this.focusedRow = null;
    this.allRows = [];
    this.hasPreviousTarget = false;
    this.occupied.length = 0;
  }

  dispose(): void {
    this.clearLabels();
    this.exclusionCache?.dispose();
    this.exclusionCache = null;
  }
}
