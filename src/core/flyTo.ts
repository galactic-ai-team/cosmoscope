// src/core/flyTo.ts
// Camera flight between frames, in log-space distance. Resolves a target via
// the layer registry and animates Claude's frame API through frame boundaries.
// Time is in seconds (matches main.ts loop). All frames share ICRS axes, so
// interpolation is position-only — no axis rotation between frames.
//
// Correctness note: resolveTarget returns the target's POSITION in its native
// frame, not a direction. The flight lands the camera at
//   targetPos + approachDist * unit(fromTargetToStart)
// so the camera sits approachDist from the TARGET, looking AT it — not from
// the frame origin. Look-at is applied every frame so the camera orients
// toward the target throughout the flight.
//
// Controls integration: CosmoControls should check `flyer.flying` at the top
// of its input handler and stand down while true. `flyer.cancelFlight()` is a
// controller-level cancel (no handle needed) for ESC-key / user-interrupt.

import type { FrameApi, FramedPoint } from './camera';
import { chooseFrame } from './frameSwitch';
import type { FrameId } from './frames';
import type { LayerRegistry } from './layers';

/** The Sun, as the helio origin (Lumi: frame choice mid-flight). */
const SUN_AT: FramedPoint = { frame: 'helio', position: [0, 0, 0] };

export type TargetKind = 'planet' | 'star' | 'galaxy' | 'cluster';
export type Approach = 'orbit' | 'surface' | 'flyby';

export interface FlyToTarget {
  kind: TargetKind;
  id: string;
  approach: Approach;
}

export interface FlyToHandle {
  promise: Promise<void>;
  cancel(): void;
}

const APPROACH_SCALE: Record<Approach, number> = {
  orbit: 3.0,
  surface: 1.05,
  flyby: 8.0,
};

const MIN_DURATION_S = 0.6;
const MAX_DURATION_S = 2.4;

interface FlightState {
  cancelled: boolean;
  startTime: number;
  duration: number;
  startFrame: FrameId;
  startPos: Float64Array;
  startDistToTarget: number;
  startDir: Float64Array;
  targetPos: Float64Array;
  targetFrame: FrameId;
  endDist: number;
  resolve: () => void;
}

export class FlyToController {
  private state: FlightState | null = null;

  constructor(
    private readonly api: FrameApi,
    private readonly registry: LayerRegistry,
  ) {}

  /** Live read of whether a flight is running. CosmoControls should gate on this. */
  get flying(): boolean {
    return this.state !== null && !this.state.cancelled;
  }

  /** Cancel the current flight, if any. No handle needed. */
  cancelFlight(): void {
    if (this.state) {
      this.state.cancelled = true;
      this.state.resolve();
      this.state = null;
    }
  }

  flyTo(target: FlyToTarget, now = performance.now() / 1000): FlyToHandle {
    const resolved = this.registry.resolveTarget(target.id);
    if (!resolved) {
      return {
        promise: Promise.reject(new Error(`Unknown target: ${target.id}`)),
        cancel: () => {},
      };
    }

    // Cancel any in-progress flight.
    this.cancelFlight();

    const targetFrame = resolved.frameId;
    const targetPos = new Float64Array([
      resolved.worldPos[0],
      resolved.worldPos[1],
      resolved.worldPos[2],
    ]);

    const startPos = new Float64Array(3);
    this.api.getCameraWorldPosition(targetFrame, startPos);

    let dxs = startPos[0] - targetPos[0];
    let dys = startPos[1] - targetPos[1];
    let dzs = startPos[2] - targetPos[2];
    let startDist = Math.hypot(dxs, dys, dzs);
    if (startDist < 1e-9) {
      dxs = 1; dys = 0; dzs = 0;
      startDist = 1e-9;
    }
    const startDir = new Float64Array([dxs / startDist, dys / startDist, dzs / startDist]);

    const endDist = resolved.approachRadius * APPROACH_SCALE[target.approach];

    const ratio = Math.max(
      1,
      Math.max(startDist, endDist) / Math.max(1e-12, Math.min(startDist, endDist)),
    );
    const logRatio = Math.log10(ratio);
    const duration = Math.max(
      MIN_DURATION_S,
      Math.min(MAX_DURATION_S, MIN_DURATION_S + logRatio * 0.3),
    );

    let resolveFn: () => void = () => {};
    const promise = new Promise<void>((res) => {
      resolveFn = res;
    });

    this.state = {
      cancelled: false,
      startTime: now,
      duration,
      startFrame: this.api.getFrameId(),
      startPos,
      startDistToTarget: startDist,
      startDir,
      targetPos,
      targetFrame,
      endDist,
      resolve: resolveFn,
    };

    return {
      promise,
      cancel: () => this.cancelFlight(),
    };
  }

  update(now: number): boolean {
    const s = this.state;
    if (!s || s.cancelled) {
      this.state = null;
      return false;
    }

    const elapsed = now - s.startTime;
    const rawT = Math.min(1, elapsed / s.duration);
    const eased = rawT * rawT * (3 - 2 * rawT);

    const startLog = Math.log10(Math.max(1e-12, s.startDistToTarget));
    const endLog = Math.log10(Math.max(1e-12, s.endDist));
    const curLog = startLog + (endLog - startLog) * eased;
    const curDistFromTarget = Math.pow(10, curLog);

    const outPos = new Float64Array(3);
    outPos[0] = s.targetPos[0] + s.startDir[0] * curDistFromTarget;
    outPos[1] = s.targetPos[1] + s.startDir[1] * curDistFromTarget;
    outPos[2] = s.targetPos[2] + s.startDir[2] * curDistFromTarget;

    // Lumi (Claude's #44 follow-up): pick the camera's frame by distance from
    // the Sun mid-flight too, with the same hysteresis as the idle loop, so a
    // flight from deep space to a planet keeps the star field until it's
    // inside 80 AU, and a flight out from a planet switches to 'galactic' at
    // 120 AU. Path math stays in the target's frame; rebaseTo() is exact.
    const prevFrame = this.api.getFrameId();
    this.api.setCameraFrameAndPosition(s.targetFrame, outPos);
    if (typeof this.api.distanceTo === 'function') { // minimal test fakes skip it
      const want = chooseFrame(prevFrame, this.api.distanceTo(SUN_AT), s.targetFrame);
      if (want !== s.targetFrame) this.api.rebaseTo(want);
    }
    this.api.lookAt(s.targetPos, s.targetFrame);

    if (rawT >= 1) {
      s.resolve();
      this.state = null;
      return false;
    }
    return true;
  }

  get active(): boolean {
    return this.flying;
  }
}
