// src/core/flyTo.ts
// Camera flight between frames, in log-space distance. Resolves a target via
// the layer registry and animates Claude's frame API through frame boundaries.
// Time is in seconds (matches main.ts loop). All frames share ICRS axes, so
// interpolation is position-only — no axis rotation between frames.

import type { FrameApi, FrameId } from './camera';
import type { LayerRegistry, ResolvedTarget } from './layers';

export type TargetKind = 'planet' | 'star' | 'galaxy';
export type Approach = 'orbit' | 'surface' | 'flyby';

export interface FlyToTarget {
  kind: TargetKind;
  id: string;
  approach: Approach;
}

export interface FlyToHandle {
  /** Resolves when the flight finishes or is cancelled. */
  promise: Promise<void>;
  /** Cancel the flight; camera stays at its current position. */
  cancel(): void;
}

/** Distance multipliers per approach, applied to the target's approachRadius. */
const APPROACH_SCALE: Record<Approach, number> = {
  orbit: 3.0,
  surface: 1.05,
  flyby: 8.0,
};

/** Minimum flight duration in seconds. */
const MIN_DURATION_S = 0.6;
/** Maximum flight duration in seconds. */
const MAX_DURATION_S = 2.4;

interface FlightState {
  cancelled: boolean;
  startTime: number;
  duration: number;
  startFrame: FrameId;
  startPos: Float64Array;
  startDist: number;
  target: ResolvedTarget;
  endDist: number;
  resolve: () => void;
}

export class FlyToController {
  private state: FlightState | null = null;

  constructor(
    private readonly api: FrameApi,
    private readonly registry: LayerRegistry,
  ) {}

  /**
   * Start a flight to the target. Cancels any flight in progress.
   * `now` is seconds (same clock as main.ts loop). If omitted, uses
   * performance.now()/1000 — but callers should pass the loop's time.
   */
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

    // Camera state at flight start, in the target's frame.
    const startPos = new Float64Array(3);
    this.api.getCameraWorldPosition(resolved.frameId, startPos);
    const startDist = Math.hypot(startPos[0], startPos[1], startPos[2]);

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
      startDist,
      target: resolved,
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

  /**
   * Tick the flight. Call every frame from main.ts after the camera is
   * updated. `now` is seconds. Returns true if a flight is active.
   */
  update(now: number): boolean {
    const s = this.state;
    if (!s || s.cancelled) {
      this.state = null;
      return false;
    }

    const elapsed = now - s.startTime;
    const rawT = Math.min(1, elapsed / s.duration);
    // Smoothstep ease in log-distance.
    const eased = rawT * rawT * (3 - 2 * rawT);

    // Interpolate distance in log space: uniform perceived speed.
    const startLog = Math.log10(Math.max(1e-12, s.startDist));
    const endLog = Math.log10(Math.max(1e-12, s.endDist));
    const curLog = startLog + (endLog - startLog) * eased;
    const curDist = Math.pow(10, curLog);

    // Interpolate direction on the unit sphere (all frames share ICRS axes,
    // so a direction is frame-independent). Normalize both, lerp, renormalize.
    const sx = s.startPos[0], sy = s.startPos[1], sz = s.startPos[2];
    const sLen = Math.max(1e-12, Math.hypot(sx, sy, sz));
    const dsx = sx / sLen, dsy = sy / sLen, dsz = sz / sLen;

    const tx = s.target.worldPos[0];
    const ty = s.target.worldPos[1];
    const tz = s.target.worldPos[2];
    const tLen = Math.max(1e-12, Math.hypot(tx, ty, tz));
    const dtx = tx / tLen, dty = ty / tLen, dtz = tz / tLen;

    let dx = dsx + (dtx - dsx) * eased;
    let dy = dsy + (dty - dsy) * eased;
    let dz = dsz + (dtz - dsz) * eased;
    const dLen = Math.max(1e-12, Math.hypot(dx, dy, dz));
    dx /= dLen; dy /= dLen; dz /= dLen;

    const outPos = new Float64Array(3);
    outPos[0] = dx * curDist;
    outPos[1] = dy * curDist;
    outPos[2] = dz * curDist;

    this.api.setCameraFrameAndPosition(s.target.frameId, outPos);

    if (rawT >= 1) {
      s.resolve();
      this.state = null;
      return false;
    }
    return true;
  }

  /** Is a flight currently in progress? */
  get active(): boolean {
    return this.state !== null && !this.state.cancelled;
  }
}