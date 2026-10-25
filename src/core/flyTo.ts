// src/core/flyTo.ts
// Camera flight between frames, in log-space distance. Resolves a target via
// the layer registry and animates Claude's frame API through frame boundaries.

import type { FrameId, FrameApi } from './frames';
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

/** Minimum flight duration regardless of distance. */
const MIN_DURATION_MS = 600;
/** Maximum flight duration; longer flights get eased faster so users aren't stuck. */
const MAX_DURATION_MS = 2400;

interface FlightState {
  cancelled: boolean;
  startTime: number;
  duration: number;
  startPos: Float64Array;
  startFrame: FrameId;
  target: ResolvedTarget;
  endDistance: number;
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
   * Uses log-space distance so Earth->galaxy doesn't feel like a stall
   * followed by a blur.
   */
  flyTo(target: FlyToTarget): FlyToHandle {
    // Resolve target via registry.
    const resolved = this.registry.resolveTarget(target.id);
    if (!resolved) {
      return {
        promise: Promise.reject(new Error(`Unknown target: ${target.id}`)),
        cancel: () => {},
      };
    }

    // Cancel any existing flight.
    if (this.state) {
      this.state.cancelled = true;
      this.state.resolve();
      this.state = null;
    }

    // Camera state at flight start.
    const startPos = new Float64Array(3);
    this.api.getCameraWorldPosition(startPos);
    const startFrame = this.api.getFrameId();

    // Compute target distance in frame units.
    const endDistance =
      resolved.approachRadius * APPROACH_SCALE[target.approach];

    // Duration scales with log distance ratio, clamped.
    const startDist = this.api.getCameraDistanceToOrigin();
    const endDist = endDistance;
    const ratio = Math.max(1, Math.max(startDist, endDist) / Math.max(1e-12, Math.min(startDist, endDist)));
    const logRatio = Math.log10(ratio);
    const duration = Math.max(
      MIN_DURATION_MS,
      Math.min(MAX_DURATION_MS, MIN_DURATION_MS + logRatio * 300),
    );

    let resolveFn: () => void = () => {};
    const promise = new Promise<void>((res) => {
      resolveFn = res;
    });

    this.state = {
      cancelled: false,
      startTime: performance.now(),
      duration,
      startPos,
      startFrame,
      target: resolved,
      endDistance,
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
   * Tick the flight. Call every frame from the render loop after the frame
   * API has computed the current frame. Returns true if a flight is active.
   */
  update(now: number): boolean {
    const s = this.state;
    if (!s || s.cancelled) {
      this.state = null;
      return false;
    }

    const elapsed = now - s.startTime;
    const rawT = Math.min(1, elapsed / s.duration);
    // Smoothstep ease in log-space distance.
    const eased = rawT * rawT * (3 - 2 * rawT);

    // Interpolate distance in log space (this is the key: linear interpolation
    // of distance would speed up/whoosh near the end; log-space keeps perceived
    // speed uniform).
    const startDist = length(s.startPos);
    const startLog = Math.log10(Math.max(1e-12, startDist));
    const endLog = Math.log10(Math.max(1e-12, s.endDistance));
    const curLog = startLog + (endLog - startLog) * eased;
    const curDist = Math.pow(10, curLog);

    // Interpolate position: linear in world space but normalized to curDist so
    // the flight path arcs rather than diving through the origin.
    const tx = s.target.worldPos[0];
    const ty = s.target.worldPos[1];
    const tz = s.target.worldPos[2];
    const tLen = Math.max(1e-12, Math.hypot(tx, ty, tz));
    const ux = tx / tLen;
    const uy = ty / tLen;
    const uz = tz / tLen;

    // Direction: blend start direction toward target direction.
    const sx = s.startPos[0], sy = s.startPos[1], sz = s.startPos[2];
    const sLen = Math.max(1e-12, Math.hypot(sx, sy, sz));
    const dsx = sx / sLen, dsy = sy / sLen, dsz = sz / sLen;
    const dx = dsx + (ux - dsx) * eased;
    const dy = dsy + (uy - dsy) * eased;
    const dz = dsz + (uz - dsz) * eased;
    const dLen = Math.max(1e-12, Math.hypot(dx, dy, dz));

    const outPos = new Float64Array(3);
    outPos[0] = (dx / dLen) * curDist;
    outPos[1] = (dy / dLen) * curDist;
    outPos[2] = (dz / dLen) * curDist;

    // Set frame based on the target's frame — Claude's frame API should
    // rebase any layers when the frame changes.
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

function length(v: Float64Array): number {
  return Math.hypot(v[0], v[1], v[2]);
}
