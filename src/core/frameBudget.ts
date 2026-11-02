// src/core/frameBudget.ts
// Frame-time budget tracker. Emits an alarm when a configurable fraction of
// the frames in a trailing window exceed the budget. Used to drive LOD tier
// bias and (later) adaptive quality.
//
// Semantics:
//   - Tracks frames in a ring buffer of `windowSize`.
//   - Every frame, counts how many entries in the window are over budget.
//   - If overCount / windowSize > threshold, fires onOverBudget.
//   - Fires at most once per `cooldownFrames` frames to avoid alarm spam.
//   - This is a *trailing window* count, not a consecutive-frame streak. A
//     budget alarm should reflect "recent frames are slow", not "the last N
//     frames were slow" — a single fast frame between two slow ones should not
//     reset a real perf problem.

export interface FrameBudgetOptions {
  /** Frame budget in milliseconds. Frames slower than this count as over. */
  budgetMs: number;
  /** Trailing window size in frames. Default 120 (~2s at 60fps). */
  windowSize?: number;
  /** Fraction of the window that must be over budget to fire. Default 0.6. */
  threshold?: number;
  /** Minimum frames between alarms. Default 30. */
  cooldownFrames?: number;
  /** Called once per alarm. */
  onOverBudget?: (overFraction: number) => void;
}

export class FrameBudget {
  readonly budgetMs: number;
  readonly windowSize: number;
  readonly threshold: number;
  readonly cooldownFrames: number;
  private onOverBudget?: (overFraction: number) => void;

  private ring: Float64Array;
  private ringHead = 0;
  private ringCount = 0;
  private overCount = 0;

  private framesSinceAlarm = 0;
  private hasAlarmed = false;

  constructor(opts: FrameBudgetOptions) {
    this.budgetMs = opts.budgetMs;
    this.windowSize = opts.windowSize ?? 120;
    this.threshold = opts.threshold ?? 0.6;
    this.cooldownFrames = opts.cooldownFrames ?? 30;
    this.onOverBudget = opts.onOverBudget;
    this.ring = new Float64Array(this.windowSize);
  }

  /**
   * Record a frame's duration in ms. Returns true if this call fired an alarm.
   */
  tick(frameMs: number): boolean {
    const over = frameMs > this.budgetMs ? 1 : 0;

    // Evict the oldest entry if the ring is full.
    if (this.ringCount === this.windowSize) {
      const evicted = this.ring[this.ringHead];
      if (evicted > this.budgetMs) this.overCount--;
    } else {
      this.ringCount++;
    }

    this.ring[this.ringHead] = frameMs;
    this.ringHead = (this.ringHead + 1) % this.windowSize;
    if (over) this.overCount++;

    this.framesSinceAlarm++;

    // Only consider alarms once the window is warm (or at least half-filled,
    // so an early spike doesn't fire before we have data).
    const warm = this.ringCount >= this.windowSize / 2;
    const overFraction = this.ringCount > 0 ? this.overCount / this.ringCount : 0;
    const alarmWanted = warm && overFraction > this.threshold;

    const cooldownOk =
      !this.hasAlarmed || this.framesSinceAlarm >= this.cooldownFrames;

    if (alarmWanted && cooldownOk) {
      this.framesSinceAlarm = 0;
      this.hasAlarmed = true;
      this.onOverBudget?.(overFraction);
      return true;
    }
    return false;
  }

  /** Fraction of the current window that is over budget (0..1). */
  get overFraction(): number {
    return this.ringCount > 0 ? this.overCount / this.ringCount : 0;
  }

  /** Number of frames currently tracked (0..windowSize). */
  get trackedFrames(): number {
    return this.ringCount;
  }

  /** Reset all state. Useful for tests and scene reloads. */
  reset(): void {
    this.ring.fill(0);
    this.ringHead = 0;
    this.ringCount = 0;
    this.overCount = 0;
    this.framesSinceAlarm = 0;
    this.hasAlarmed = false;
  }
}
