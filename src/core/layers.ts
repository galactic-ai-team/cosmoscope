// src/core/layers.ts
// ScaleLayer registry. Owns active-layer resolution, crossfades and LOD
// selection on top of Claude's frame API (src/core/camera.ts).

import type { FrameApi, FrameId } from './camera';

/** A resolvable searchable target, returned by a layer. */
export interface ResolvedTarget {
  frameId: FrameId;
  /** World position in the target's native frame, float64, length 3. */
  worldPos: Float64Array;
  /** Suggested approach distance in frame units (e.g. 3× body radius). */
  approachRadius: number;
}

export interface ScaleLayer {
  /** Stable prefix for searchable ids this layer owns, e.g. "star". */
  idPrefix: string;
  /** Frames this layer draws in. Active when the camera's frame matches. */
  frames: FrameId[];
  /** Called when the layer becomes active. */
  enter(api: FrameApi): void;
  /** Called when the layer leaves the active set. */
  exit(): void;
  /** Called every frame while active. `distance` is camera distance in frame units. */
  update(dt: number, distance: number, api: FrameApi): void;
  /** Max objects this layer may draw. Enforced by the registry. */
  renderBudget: number;
  /** Resolve a searchable id owned by this layer, or null. */
  resolveTarget(id: string): ResolvedTarget | null;
  /** Current LOD level the layer is drawing at, for HUD/debug. */
  lodLevel?(): number;
}

interface LayerEntry {
  layer: ScaleLayer;
  active: boolean;
  /** 0..1 crossfade opacity, driven by registry at frame boundaries. */
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

  /** Layers that should be drawing in the current frame, with crossfade opacity. */
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

  /**
   * Per-frame tick. Activates/deactivates layers by frame, advances
   * crossfades, and drives each active layer's update with its camera
   * distance. `crossfadeSeconds` is how long a boundary blend takes.
   * `dt` should be clamped by the caller (main.ts clamps to 0.1).
   */
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

  /**
   * Resolve a searchable id to a target. Dispatches to the layer whose
   * idPrefix matches the id's prefix. Returns null if no layer owns it.
   */
  resolveTarget(id: string): ResolvedTarget | null {
    const prefix = id.split(':')[0];
    const entry = this.entries.get(prefix);
    if (!entry) return null;
    return entry.layer.resolveTarget(id);
  }

  /** Total render budget across active layers. Used by HUD/debug. */
  totalActiveBudget(): number {
    let sum = 0;
    for (const e of this.activeLayers()) sum += e.layer.renderBudget;
    return sum;
  }
}