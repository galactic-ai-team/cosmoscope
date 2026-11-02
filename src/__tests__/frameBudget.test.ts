// src/__tests__/frameBudget.test.ts (full replacement)
// Tests for FrameBudget. Semantics under test: trailing-window over-budget
// count, not consecutive-frame streak; alarm fires once per cooldown window.

import { describe, expect, it, vi } from 'vitest';
import { FrameBudget } from '../core/frameBudget';

const BUDGET = 16.7; // ~60 fps

describe('FrameBudget — trailing window semantics', () => {
  it('counts every over-budget frame in the window, not just consecutive', () => {
    const alarms: number[] = [];
    const fb = new FrameBudget({
      budgetMs: BUDGET,
      windowSize: 10,
      threshold: 0.6,
      cooldownFrames: 100, // suppress second alarm for this test
      onOverBudget: (f) => alarms.push(f),
    });

    // Warm the window with fast frames.
    for (let i = 0; i < 5; i++) fb.tick(5);

    // 4 over-budget frames interleaved with fast ones — no *consecutive* streak
    // longer than 2, but 4/10 in the window = 40%. Under threshold.
    fb.tick(30); // over
    fb.tick(5);  // fast
    fb.tick(30); // over
    fb.tick(5);  // fast
    fb.tick(30); // over
    fb.tick(5);  // fast
    fb.tick(30); // over
    fb.tick(5);  // fast

    // Window now has 4/10 over = 40%, under 60%. No alarm.
    expect(alarms.length).toBe(0);
    expect(fb.overFraction).toBeCloseTo(0.4, 5);

    // Two more over-budget frames push to 6/10 = 60%, still not > threshold.
    fb.tick(30);
    fb.tick(30);
    expect(alarms.length).toBe(0);

    // One more over → 7/10 = 70% > 60%. Alarm fires.
    fb.tick(30);
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

    // 3 over, 1 fast, 2 over — 5/6 = 83% over. A consecutive-only tracker
    // would have counted 2, not 5.
    fb.tick(30);
    fb.tick(30);
    fb.tick(30);
    fb.tick(5);
    fb.tick(30);
    fb.tick(30);

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

    // Fill window with over-budget frames.
    for (let i = 0; i < 4; i++) fb.tick(30);
    expect(fb.overFraction).toBe(1);

    // Push 4 fast frames — should evict all 4 over-budget entries.
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

    // 4 over → alarm on 4th frame (window warm).
    for (let i = 0; i < 4; i++) fb.tick(30);
    expect(onOverBudget).toHaveBeenCalledTimes(1);

    // Next 4 frames also over, but cooldown blocks the alarm.
    for (let i = 0; i < 4; i++) fb.tick(30);
    expect(onOverBudget).toHaveBeenCalledTimes(1);

    // 5th frame after alarm — cooldown expired, alarm fires again.
    fb.tick(30);
    expect(onOverBudget).toHaveBeenCalledTimes(2);
  });

  it('waits for the window to warm before alarming', () => {
    const onOverBudget = vi.fn();
    const fb = new FrameBudget({
      budgetMs: BUDGET,
      windowSize: 10,
      threshold: 0.5,
      cooldownFrames: 0,
      onOverBudget,
    });

    // First 4 frames over budget. Warm threshold is windowSize/2 = 5, so no
    // alarm yet even though fraction is 100%.
    for (let i = 0; i < 4; i++) {
      fb.tick(30);
      expect(onOverBudget).not.toHaveBeenCalled();
    }

    // 5th frame warms the window — alarm fires.
    fb.tick(30);
    expect(onOverBudget).toHaveBeenCalledTimes(1);
  });
});
