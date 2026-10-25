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

import type { FrameApi } from './camera';
import type { FrameId } from './frames';
import type { LayerRegistry } from './layers';

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
  /** Camera position at flight start, in target's frame. */
  startPos: Float64Array;
  /** Camera distance from target at flight start. */
  startDistToTarget: number;
  /** Unit direction from target toward start camera. */
  startDir: Float64Array;
  /** Target position in its native frame (fixed). */
  targetPos: Float64Array;
  targetFrame: FrameId;
  /** Desired final distance from target. */
  endDist: number;
  resolve: () => void;
}

export class FlyToController {
  private state: FlightState | null = null;

  constructor(
    private readonly api: FrameApi,
    private readonly registry: LayerRegistry,
  ) {}

  flyTo(target: FlyToTarget, now = performance.now() / 1000): FlyToHandle {
    const resolved = this.registry.resolveTarget(target.id);
    if (!resolved) {
      return {
        promise: Promise.reject(new Error(`Unknown target: ${target.id}`)),
        cancel: () => {},
      };
    }

    if (this.state) {
      this.state.cancelled = true;
      this.state.resolve();
      this.state = null;
    }

    // --- Compute flight start relative to the target, in the target's frame.
    const targetFrame = resolved.frameId;
    const targetPos = new Float64Array([
      resolved.worldPos[0],
      resolved.worldPos[1],
      resolved.worldPos[2],
    ]);

    const startPos = new Float64Array(3);
    this.api.getCameraWorldPosition(targetFrame, startPos);

    // Vector from target to camera start.
    let dxs = startPos[0] - targetPos[0];
    let dys = startPos[1] - targetPos[1];
    let dzs = startPos[2] - targetPos[2];
    let startDist = Math.hypot(dxs, dys, dzs);

    // Degenerate case: camera exactly at target. Pick an arbitrary direction.
    if (startDist < 1e-9) {
      dxs = 1; dys = 0; dzs = 0;
      startDist = 1e-9;
    }
    const startDir = new Float64Array([dxs / startDist, dys / startDist, dzs / startDist]);

    const endDist = resolved.approachRadius * APPROACH_SCALE[target.approach];

    // Duration scales with log distance ratio, clamped.
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
      cancel: () => {
        if (this.state) {
          this.state.cancelled = true;
          this.state.resolve();
          this.state = null;
        }
      },
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

    // Interpolate DISTANCE FROM TARGET in log space. This is the fix: distance
    // is measured from the target, not from the frame origin.
    const startLog = Math.log10(Math.max(1e-12, s.startDistToTarget));
    const endLog = Math.log10(Math.max(1e-12, s.endDist));
    const curLog = startLog + (endLog - startLog) * eased;
    const curDistFromTarget = Math.pow(10, curLog);

    // Direction: startDir rotates toward the camera's final approach direction.
    // For a stationary target we want the camera to swing around it as it
    // approaches, ending on the "near" side. Simplest good-looking choice:
    // keep the start direction fixed and just shorten the distance. That
    // makes it a straight-line dolly-in, which is what users expect from
    // "fly to". If we ever want an arc, interpolate startDir toward a final
    // dir chosen by the layer.
    const outPos = new Float64Array(3);
    outPos[0] = s.targetPos[0] + s.startDir[0] * curDistFromTarget;
    outPos[1] = s.targetPos[1] + s.startDir[1] * curDistFromTarget;
    outPos[2] = s.targetPos[2] + s.startDir[2] * curDistFromTarget;

    this.api.setCameraFrameAndPosition(s.targetFrame, outPos);
    // Orient camera toward target every frame.
    this.api.lookAt(s.targetPos);

    if (rawT >= 1) {
      s.resolve();
      this.state = null;
      return false;
    }
    return true;
  }

  get active(): boolean {
    return this.state !== null && !this.state.cancelled;
  }
}
