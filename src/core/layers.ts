// src/core/layers.ts
// ScaleLayer registry. Owns active-layer resolution, crossfades and LOD
// selection on top of Claude's frame API (src/core/camera.ts).

import type { FrameApi } from './camera';
import type { FrameId } from './frames';

/** A resolvable searchable target, returned by a layer. */
export interface ResolvedTarget {
  frameId: FrameId;
  /** World position in the target's native frame, float64, length 3. */
  worldPos: Float64Array;
  /** Suggested approach distance in frame units (e.g. 3× body radius). */
  approachRadius: number;
}

export interface ScaleLayer {
  idPrefix: string;
  frames: FrameId[];
  enter(api: FrameApi): void;
  exit(): void;
  update(dt: number, distance: number, api: FrameApi): void;
  renderBudget: number;
  resolveTarget(id: string): ResolvedTarget | null;
  lodLevel?(): number;
}

interface LayerEntry {
  layer: ScaleLayer;
  active: boolean;
  opacity: number;
}

export class LayerRegistry {
  private entries = new Map<string, LayerEntry>();
  private api: FrameApi;

  constructor(api: FrameApi) {
    this.api = api;
  }

  register(layer: ScaleLayer): void {
    if (this.entries.has(layer.idPrefix)) {
      throw new Error(`Layer "${layer.idPrefix}" already registered`);
    }
    this.entries.set(layer.idPrefix, { layer, active: false, opacity: 0 });
  }

  activeLayers(): { layer: ScaleLayer; opacity: number }[] {
    const frame = this.api.getFrameId();
    const out: { layer: ScaleLayer; opacity: number }[] = [];
    for (const entry of this.entries.values()) {
      if (entry.layer.frames.includes(frame) && entry.opacity > 0) {
        out.push({ layer: entry.layer, opacity: entry.opacity });
      }
    }
    return out;
  }

  update(dt: number, crossfadeSeconds = 0.4): void {
    const frame = this.api.getFrameId();
    const step = crossfadeSeconds > 0 ? dt / crossfadeSeconds : 1;

    for (const entry of this.entries.values()) {
      const shouldBeActive = entry.layer.frames.includes(frame);

      if (shouldBeActive && !entry.active) {
        entry.layer.enter(this.api);
        entry.active = true;
      }

      const target = shouldBeActive ? 1 : 0;
      if (entry.opacity < target) entry.opacity = Math.min(1, entry.opacity + step);
      else if (entry.opacity > target) entry.opacity = Math.max(0, entry.opacity - step);

      if (!shouldBeActive && entry.active && entry.opacity <= 0) {
        entry.layer.exit();
        entry.active = false;
        continue;
      }

      if (entry.active) {
        const pos = new Float64Array(3);
        this.api.getCameraWorldPosition(this.api.getFrameId(), pos);
        const dist = Math.hypot(pos[0], pos[1], pos[2]);
        entry.layer.update(dt, dist, this.api);
      }
    }
  }

  resolveTarget(id: string): ResolvedTarget | null {
    const prefix = id.split(':')[0];
    const entry = this.entries.get(prefix);
    if (!entry) return null;
    return entry.layer.resolveTarget(id);
  }

  totalActiveBudget(): number {
    let sum = 0;
    for (const e of this.activeLayers()) sum += e.layer.renderBudget;
    return sum;
  }
}
