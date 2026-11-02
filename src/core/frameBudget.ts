// src/core/frameBudget.ts
// Frame-budget reporter and adaptive quality downgrade for mobile perf.
// Instrumented from the main loop; warns (dev) or drops a quality tier (prod)
// when the rolling average frame time exceeds the platform's target.
//
// Target is not always 16ms: iOS ProMotion is 120Hz = 8.33ms/frame; most
// Android phones run at 60Hz = 16.67ms/frame. We detect via window.matchMedia
// for reduced-motion / high-refresh signals, then fall back to a conservative
// 16.67ms baseline for anything we can't identify.

export interface FrameBudgetOptions {
  /** Rolling window for average. Default 60 frames (1 second at 60fps). */
  windowSize?: number;
  /** Override target frame time (ms). If unset, auto-detected. */
  targetMs?: number;
  /** Callback when the rolling average exceeds target by the downgrade threshold. */
  onOverBudget?: (avgMs: number) => void;
  /** Downgrade threshold as a multiplier of target. Default 1.35. */
  downgradeThreshold?: number;
  /** How many consecutive over-budget windows before we call onOverBudget. Default 3. */
  consecutiveFrames?: number;
}

/**
 * Best-effort target frame time based on platform signals. Returns ms.
 */
export function detectTargetFrameMs(): number {
  if (typeof window === 'undefined') return 16.67;
  // ProMotion / high-refresh displays.
  const hiRefresh =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(min-resolution: 2dppx)').matches ||
      window.matchMedia('(update: fast)').matches);
  // iOS Safari on recent devices is 120Hz. Android flagship phones are often
  // 120Hz too. Default to 16.67 (60Hz) for everything else, including desktop
  // where we don't know the refresh rate.
  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (hiRefresh && isIOS) return 8.33;
  return 16.67;
}

/**
 * Read device memory (GB) if exposed. iOS Safari doesn't expose it, so
 * returns undefined there. Used to gate expensive shader features.
 */
export function getDeviceMemoryGb(): number | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return typeof mem === 'number' ? mem : undefined;
}

/**
 * Frame budget tracker. Call `tick(dtMs)` once per frame from the main loop.
 * Returns a `dispose()` function. Emits `onOverBudget` after
 * `consecutiveFrames` over-budget windows in a row (avoids reacting to a
 * single GC pause).
 */
export class FrameBudget {
  private readonly targetMs: number;
  private readonly windowSize: number;
  private readonly downgradeThreshold: number;
  private readonly consecutiveTarget: number;
  private readonly onOverBudget?: (avgMs: number) => void;

  private samples: number[] = [];
  private overCount = 0;

  constructor(opts: FrameBudgetOptions = {}) {
    this.targetMs = opts.targetMs ?? detectTargetFrameMs();
    this.windowSize = opts.windowSize ?? 60;
    this.downgradeThreshold = opts.downgradeThreshold ?? 1.35;
    this.consecutiveTarget = opts.consecutiveFrames ?? 3;
    this.onOverBudget = opts.onOverBudget;
  }

  /** Feed one frame's duration in milliseconds. */
  tick(dtMs: number): void {
    this.samples.push(dtMs);
    if (this.samples.length > this.windowSize) this.samples.shift();

    if (this.samples.length < this.windowSize) return;

    let sum = 0;
    for (const s of this.samples) sum += s;
    const avg = sum / this.samples.length;

    if (avg > this.targetMs * this.downgradeThreshold) {
      this.overCount++;
      if (this.overCount >= this.consecutiveTarget) {
        this.onOverBudget?.(avg);
        // Reset so we don't spam the downgrade callback every frame.
        this.overCount = 0;
        this.samples.length = 0;
      }
    } else {
      this.overCount = 0;
    }
  }

  /** Current rolling average frame time. Useful for HUD/debug. */
  averageMs(): number {
    if (this.samples.length === 0) return 0;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return sum / this.samples.length;
  }

  /** Target the tracker is measuring against. */
  get target(): number {
    return this.targetMs;
  }
}
