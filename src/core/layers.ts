// src/core/layers.ts
// ScaleLayer registry. Owns active-layer resolution, crossfades and LOD
// selection on top of Claude's frame API (src/core/camera.ts).

import type { FrameApi, FramedPoint } from './camera';
import type { FrameId } from './frames';
import {
  DEFAULT_GLOBAL_OBJECT_CAP,
  computeCrossfade,
  makeLodState,
  resolveTierDistance,
  selectTier,
  validateLodTiers,
  type LodState,
  type LodTier,
  type MutableLodState,
} from './lod';

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
  /**
   * Called every frame while active.
   * `distance` is camera-focus distance in metres (preserved for backward compat).
   * `lod` is the LOD snapshot for this layer — undefined if the layer has no
   * lodTiers. Do NOT retain the lod reference across frames (reused record).
   */
  update(dt: number, distance: number, api: FrameApi, lod?: Readonly<LodState>): void;
  renderBudget: number;
  resolveTarget(id: string): ResolvedTarget | null;
  lodLevel?(): number;
  /** Optional LOD tier table. If absent, layer always draws (backward compat). */
  lodTiers?: LodTier[];
  /** Optional default anchor for tiers without their own anchor. */
  defaultAnchor?: FramedPoint;
}

interface LayerEntry {
  layer: ScaleLayer;
  active: boolean;
  opacity: number;
  /** Reused LodState backing for this layer. Never reallocated. */
  lod: MutableLodState;
  /** Current level from last frame, for hysteresis. -1 = inactive. */
  currentLevel: number;
}

export class LayerRegistry {
  private entries = new Map<string, LayerEntry>();
  private api: FrameApi;
  private globalObjectCap: number;

  constructor(api: FrameApi, globalObjectCap = DEFAULT_GLOBAL_OBJECT_CAP) {
    this.api = api;
    this.globalObjectCap = globalObjectCap;
  }

  get objectCap(): number {
    return this.globalObjectCap;
  }

  register(layer: ScaleLayer): void {
    if (this.entries.has(layer.idPrefix)) {
      throw new Error(`Layer "${layer.idPrefix}" already registered`);
    }
    if (layer.lodTiers) {
      validateLodTiers(layer.lodTiers, layer.idPrefix);
    }
    this.entries.set(layer.idPrefix, {
      layer,
      active: false,
      opacity: 0,
      lod: makeLodState(),
      currentLevel: -1,
    });
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

    // Camera-focus distance is the same for every layer this frame — compute
    // once. Claude confirmed getFocusDistance() returns the live distance to
    // the flight target during a flyTo.
    const cameraFocusDistance = this.api.getFocusDistance();

    interface ActiveEntry {
      entry: LayerEntry;
      rawBudget: number;
    }
    const activeNow: ActiveEntry[] = [];

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
        entry.currentLevel = -1;
        continue;
      }

      if (!entry.active) continue;

      const tiers = entry.layer.lodTiers;
      if (!tiers) {
        // No LOD: layer always draws at full budget when active.
        entry.lod.level = -1;
        entry.lod.crossfade = 1;
        entry.lod.budgetFrac = 0; // filled in phase 2
        entry.lod.focusDistance = 0;
        entry.lod.cameraFocusDistance = cameraFocusDistance;
        entry.lod.focusId = null;
        entry.lod.heldByHysteresis = false;
        activeNow.push({ entry, rawBudget: 1.0 });
        continue;
      }

      // Probe tier: use last frame's level for the anchor, or tier 0 on first
      // frame. One pass — iterating to a fixed point could oscillate.
      const probeLevel =
        entry.currentLevel >= 0 && entry.currentLevel < tiers.length
          ? entry.currentLevel
          : 0;
      const probeTier = tiers[probeLevel];
      const resolved = resolveTierDistance(
        probeTier,
        entry.layer.defaultAnchor,
        this.api,
      );

      // selectTier is pure: distance already resolved, returns only
      // { level, heldByHysteresis }.
      const sel = selectTier(tiers, resolved.distance, entry.currentLevel);

      entry.lod.level = sel.level;
      entry.lod.focusDistance = resolved.distance;
      entry.lod.cameraFocusDistance = cameraFocusDistance;
      entry.lod.focusId = sel.level === -1 ? null : resolved.focusId;
      entry.lod.heldByHysteresis = sel.heldByHysteresis;
      entry.lod.crossfade =
        sel.level >= 0 ? computeCrossfade(tiers[sel.level], resolved.distance) : 0;

      entry.currentLevel = sel.level;

      if (sel.level === -1) {
        entry.lod.budgetFrac = 0;
        continue;
      }

      activeNow.push({ entry, rawBudget: tiers[sel.level].budgetFrac });
    }

    // Phase 2: normalize budgetFrac across active layers.
    let totalWeight = 0;
    for (const { rawBudget } of activeNow) totalWeight += rawBudget;

    for (const { entry, rawBudget } of activeNow) {
      entry.lod.budgetFrac = totalWeight > 0 ? rawBudget / totalWeight : 0;
    }

    // Phase 3: call update() with the resolved LodState.
    const pos = new Float64Array(3);
    this.api.getCameraWorldPosition(this.api.getFrameId(), pos);
    const focusDist = Math.hypot(pos[0], pos[1], pos[2]);

    for (const { entry } of activeNow) {
      entry.layer.update(dt, focusDist, this.api, entry.lod as Readonly<LodState>);
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
