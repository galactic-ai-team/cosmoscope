import { describe, it, expect } from 'vitest';
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
});
