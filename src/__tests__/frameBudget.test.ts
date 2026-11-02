// src/__tests__/frameBudget.test.ts
// Unit tests for frameBudget.ts: target detection, rolling average, overage
// callback. Uses explicit targetMs to avoid platform-dependent test flakiness.

import { describe, expect, it, vi } from 'vitest';
import {
  FrameBudget,
  detectTargetFrameMs,
  getDeviceMemoryGb,
} from '../core/frameBudget';

describe('detectTargetFrameMs', () => {
  it('returns a positive number on the current platform', () => {
    const ms = detectTargetFrameMs();
    expect(ms).toBeGreaterThan(0);
    // Sanity: should be one of the two well-known values in test envs.
    expect([8.33, 16.67]).toContain(ms);
  });

  it('returns 60Hz baseline on non-mobile test environments', () => {
    // Vitest/jsdom does not report iPad/iPhone, so this should be 16.67.
    expect(detectTargetFrameMs()).toBe(16.67);
  });
});

describe('getDeviceMemoryGb', () => {
  it('returns undefined when navigator.deviceMemory is absent', () => {
    // Test envs don't expose deviceMemory; expect undefined.
    expect(getDeviceMemoryGb()).toBeUndefined();
  });
});

describe('FrameBudget', () => {
  it('does not call onOverBudget before window is full', () => {
    const onOver = vi.fn();
    const fb = new FrameBudget({ targetMs: 16, windowSize: 10, onOverBudget: onOver });
    for (let i = 0; i < 5; i++) fb.tick(30); // half the window
    expect(onOver).not.toHaveBeenCalled();
  });

  it('does not call onOverBudget for over-budget windows below threshold', () => {
    const onOver = vi.fn();
    const fb = new FrameBudget({
      targetMs: 16,
      windowSize: 10,
      consecutiveFrames: 2,
      downgradeThreshold: 1.5,
      onOverBudget: onOver,
    });
    // 20ms average = 1.25× target, below 1.5× threshold.
    for (let i = 0; i < 30; i++) fb.tick(20);
    expect(onOver).not.toHaveBeenCalled();
  });

  it('calls onOverBudget after N consecutive over-budget windows', () => {
    const onOver = vi.fn();
    const fb = new FrameBudget({
      targetMs: 16,
      windowSize: 10,
      consecutiveFrames: 2,
      downgradeThreshold: 1.3,
      onOverBudget: onOver,
    });
    // 30ms average = 1.875× target, well over 1.3× threshold.
    // Window size 10, need 2 consecutive windows = 20 ticks.
    for (let i = 0; i < 19; i++) fb.tick(30);
    expect(onOver).not.toHaveBeenCalled();
    fb.tick(30); // 20th tick completes second over-budget window
    expect(onOver).toHaveBeenCalledTimes(1);
  });

  it('resets the over-budget counter when a window is on-budget', () => {
    const onOver = vi.fn();
    const fb = new FrameBudget({
      targetMs: 16,
      windowSize: 10,
      consecutiveFrames: 2,
      downgradeThreshold: 1.3,
      onOverBudget: onOver,
    });
    // One over-budget window (10 ticks at 30ms), then one on-budget (10 at 10ms).
    for (let i = 0; i < 10; i++) fb.tick(30);
    for (let i = 0; i < 10; i++) fb.tick(10);
    // Now one over-budget window again.
    for (let i = 0; i < 10; i++) fb.tick(30);
    // Counter should have reset on the on-budget window, so we're only at 1
    // consecutive over-budget window — not enough to fire.
    expect(onOver).not.toHaveBeenCalled();
  });

  it('resets its sample buffer after firing onOverBudget', () => {
    const onOver = vi.fn();
    const fb = new FrameBudget({
      targetMs: 16,
      windowSize: 10,
      consecutiveFrames: 1,
      downgradeThreshold: 1.3,
      onOverBudget: onOver,
    });
    for (let i = 0; i < 10; i++) fb.tick(30); // one over-budget window
    expect(onOver).toHaveBeenCalledTimes(1);
    // After firing, samples are cleared, so average is 0 until we tick again.
    expect(fb.averageMs()).toBe(0);
  });

  it('averageMs reflects the rolling window', () => {
    const fb = new FrameBudget({ targetMs: 16, windowSize: 4 });
    fb.tick(10);
    fb.tick(20);
    fb.tick(10);
    fb.tick(20);
    // Average should be (10+20+10+20)/4 = 15.
    expect(fb.averageMs()).toBeCloseTo(15, 6);
  });

  it('target reflects the configured value', () => {
    const fb = new FrameBudget({ targetMs: 8.33 });
    expect(fb.target).toBe(8.33);
  });

  it('window size 1 fires after a single over-budget frame', () => {
    const onOver = vi.fn();
    const fb = new FrameBudget({
      targetMs: 16,
      windowSize: 1,
      consecutiveFrames: 1,
      downgradeThreshold: 1.3,
      onOverBudget: onOver,
    });
    fb.tick(30);
    expect(onOver).toHaveBeenCalledTimes(1);
  });
});