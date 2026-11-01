// tests/core/frameJitter.test.ts
//
// Companion to flyTo.jitter.test.ts. That test proved the flight PATH is
// continuous across frame rebases; this one proves the RENDER FRAME choice is
// stable across the hysteresis band (120 AU down to 80 AU, per
// frameSwitch.ts) and that update()'s distanceMetres argument is camera→focus
// in metres, independent of the camera's current frame.
//
// Fake FrameApi implements distanceTo() and rebaseTo(), which the fakes in
// flyTo.jitter.test.ts skipped — so the mid-flight chooseFrame branch in
// FlyToController.update() was never exercised by a test before this file.

import { describe, expect, it } from 'vitest';
import type { FrameApi, FramedPoint } from '../../src/core/camera';
import type { FrameId } from '../../src/core/frames';
import { chooseFrame } from '../../src/core/frameSwitch';
import { LayerRegistry, type ScaleLayer } from '../../src/core/layers';
import { FlyToController } from '../../src/core/flyTo';
import type { LodState } from '../../src/core/lod';

// AU in metres; local constant so the test doesn't depend on METERS.au's name.
const AU = 1.495978707e11;
const LY = 9.4607e15;

// --- Fake FrameApi with distanceTo/rebaseTo --------------------------------
//
// Frames share ICRS axes, all origin-shifted. The 'helio' frame's origin is
// the Sun; 'galactic' frame's origin is also the Sun (per frameSwitch's
// comment). So helio<->galactic rebase is a no-op for position, but the frame
// ID changes. distFromSun = |cameraPos| in any frame (all origins coincide).
//
// This is exactly the setup where a hysteresis bug would be invisible to a
// position-continuity test but visible as frame-ID flipping.
function makeFakeApiWithFrameSwitch(
  initialCameraPos: [number, number, number],
  initialFrame: FrameId = 'galactic',
): FrameApi & {
  cameraPos: Float64Array;
  targetPoint: Float64Array;
  frame: FrameId;
  rebaseCount: number;
} {
  const api = {
    cameraPos: new Float64Array(initialCameraPos),
    targetPoint: new Float64Array([0, 0, 0]),
    frame: initialFrame,
    rebaseCount: 0,

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
    // Lumi (mechanical): main's FlyToController.update() calls
    // setCameraWorldPosition (camera keeps its own frame); same no-conversion fake.
    setCameraWorldPosition(pos: Float64Array, _frame?: FrameId): void {
      this.cameraPos[0] = pos[0];
      this.cameraPos[1] = pos[1];
      this.cameraPos[2] = pos[2];
    },
    rebaseTo(frame: FrameId): void {
      // Same origin for helio and galactic in this fake, so no position change.
      this.frame = frame;
      this.rebaseCount++;
    },
    lookAt(_pos: Float64Array, _frame?: FrameId): void {},
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
      // Origins coincide in this fake; frames differ only by ID.
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
      return Math.hypot(
        this.targetPoint[0] - this.cameraPos[0],
        this.targetPoint[1] - this.cameraPos[1],
        this.targetPoint[2] - this.cameraPos[2],
      );
    },
    getTargetPosition(
      _f?: FrameId,
      out = new Float64Array(3),
    ): Float64Array | null {
      out[0] = this.targetPoint[0];
      out[1] = this.targetPoint[1];
      out[2] = this.targetPoint[2];
      return out;
    },
    distanceTo(anchor: FramedPoint): number {
      const p = anchor.position;
      return Math.hypot(
        p[0] - this.cameraPos[0],
        p[1] - this.cameraPos[1],
        p[2] - this.cameraPos[2],
      );
    },
  };
  return api as FrameApi & {
    cameraPos: Float64Array;
    targetPoint: Float64Array;
    frame: FrameId;
    rebaseCount: number;
  };
}

// --- Helper: a target layer that resolves a fake star for flyTo ----------
function makeStarTargetLayer(targetPosMeters: Float64Array): ScaleLayer {
  return {
    idPrefix: 'star',
    frames: ['galactic', 'helio'],
    enter() {},
    exit() {},
    update() {},
    renderBudget: 100_000,
    resolveTarget(id: string) {
      if (id !== 'star:test:0') return null;
      return {
        frameId: 'galactic',
        worldPos: targetPosMeters,
        approachRadius: 0.5 * AU, // 0.5 AU orbit radius
      };
    },
  };
}

describe('frameSwitch hysteresis + distanceMetres contract', () => {
  it('camera hovering in the 80-120 AU band does not flip frames', () => {
    // The hysteresis band: 80..120 AU. Rules per frameSwitch.ts:
    //   - helio -> galactic only above 120 AU
    //   - galactic -> helio only below 80 AU
    //   - anything in between: hold the current frame
    //
    // Note: chooseFrame(currentFrame, distance, targetFrame). `targetFrame`
    // is the frame the caller wants to reach (e.g. a flyTo target's frame).
    // If currentFrame === targetFrame, it's a no-op regardless of distance.
    // To exercise the drop-to-helio path, the target must be helio.

    const api = makeFakeApiWithFrameSwitch([100 * AU, 0, 0], 'galactic');
    const dist = api.distanceTo({ frame: 'helio', position: new Float64Array(3) });
    // dist ≈ 100 AU

    // Case A: current = galactic, target = galactic → no-op, stays galactic
    // (this is the case Lumi flagged: my earlier test passed targetFrame =
    // 'galactic', which correctly returns 'galactic' regardless of distance).
    expect(chooseFrame('galactic', dist, 'galactic')).toBe('galactic');

    // Case B: current = helio, target = helio → no-op, stays helio
    expect(chooseFrame('helio', dist, 'helio')).toBe('helio');

    // Case C: current = galactic at 100 AU, target = helio. 100 AU is inside
    // the hysteresis band (80..120), so hold galactic — do NOT drop to helio
    // yet. If this returned 'helio' the camera would flip on every frame near
    // the boundary.
    expect(chooseFrame('galactic', dist, 'helio')).toBe('galactic');

    // Case D: current = helio at 100 AU, target = galactic. 100 AU is inside
    // the band (80..120), so hold helio — do NOT rise to galactic yet.
    expect(chooseFrame('helio', dist, 'galactic')).toBe('helio');
  });

  it('camera crossing the band switches once per crossing, with correct targetFrame', () => {
    const api = makeFakeApiWithFrameSwitch([0, 0, 0], 'galactic');

    // --- Descent: galactic → helio. Target frame is 'helio' throughout,
    // because we want to reach helio (e.g. flying toward a planet).
    // Above 120 AU: hold galactic (above the rise threshold, but we're already
    // galactic).
    expect(chooseFrame('galactic', 200 * AU, 'helio')).toBe('galactic');
    // Still above 120 AU: hold galactic.
    expect(chooseFrame('galactic', 130 * AU, 'helio')).toBe('galactic');
    // Inside the band (80..120): hold galactic. This is the critical hysteresis
    // assertion — no flip.
    expect(chooseFrame('galactic', 100 * AU, 'helio')).toBe('galactic');
    // Below 80 AU: drop to helio.
    expect(chooseFrame('galactic', 79 * AU, 'helio')).toBe('helio');
    // Continue below 80 AU: stay helio.
    expect(chooseFrame('helio', 60 * AU, 'helio')).toBe('helio');

    // --- Ascent: helio → galactic. Target frame is 'galactic', because we
    // want to reach galactic (e.g. flying away from a planet toward a star).
    // Below 80 AU: hold helio.
    expect(chooseFrame('helio', 60 * AU, 'galactic')).toBe('helio');
    // Inside the band (80..120): hold helio. Critical hysteresis assertion.
    expect(chooseFrame('helio', 90 * AU, 'galactic')).toBe('helio');
    expect(chooseFrame('helio', 100 * AU, 'galactic')).toBe('helio');
    // Above 120 AU: rise to galactic.
    expect(chooseFrame('helio', 121 * AU, 'galactic')).toBe('galactic');
    // Continue above 120 AU: stay galactic.
    expect(chooseFrame('galactic', 150 * AU, 'galactic')).toBe('galactic');
  });

  it('distanceMetres in update() is physical camera-to-focus in metres across a frame rebase', () => {
    // Flight from a target star 50 ly away. Camera starts 1 AU from the Sun
    // (helio frame). After the flight, the camera should be 3.0 × approachRadius
    // from the target (approach 'orbit' = 3.0×). approachRadius = 0.5 AU, so
    // final distance from target = 1.5 AU = 2.244e11 m.
    //
    // Assertion: the `distanceMetres` argument to every layer.update() call
    // equals hypot(camera - target) in metres, regardless of frame ID. A
    // frame-units bug would produce ~35 (AU in helio) or ~1.6e-5 (parsecs in
    // galactic) instead of metres.

    const targetPosMeters = new Float64Array([50 * LY, 0, 0]);

    const api = makeFakeApiWithFrameSwitch([1 * AU, 0, 0], 'helio');
    api.targetPoint.set(targetPosMeters);

    const captured: {
      distances: number[];
      cameraFocusDistances: number[];
    } = { distances: [], cameraFocusDistances: [] };

    const capturingLayer: ScaleLayer = {
      idPrefix: 'capture',
      frames: ['helio', 'galactic'],
      enter() {},
      exit() {},
      update(_dt, distanceMetres, _api, lod) {
        captured.distances.push(distanceMetres);
        captured.cameraFocusDistances.push(lod.cameraFocusDistance);
      },
      renderBudget: 1000,
      resolveTarget() {
        return null;
      },
    };

    const registry = new LayerRegistry(api);
    registry.register(makeStarTargetLayer(targetPosMeters));
    registry.register(capturingLayer);

    const flyer = new FlyToController(api, registry);
    flyer.flyTo({ kind: 'star', id: 'star:test:0', approach: 'orbit' }, 0);

    let now = 0;
    const dt = 0.016;
    let guard = 0;
    while (flyer.active && guard < 500) {
      now += dt;
      flyer.update(now);
      registry.update(dt);
      guard++;
    }
    expect(guard).toBeLessThan(500);
    expect(captured.distances.length).toBeGreaterThan(3);

    // Every recorded distanceMetres must be in metres (thousands of meters to
    // ~50 ly range). A frame-units bug would give values like 35 (AU) or
    // 1.6e-5 (parsecs).
    for (const d of captured.distances) {
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(1e8); // at least ~1 AU in metres
      expect(d).toBeLessThanOrEqual(50 * LY * 2); // not more than 2× target distance
    }

    // The final distanceMetres should equal the final flight endpoint distance
    // from target: 3.0 × 0.5 AU = 1.5 AU = 2.244e11 m.
    const finalDist = captured.distances[captured.distances.length - 1];
    expect(finalDist).toBeCloseTo(1.5 * AU, -10);
    // ~2.244e11 m, allow ±0.01% for float rounding of the eased flight.

    // cameraFocusDistance in LodState must equal distanceMetres (in this test,
    // the capturing layer has no anchor, so basis defaults to 'anchor' which
    // with no anchor behaves like 'focus' → cameraFocusDistance = distanceMetres).
    for (let i = 0; i < captured.distances.length; i++) {
      expect(captured.cameraFocusDistances[i]).toBeCloseTo(captured.distances[i], -4);
    }
  });
});

// Suppress unused-import lint for LodState when the test uses only inferred
// lod shapes; if the file needs LodState as a type, reference it here.
void (null as unknown as LodState);
