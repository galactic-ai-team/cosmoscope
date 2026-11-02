// src/__tests__/frameBudget.test.ts
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

    // Fill the window with 6 slow + 4 fast = 60%. Exactly at threshold
    // (not over) — no alarm.
    fb.tick(30); fb.tick(30); fb.tick(30);
    fb.tick(30); fb.tick(30); fb.tick(30);
    fb.tick(5);  fb.tick(5);  fb.tick(5);  fb.tick(5);

    expect(fb.trackedFrames).toBe(10);
    expect(fb.overFraction).toBeCloseTo(0.6, 5);
    expect(alarms.length).toBe(0);

    // Ring layout after fill (head at index 0, oldest first):
    //   [slow, slow, slow, slow, slow, slow, fast, fast, fast, fast]
    // Each tick(30) evicts the oldest slot and inserts a slow at the tail.
    // Ticks 1-6 evict the six slow slots → still 6 slow, 4 fast = 60%.
    // Tick 7 evicts the first fast slot → 7 slow, 3 fast = 70% → alarm.
    for (let i = 0; i < 6; i++) {
      fb.tick(30);
      expect(alarms.length).toBe(0);
      expect(fb.overFraction).toBeCloseTo(0.6, 5);
    }

    fb.tick(30); // evict fast → 7 slow, 3 fast = 70% → alarm
    expect(alarms.length).toBe(1);
    expect(alarms[0]).toBeCloseTo(0.7, 5);
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

    fb.tick(30); fb.tick(30); fb.tick(30);
    expect(onOverBudget).not.toHaveBeenCalled();
    fb.tick(30);
    expect(onOverBudget).toHaveBeenCalledTimes(1);

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

    for (let i = 0; i < 9; i++) {
      fb.tick(30);
      expect(onOverBudget).not.toHaveBeenCalled();
    }

    fb.tick(30);
    expect(onOverBudget).toHaveBeenCalledTimes(1);
  });
});
