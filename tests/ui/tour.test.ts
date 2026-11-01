import { describe, it, expect, vi } from 'vitest';
import { createTour, GRAND_TOUR } from '../../src/ui/tour';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('grand tour', () => {
  it('visits every stop in order and finishes', async () => {
    const seen: string[] = [];
    let done: boolean | null = null;
    const t = createTour({ fly: async () => {}, onStop: (id) => seen.push(id), onEnd: (f) => (done = f), wait: async () => {} });
    t.start();
    for (let i = 0; i < 40; i++) await tick();
    expect(seen).toEqual([...GRAND_TOUR]);
    expect(done).toBe(true);
    expect(t.running).toBe(false);
  });

  it('skips a stop whose flight fails', async () => {
    const seen: string[] = [];
    const t = createTour({ fly: async (id) => { if (id === 'b') throw new Error('unknown'); }, onStop: (id) => seen.push(id), wait: async () => {} }, ['a', 'b', 'c']);
    t.start();
    for (let i = 0; i < 20; i++) await tick();
    expect(seen).toEqual(['a', 'c']);
  });

  it('stop() ends the tour and no later stops fire', async () => {
    const seen: string[] = [];
    let release!: () => void;
    let done: boolean | null = null;
    const t = createTour({
      fly: (id) => (id === 'b' ? new Promise<void>((r) => (release = r)) : Promise.resolve()),
      onStop: (id) => seen.push(id),
      onEnd: (f) => (done = f),
      wait: async () => {},
    }, ['a', 'b', 'c']);
    t.start();
    for (let i = 0; i < 10; i++) await tick();
    t.stop();
    release();
    for (let i = 0; i < 10; i++) await tick();
    expect(seen).toEqual(['a']);
    expect(done).toBe(false);
    expect(t.running).toBe(false);
  });

  it('Stop mid-leg cancels the pending flight and returns to the current stop (v1.1)', async () => {
    const flown: string[] = [];
    const seen: string[] = [];
    let cancels = 0;
    const t = createTour({
      fly: (id) => { flown.push(id); return id === 'b' ? new Promise<void>(() => {}) : Promise.resolve(); },
      cancel: () => { cancels++; },
      onStop: (id) => seen.push(id),
      wait: async () => {},
    }, ['a', 'b', 'c']);
    t.start();
    for (let i = 0; i < 10; i++) await tick();
    expect(t.currentStop).toBe('a');
    expect(flown).toEqual(['a', 'b']); // the advance to b is in flight
    t.stop({ returnToStop: true });
    for (let i = 0; i < 10; i++) await tick();
    expect(cancels).toBe(1);
    expect(flown).toEqual(['a', 'b', 'a']); // back to the stop on screen
    expect(seen).toEqual(['a']);
    expect(t.running).toBe(false);
  });

  it('Stop during the dwell clears the timer: no advance, no cancel, no extra flight', async () => {
    vi.useFakeTimers();
    try {
      const flown: string[] = [];
      let cancels = 0;
      const t = createTour({ fly: async (id) => { flown.push(id); }, cancel: () => { cancels++; } }, ['sun', 'rigil'], 4000);
      t.start();
      await vi.advanceTimersByTimeAsync(10);
      expect(t.currentStop).toBe('sun');
      t.stop({ returnToStop: true });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(flown).toEqual(['sun']);
      expect(cancels).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a user grab (stop without returnToStop) cancels the leg but does not fly back', async () => {
    const flown: string[] = [];
    let cancels = 0;
    const t = createTour({
      fly: (id) => { flown.push(id); return id === 'b' ? new Promise<void>(() => {}) : Promise.resolve(); },
      cancel: () => { cancels++; },
      wait: async () => {},
    }, ['a', 'b']);
    t.start();
    for (let i = 0; i < 10; i++) await tick();
    t.stop();
    for (let i = 0; i < 5; i++) await tick();
    expect(cancels).toBe(1);
    expect(flown).toEqual(['a', 'b']);
  });
});

