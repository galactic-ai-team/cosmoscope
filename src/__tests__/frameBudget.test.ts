// src/__tests__/frameBudget.test.ts (full replacement)
// Tests for FrameBudget. Semantics: trailing-window over-budget count, not
// consecutive streak; alarm requires a full window (warm-up) and fires at
// most once per cooldown period.

import { describe, expect, it, vi } from 'vitest';
import { FrameBudget } from '../core/frameBudget';

const BUDGET = 16.7;

describe('FrameBudget — trailing window semantics', () => {
  it('counts every over-budget frame in the window, not just consecutive', () => {
    const alarms: number[] = [];
    const fb = new FrameBudget({
      budgetMs: BUDGET,
      windowSize: 10,
      threshold: 0.6,
      cooldownFrames: 100,
      onOverBudget: (f) => alarms.push(f),
    });

    // Fill the window with 6 slow + 4 fast = 60%, not over threshold.
    fb.tick(30); fb.tick(30); fb.tick(30);
    fb.tick(30); fb.tick(30); fb.tick(30);
    fb.tick(5);  fb.tick(5);  fb.tick(5);  fb.tick(5);

    expect(fb.trackedFrames).toBe(10);
    expect(fb.overFraction).toBeCloseTo(0.6, 5);
    expect(alarms.length).toBe(0); // exactly at threshold, not over

    // Now tick 4 more slow frames — they evict the 4 oldest (3 slow + 1 fast).
    fb.tick(30); // evict slow, add slow: 6 slow, 4 fast — still 60%
    fb.tick(30); // evict slow, add slow: 6 slow, 4 fast — still 60%
    fb.tick(30); // evict slow, add slow: 6 slow, 4 fast — still 60%
    fb.tick(30); // evict fast, add slow: 7 slow, 3 fast = 70% > 60% → alarm
    expect(alarms.length).toBe(1);
    expect(alarms[0]).toBeGreaterThan(0.6);
  });

  it('does NOT reset the count when a fast frame breaks a streak', () => {
    const alarms: number[] = [];
    const fb = new FrameBudget({
      budgetMs: BUDGET,
      windowSize: 6,
      threshold: 0.5,
      cooldownFrames: 100,
      onOverBudget: (f) => alarms.push(f),
    });

    // 3 slow, 1 fast, 2 slow = 5/6 = 83% over. A consecutive-only tracker
    // would have counted 2, not 5.
    fb.tick(30); fb.tick(30); fb.tick(30);
    fb.tick(5);
    fb.tick(30); fb.tick(30);

    expect(fb.overFraction).toBeCloseTo(5 / 6, 5);
    expect(alarms.length).toBe(1);
  });

  it('evicts old frames as the window slides', () => {
    const fb = new FrameBudget({
      budgetMs: BUDGET,
      windowSize: 4,
      threshold: 0.5,
      cooldownFrames: 100,
    });

    for (let i = 0; i < 4; i++) fb.tick(30);
    expect(fb.overFraction).toBe(1);

    for (let i = 0; i < 4; i++) fb.tick(5);
    expect(fb.overFraction).toBe(0);
  });

  it('fires at most once per cooldown period', () => {
    const onOverBudget = vi.fn();
    const fb = new FrameBudget({
      budgetMs: BUDGET,
      windowSize: 4,
      threshold: 0.5,
      cooldownFrames: 5,
      onOverBudget,
    });

    // Fill window with 4 slow. Warm at ringCount=4 (full window). Alarm fires
    // on the 4th tick.
    fb.tick(30); fb.tick(30); fb.tick(30);
    expect(onOverBudget).not.toHaveBeenCalled();
    fb.tick(30);
    expect(onOverBudget).toHaveBeenCalledTimes(1);

    // 4 more slow ticks. Cooldown 5 means next alarm at framesSinceAlarm >= 5,
    // i.e. the 5th tick after the last alarm (tick 9 overall).
    fb.tick(30); // 1
    fb.tick(30); // 2
    fb.tick(30); // 3
    fb.tick(30); // 4
    expect(onOverBudget).toHaveBeenCalledTimes(1);
    fb.tick(30); // 5 → cooldown expired, alarm fires
    expect(onOverBudget).toHaveBeenCalledTimes(2);
  });

  it('waits for the full window to warm before alarming', () => {
    const onOverBudget = vi.fn();
    const fb = new FrameBudget({
      budgetMs: BUDGET,
      windowSize: 10,
      threshold: 0.5,
      cooldownFrames: 0,
      onOverBudget,
    });

    // First 9 slow frames: window not yet full, no alarm.
    for (let i = 0; i < 9; i++) {
      fb.tick(30);
      expect(onOverBudget).not.toHaveBeenCalled();
    }

    // 10th frame fills the window — alarm fires.
    fb.tick(30);
    expect(onOverBudget).toHaveBeenCalledTimes(1);
  });
});