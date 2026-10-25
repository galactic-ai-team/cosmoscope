// src/core/__tests__/layers.test.ts
// Invariant tests for the LOD layer of LayerRegistry.
//
//   1. cameraFocusDistance always equals api.getFocusDistance() (no anchor),
//      regardless of which basis drove tier selection.
//   2. Hysteresis holds tier selection inside the dead band, for both
//      Sun-anchored and focus-anchored bases.
//   3. Budget normalization: budgetFrac sums to 1.0 across all active layers
//      even when they use different bases and different tier tables.
//
// Uses the same fake FrameApi pattern as flyTo.jitter.test.ts so these tests
// don't depend on a real Three.js scene.

import { describe, expect, it } from 'vitest';
import type { FrameApi, FramedPoint } from '../camera';
import type { FrameId } from '../frames';
import { LayerRegistry, type ResolvedTarget, type ScaleLayer } from '../layers';
import type { LodState, LodTier } from '../lod';
import { HYSTERESIS_RATIO } from '../lod';

// --- Fake FrameApi ---------------------------------------------------------
// Tracks camera position and a "target point" (what getFocusDistance() would
// compute as camera→target). All frames share origin, so distances are
// trivially Euclidean; a real implementation would use toFrame internally.
function makeFakeApi(initialCameraPos: [number, number, number]): FrameApi & {
  cameraPos: Float64Array;
  targetPoint: Float64Array | null;
  frame: FrameId;
} {
  const api = {
    cameraPos: new Float64Array(initialCameraPos),
    targetPoint: new Float64Array([0, 0, 0]) as Float64Array | null,
    frame: 'galactic' as FrameId,

    getFrameId(): FrameId {
      return this.frame;
    },
    getCameraWorldPosition(_f?: FrameId, out = new Float64Array(3)): Float64Array {
      out[0] = this.cameraPos[0];
      out[1] = this.cameraPos[1];
      out[2] = this.cameraPos[2];
      return out;
    },
    setCameraFrameAndPosition(frame: FrameId, pos: Float64Array): void {
      this.frame = frame;
      this.cameraPos[0] = pos[0];
      this.cameraPos[1] = pos[1];
      this.cameraPos[2] = pos[2];
    },
    lookAt(_pos: Float64Array): void {},
    getCameraForward(out = new Float64Array(3)): Float64Array {
      out[0] = 0; out[1] = 0; out[2] = 1;
      return out;
    },
    toFrame(
      point: Float64Array,
      _from: FrameId,
      _to: FrameId,
      out = new Float64Array(3),
    ): Float64Array {
      out[0] = point[0];
      out[1] = point[1];
      out[2] = point[2];
      return out;
    },
    getFocusDistance(anchor?: FramedPoint): number {
      if (anchor) {
        const p = anchor.position;
        return Math.hypot(
          p[0] - this.cameraPos[0],
          p[1] - this.cameraPos[1],
          p[2] - this.cameraPos[2],
        );
      }
      // No anchor → camera→targetPoint distance, or 0 if no target.
      if (this.targetPoint === null) {
        return Math.hypot(
          this.cameraPos[0],
          this.cameraPos[1],
          this.cameraPos[2],
        );
      }
      return Math.hypot(
        this.targetPoint[0] - this.cameraPos[0],
        this.targetPoint[1] - this.cameraPos[1],
        this.targetPoint[2] - this.cameraPos[2],
      );
    },
    getTargetPosition(
      _frameId?: FrameId,
      out = new Float64Array(3),
    ): Float64Array | null {
      if (this.targetPoint === null) return null;
      out[0] = this.targetPoint[0];
      out[1] = this.targetPoint[1];
      out[2] = this.targetPoint[2];
      return out;
    },
  };
  return api as FrameApi & {
    cameraPos: Float64Array;
    targetPoint: Float64Array | null;
    frame: FrameId;
  };
}

// --- Star layer: Sun-anchored basis (GPT-6's choice) ----------------------
// All tiers selected by distance to Sun. Near-star label detail is handled by
// the layer reading cameraFocusDistance from LodState, not by a different basis.
function makeSunAnchorStarLayer(
  observed: { lod?: LodState; called: boolean } = { called: false },
): ScaleLayer {
  const sunAnchor: FramedPoint = {
    frame: 'galactic',
    position: new Float64Array([0, 0, 0]),
  };
  const tiers: LodTier[] = [
    { maxDistance: 1e17, budgetFrac: 0.5, crossfadeRatio: 0.2 },
    { maxDistance: 1e20, budgetFrac: 0.3, crossfadeRatio: 0.2 },
    { maxDistance: Infinity, budgetFrac: 0.2, crossfadeRatio: 0.2 },
  ];
  return {
    idPrefix: 'star',
    frames: ['galactic'],
    enter() {},
    exit() {},
    update(_dt, _dist, _api, lod) {
      observed.called = true;
      observed.lod = lod;
    },
    renderBudget: 50_000,
    resolveTarget(): ResolvedTarget | null {
      return null;
    },
    basis: 'anchor',
    defaultAnchor: sunAnchor,
    lodTiers: tiers,
  };
}

// --- Galaxy layer: focus basis (Nova's choice) ----------------------------
function makeFocusGalaxyLayer(
  observed: { lod?: LodState; called: boolean } = { called: false },
): ScaleLayer {
  const tiers: LodTier[] = [
    { maxDistance: 1e22, budgetFrac: 0.6, crossfadeRatio: 0.2 },
    { maxDistance: Infinity, budgetFrac: 0.4, crossfadeRatio: 0.2 },
  ];
  return {
    idPrefix: 'galaxy',
    frames: ['galactic'],
    enter() {},
    exit() {},
    update(_dt, _dist, _api, lod) {
      observed.called = true;
      observed.lod = lod;
    },
    renderBudget: 10_000,
    resolveTarget(): ResolvedTarget | null {
      return null;
    },
    basis: 'focus',
    lodTiers: tiers,
  };
}

describe('LayerRegistry — LOD invariants', () => {
  it('cameraFocusDistance always equals api.getFocusDistance() regardless of basis', () => {
    // Camera at 1e10 m from origin — well inside float64 exact-integer range.
    // Target at 1e10 + 100. Star layer is basis 'anchor' (Sun), so selection
    // distance is 1e10 (Sun-anchored) but cameraFocusDistance is ~100.
    const api = makeFakeApi([1e10, 0, 0]);
    api.targetPoint![0] = 1e10 + 100;

    const observed: { lod?: LodState; called: boolean } = { called: false };
    const registry = new LayerRegistry(api);
    registry.register(makeSunAnchorStarLayer(observed));

    registry.update(0.016);

    expect(observed.called).toBe(true);
    expect(observed.lod).toBeDefined();
    const lod = observed.lod!;

    // Selection distance is Sun-anchored (~1e10).
    expect(lod.focusDistance).toBeCloseTo(1e10, -5);
    expect(lod.distanceBasis).toBe('anchor');

    // cameraFocusDistance is always camera→target, regardless of basis.
    expect(lod.cameraFocusDistance).toBeCloseTo(100, 6);
  });

  it('hysteresis holds the tier level inside the dead band', () => {
    const api = makeFakeApi([0, 0, 0]);
    const observed: { lod?: LodState; called: boolean } = { called: false };
    const registry = new LayerRegistry(api);
    const layer = makeFocusGalaxyLayer(observed);
    registry.register(layer);

    const tier0Max = layer.lodTiers![0].maxDistance; // 1e22
    const deadBand = tier0Max * HYSTERESIS_RATIO; // 1.2e22

    // Frame 1: target well inside tier 0.
    api.targetPoint![0] = tier0Max * 0.5;
    registry.update(0.016);
    expect(observed.lod!.level).toBe(0);
    expect(observed.lod!.heldByHysteresis).toBe(false);

    // Frame 2: distance just past tier0.maxDistance but inside the dead band.
    // Tier should NOT demote; hysteresis holds at level 0.
    api.targetPoint![0] = tier0Max * 1.05;
    registry.update(0.016);
    expect(observed.lod!.level).toBe(0);
    expect(observed.lod!.heldByHysteresis).toBe(true);

    // Frame 3: distance past the dead band. Tier should demote to 1.
    api.targetPoint![0] = deadBand * 1.01;
    registry.update(0.016);
    expect(observed.lod!.level).toBe(1);
    expect(observed.lod!.heldByHysteresis).toBe(false);

    // Frame 4: back inside tier 0. Promotes (hysteresis only blocks demotion).
    api.targetPoint![0] = tier0Max * 0.5;
    registry.update(0.016);
    expect(observed.lod!.level).toBe(0);
    expect(observed.lod!.heldByHysteresis).toBe(false);
  });

  it('budgetFrac sums to 1.0 across active layers with mixed bases', () => {
    const api = makeFakeApi([1e19, 0, 0]);
    api.targetPoint![0] = 1e19 + 100; // target near camera

    const starObserved: { lod?: LodState; called: boolean } = { called: false };
    const galaxyObserved: { lod?: LodState; called: boolean } = { called: false };

    const registry = new LayerRegistry(api);
    registry.register(makeSunAnchorStarLayer(starObserved));
    registry.register(makeFocusGalaxyLayer(galaxyObserved));

    registry.update(0.016);

    expect(starObserved.called).toBe(true);
    expect(galaxyObserved.called).toBe(true);
    expect(starObserved.lod).toBeDefined();
    expect(galaxyObserved.lod).toBeDefined();

    // Both layers have Infinite last tiers, so both are always active.
    const sum = starObserved.lod!.budgetFrac + galaxyObserved.lod!.budgetFrac;
    expect(sum).toBeCloseTo(1.0, 10);

    // Star layer is Sun-anchored at 1e19 → tier 1 (1e20 max).
    expect(starObserved.lod!.level).toBe(1);
    expect(starObserved.lod!.distanceBasis).toBe('anchor');

    // Galaxy layer is focus-basis with target 100 m away → tier 0.
    expect(galaxyObserved.lod!.level).toBe(0);
    expect(galaxyObserved.lod!.distanceBasis).toBe('focus');
  });

  it('Infinity last tier never fades and is always active', () => {
    const api = makeFakeApi([0, 0, 0]);
    const observed: { lod?: LodState; called: boolean } = { called: false };
    const registry = new LayerRegistry(api);
    registry.register(makeFocusGalaxyLayer(observed));

    // Even at absurd distance, the Infinity tier is active and crossfade is 1.
    api.targetPoint![0] = 1e40;
    registry.update(0.016);

    expect(observed.called).toBe(true);
    expect(observed.lod!.level).toBe(1);
    expect(observed.lod!.crossfade).toBe(1);
  });

  it('no-target fallback: distanceBasis becomes frame-origin', () => {
    const api = makeFakeApi([1e10, 0, 0]);
    api.targetPoint = null;

    const observed: { lod?: LodState; called: boolean } = { called: false };
    const registry = new LayerRegistry(api);
    registry.register(makeFocusGalaxyLayer(observed));

    registry.update(0.016);

    expect(observed.called).toBe(true);
    expect(observed.lod!.distanceBasis).toBe('frame-origin');
    // Frame-origin distance = camera position norm = 1e10.
    expect(observed.lod!.focusDistance).toBeCloseTo(1e10, -5);
  });

  it('fast jump past last tier still calls update() with level -1 and crossfade 0', () => {
    const api = makeFakeApi([0, 0, 0]);
    const observed: { lod?: LodState; callCount: number } = { callCount: 0 };
    const registry = new LayerRegistry(api);
    const layer = makeFocusGalaxyLayer(observed);

    // Wrap update to count calls (makeFocusGalaxyLayer already stashes `lod`
    // into observed; we just need the call count on top of that).
    const origUpdate = layer.update.bind(layer);
    layer.update = (
      dt: number,
      dist: number,
      a: FrameApi,
      lod: Readonly<LodState>,
    ): void => {
      observed.callCount++;
      origUpdate(dt, dist, a, lod);
    };
    registry.register(layer);

    const tier0Max = layer.lodTiers![0].maxDistance;

    // Frame 1: target inside tier 0 at half its maxDistance.
    // basis 'focus' → focusDistance = camera→targetPoint.
    api.targetPoint[0] = tier0Max * 0.5;
    registry.update(0.016);
    expect(observed.callCount).toBe(1);
    expect(observed.lod!.level).toBe(0);
    expect(observed.lod!.crossfade).toBe(1);

    // Frame 2: target jumps beyond 1.2× the LAST tier's maxDistance in one
    // frame. Layer must still receive update() with level -1 and crossfade 0
    // so it can hide itself; skipping update() would freeze it visible.
    const tiers = layer.lodTiers!;
    const lastMax = tiers[tiers.length - 1].maxDistance;
    api.targetPoint[0] = lastMax * HYSTERESIS_RATIO * 2;
    registry.update(0.016);

    expect(observed.callCount).toBe(2);
    expect(observed.lod!.level).toBe(-1);
    expect(observed.lod!.crossfade).toBe(0);
    expect(observed.lod!.frameOpacity).toBeGreaterThan(0);
  });
});
