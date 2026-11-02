import { describe, expect, it } from 'vitest';
import { FLY_BODY_IDS, FLY_INTO_EARTH, createFlyIntoEarthTrigger, freeFlySpeedForDistance, mountFreeFlyUi, pickNearestBody } from '../../src/ui/freeFly';
import { defaultSpeedForDistance } from '../../src/core/flyControls';
import type { FramedPoint } from '../../src/core/camera';

const pt = (x: number): FramedPoint => ({ frame: 'helio', position: [x, 0, 0] });

describe('pickNearestBody', () => {
  it('picks the nearest SURFACE, not the nearest centre', () => {
    // A big body whose centre is farther can still have the nearer surface.
    const small = { point: pt(10), radius: 1 }; // gap 9
    const big = { point: pt(20), radius: 15 }; // gap 5
    expect(pickNearestBody([small, big], (p) => p.position[0])?.point).toBe(big.point);
  });
  it('ignores non-finite distances and returns null for no candidates', () => {
    expect(pickNearestBody([], () => 1)).toBeNull();
    expect(pickNearestBody([{ point: pt(1), radius: 0 }], () => Number.NaN)).toBeNull();
  });
  it('includes the Sun and Earth', () => {
    expect(FLY_BODY_IDS).toContain('star:sol:sun');
    expect(FLY_BODY_IDS).toContain('planet:earth');
  });
});

describe('freeFlySpeedForDistance', () => {
  it('is the full gap per second: twice Claude\'s default, same 2 m/s floor', () => {
    expect(freeFlySpeedForDistance(1e7)).toBe(1e7);
    expect(freeFlySpeedForDistance(1e7)).toBe(2 * defaultSpeedForDistance(1e7));
    expect(freeFlySpeedForDistance(0.5)).toBe(2);
  });
  it('9 R -> 1.05 R holding W takes about 5-6 s (ideal exponential approach)', () => {
    // gap shrinks as d(gap)/dt = -speed(gap); from 8 R gap to 0.05 R gap.
    const R = 6.371e6;
    let gap = 8 * R;
    let t = 0;
    const dt = 1 / 60;
    while (gap > 0.05 * R && t < 60) {
      gap -= freeFlySpeedForDistance(gap) * dt;
      t += dt;
    }
    expect(t).toBeGreaterThan(4.5);
    expect(t).toBeLessThan(6.5);
  });
});

describe('createFlyIntoEarthTrigger', () => {
  it('fires once when free-flying inside fireAtR, re-arms only past rearmAtR', () => {
    const t = createFlyIntoEarthTrigger();
    expect(FLY_INTO_EARTH.fireAtR).toBeGreaterThan(1.002); // above Claude's fly clearance
    expect(t.update(3, true)).toBe(false);
    expect(t.update(1.005, true)).toBe(true);
    expect(t.update(1.004, true)).toBe(false); // cancelled fade must not re-fire at once
    expect(t.update(1.1, true)).toBe(false);
    expect(t.armed).toBe(false);
    expect(t.update(1.3, true)).toBe(false);
    expect(t.armed).toBe(true);
    expect(t.update(1.009, true)).toBe(true);
  });
  it('fires at 1.05 R (Claude #64 review) and re-arms at 1.2 R', () => {
    expect(FLY_INTO_EARTH.fireAtR).toBe(1.05);
    expect(FLY_INTO_EARTH.rearmAtR).toBe(1.2);
    const t = createFlyIntoEarthTrigger();
    expect(t.update(1.06, true)).toBe(false);
    expect(t.update(1.049, true)).toBe(true);
    expect(t.update(1.19, true)).toBe(false);
    expect(t.armed).toBe(false);
    expect(t.update(1.21, true)).toBe(false);
    expect(t.armed).toBe(true);
  });
  it('never fires when not free-flying (orbit mode has its own trigger)', () => {
    const t = createFlyIntoEarthTrigger();
    expect(t.update(1.001, false)).toBe(false);
    expect(t.update(Infinity, true)).toBe(false);
  });
});

// Minimal fake DOM (vitest runs in node, no jsdom), as in walkOnEarth.test.ts.
type Listener = (e: any) => void;
function target() {
  const ls = new Map<string, Listener[]>();
  return {
    ls,
    addEventListener(type: string, fn: Listener) { ls.set(type, [...(ls.get(type) ?? []), fn]); },
    fire(type: string, e: any) { for (const fn of ls.get(type) ?? []) fn(e); },
  };
}
function fakeEl(tag: string) {
  const attrs = new Map<string, string>();
  const kids: any[] = [];
  return Object.assign(target(), {
    tagName: tag.toUpperCase(), id: '', type: '', hidden: false, title: '', innerHTML: '', textContent: '',
    setAttribute: (k: string, v: string) => attrs.set(k, v), getAttribute: (k: string) => attrs.get(k),
    append: (c: any) => kids.push(c), kids,
  });
}
function setup() {
  const els: ReturnType<typeof fakeEl>[] = [];
  const doc = Object.assign(target(), {
    createElement: (tag: string) => { const e = fakeEl(tag); els.push(e); return e; },
    head: { append() {} }, body: { append() {} },
  });
  const keys: Array<[string, boolean]> = [];
  const speeds: number[] = [];
  const fly = {
    enabled: false,
    setKey: (code: string, down: boolean) => { keys.push([code, down]); return true; },
    adjustSpeed: (s: number) => { speeds.push(s); },
  };
  let toggles = 0;
  const ui = mountFreeFlyUi({ fly, toggle: () => { toggles++; fly.enabled = !fly.enabled; }, doc: doc as unknown as Document });
  const btn = els.find((e) => e.id === 'free-fly')!;
  const pad = els.find((e) => e.id === 'fly-pad')!;
  return { doc, btn, pad, fly, keys, speeds, ui, toggles: () => toggles };
}

describe('mountFreeFlyUi', () => {
  it('button and F key toggle; the pad and pressed state follow', () => {
    const s = setup();
    expect(s.btn.getAttribute('aria-pressed')).toBe('false');
    expect(s.pad.hidden).toBe(true);
    s.btn.fire('click', { stopPropagation() {} });
    expect(s.toggles()).toBe(1);
    expect(s.btn.getAttribute('aria-pressed')).toBe('true');
    expect(s.pad.hidden).toBe(false);
    s.doc.fire('keydown', { code: 'KeyF', target: null });
    expect(s.toggles()).toBe(2);
    expect(s.pad.hidden).toBe(true);
  });
  it('F typed into the search box, with modifiers or auto-repeat does not toggle', () => {
    const s = setup();
    s.doc.fire('keydown', { code: 'KeyF', target: { tagName: 'INPUT' } });
    s.doc.fire('keydown', { code: 'KeyF', ctrlKey: true, target: null });
    s.doc.fire('keydown', { code: 'KeyF', repeat: true, target: null });
    expect(s.toggles()).toBe(0);
  });
  it('touch pad: Up/Down hold E/Q, Faster/Slower adjust speed by +/-2', () => {
    const s = setup();
    const [up, faster, down, slower] = s.pad.kids;
    up.fire('pointerdown', { preventDefault() {} });
    up.fire('pointerup', {});
    down.fire('pointerdown', { preventDefault() {} });
    down.fire('pointercancel', {});
    faster.fire('click', {});
    slower.fire('click', {});
    expect(s.keys).toEqual([['KeyE', true], ['KeyE', false], ['KeyQ', true], ['KeyQ', false]]);
    expect(s.speeds).toEqual([2, -2]);
  });
});
