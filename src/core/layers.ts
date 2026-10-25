// src/core/layers.ts
// ScaleLayer registry. Owns active-layer resolution, crossfades and LOD
// selection on top of Claude's frame API (src/core/camera.ts).

import type { FrameApi, FramedPoint } from './camera';
import type { FrameId } from './frames';
import {
  DEFAULT_GLOBAL_OBJECT_CAP,
  computeCrossfade,
  makeLodState,
  resolveLayerDistance,
  selectTierInto,
  validateLodTiers,
  type DistanceBasis,
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
   * Called every frame while frame-active — including when LOD level is -1,
   * so a fast flight past a tier boundary can still hide the layer. Never
   * called for frame-inactive layers.
   *
   * `distanceMetres` is camera→focus distance in METRES, independent of the
   * camera's current frame. Use it, not frame units, for any distance math.
   *
   * `lod` is the LOD snapshot for this layer. Always defined (see LodState
   * for the isTiered contract). Do NOT retain the reference across frames.
   */
  update(dt: number, distanceMetres: number, api: FrameApi, lod: Readonly<LodState>): void;
  renderBudget: number;
  resolveTarget(id: string): ResolvedTarget | null;
  lodLevel?(): number;
  /** Optional LOD tier table. If absent, layer is treated as always-on tier. */
  lodTiers?: LodTier[];
  /**
   * Distance basis for tier selection. One basis per layer, never per tier.
   *   'anchor' — measure against defaultAnchor; no anchor = behaves like 'focus'.
   *   'focus'  — always camera→focus (getFocusDistance with no argument).
   *   'nearer' — Math.min(anchorDistance, focusDistance).
   * Default 'anchor'.
   */
  basis?: DistanceBasis;
  /** Anchor used by basis 'anchor' and 'nearer'. */
  defaultAnchor?: FramedPoint;
}

interface LayerEntry {
  layer: ScaleLayer;
  active: boolean;
  opacity: number;
  /** Reused LodState backing for this layer. Never reallocated. */
  lod: MutableLodState;
  /** Reused per-frame raw budget weight. */
  rawBudget: number;
}

export class LayerRegistry {
  private entries = new Map<string, LayerEntry>();
  private api: FrameApi;
  private globalObjectCap: number;
  /** Reused per-frame list of active layer entries. Never reallocated. */
  private activeNow: LayerEntry[] = [];
  /** Reused scratch for camera position reads in phase 3. */

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
    const lod = makeLodState();
    lod.isTiered = !!layer.lodTiers;
    this.entries.set(layer.idPrefix, {
      layer,
      active: false,
      opacity: 0,
      lod,
      rawBudget: 1.0,
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

    // Camera-focus distance in METRES, same for every layer this frame.
    // getFocusDistance() returns metres regardless of the camera's frame,
    // so a frame rebase does not change this value.
    const focusMetres = this.api.getFocusDistance();

    this.activeNow.length = 0;

    // --- Phase 1: frame membership, opacity, LOD selection, raw budget.
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
        entry.lod.level = -1;
        continue;
      }

      // Skip only frame-inactive layers. Frame-active layers ALWAYS reach
      // phase 3, even at LOD level -1, so they can hide themselves after a
      // fast jump past a tier boundary.
      if (!entry.active) continue;

      entry.lod.frameOpacity = entry.opacity;
      entry.lod.cameraFocusDistance = focusMetres;

      const tiers = entry.layer.lodTiers;
      if (!tiers) {
        // Non-tiered: treated as always-on tier at full weight.
        entry.lod.level = -1;
        entry.lod.crossfade = 1;
        entry.lod.focusDistance = 0;
        entry.lod.distanceBasis = null;
        entry.lod.heldByHysteresis = false;
        entry.rawBudget = 1.0;
        this.activeNow.push(entry);
        continue;
      }

      resolveLayerDistance(
        entry.layer.basis ?? 'anchor',
        entry.layer.defaultAnchor,
        this.api,
        entry.lod,
      );

      selectTierInto(tiers, entry.lod.focusDistance, entry.lod);

      entry.lod.crossfade =
        entry.lod.level >= 0
          ? computeCrossfade(tiers[entry.lod.level], entry.lod.focusDistance)
          : 0;

      entry.rawBudget = entry.lod.level >= 0 ? tiers[entry.lod.level].budgetFrac : 0;
      this.activeNow.push(entry);
    }

    // --- Phase 2: normalize rawBudget across frame-active layers.
    let totalWeight = 0;
    for (const entry of this.activeNow) totalWeight += entry.rawBudget;

    for (const entry of this.activeNow) {
      entry.lod.budgetFrac = totalWeight > 0 ? entry.rawBudget / totalWeight : 0;
    }

    // --- Phase 3: call update() on every frame-active layer.
    for (const entry of this.activeNow) {
      entry.layer.update(
        dt,
        focusMetres,
        this.api,
        entry.lod as Readonly<LodState>,
      );
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
