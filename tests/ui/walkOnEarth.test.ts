import { describe, expect, it } from 'vitest';
import { isTypingTarget, mountWalkOnEarth, type EarthSample } from '../../src/ui/walkOnEarth';

// Minimal fake DOM (vitest runs in node, no jsdom).
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
  const classes = new Set<string>();
  const small = { textContent: '' };
  return Object.assign(target(), {
    tagName: tag.toUpperCase(), id: '', type: '', hidden: false, title: '', innerHTML: '', textContent: '',
    setAttribute() {}, querySelector: () => small,
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), has: (c: string) => classes.has(c) },
  });
}
function setup(opts: { distanceR: number; flying?: () => boolean }) {
  const els: ReturnType<typeof fakeEl>[] = [];
  const doc = Object.assign(target(), {
    createElement: (tag: string) => { const e = fakeEl(tag); els.push(e); return e; },
    head: { append() {} }, body: { append() {} },
  });
  const win = target();
  const canvas = target();
  const state = { distanceR: opts.distanceR, navigated: [] as string[] };
  const ui = mountWalkOnEarth({
    canvas: canvas as any, doc: doc as any, win: win as any, reducedMotion: true,
    flightActive: opts.flying,
    navigate: (u) => state.navigated.push(u),
    sample: (): EarthSample => ({ distanceR: state.distanceR, spot: () => ({ lat: 40.7, lon: -74, headingDeg: 0, solarHour: 12 }) }),
  });
  const btn = els.find((e) => e.id === 'walk-earth')!;
  const fade = els.find((e) => e.id === 'earth-fade')!;
  const key = (key: string, tgt: unknown = { tagName: 'CANVAS' }) => doc.fire('keydown', { key, target: tgt });
  return { ui, btn, fade, key, state };
}

describe('isTypingTarget', () => {
  it('is true for inputs, textareas, selects and contenteditable', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as any)).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as any)).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' } as any)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as any)).toBe(true);
  });
  it('is false for the canvas, body and null', () => {
    expect(isTypingTarget({ tagName: 'CANVAS' } as any)).toBe(false);
    expect(isTypingTarget({ tagName: 'BODY', isContentEditable: false } as any)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('mountWalkOnEarth', () => {
  it('shows the button near Earth when not flying', () => {
    const t = setup({ distanceR: 9 });
    t.ui.update();
    expect(t.btn.hidden).toBe(false);
  });

  it('hides the button while a flyTo flight is active, shows it again after', () => {
    let flying = true;
    const t = setup({ distanceR: 9, flying: () => flying });
    t.ui.update();
    expect(t.btn.hidden).toBe(true);
    flying = false;
    t.ui.update();
    expect(t.btn.hidden).toBe(false);
  });

  it('does not auto-fire mid-flight, and zoom-in during the flight does not carry over', () => {
    let flying = true;
    const t = setup({ distanceR: 1.05, flying: () => flying });
    t.ui.update();
    for (let i = 0; i < 5; i++) t.key('+');
    t.ui.update();
    expect(t.fade.classList.has('on')).toBe(false);
    flying = false;
    t.ui.update();
    expect(t.fade.classList.has('on')).toBe(false);
    // After landing, 3 fresh notches still work.
    for (let i = 0; i < 3; i++) t.key('+');
    t.ui.update();
    expect(t.fade.classList.has('on')).toBe(true);
  });

  it('+ keys on the page count as zoom-in at the floor', () => {
    const t = setup({ distanceR: 1.05 });
    t.ui.update();
    for (let i = 0; i < 3; i++) t.key('+');
    t.ui.update();
    expect(t.fade.classList.has('on')).toBe(true);
  });

  it('ignores +/- typed into the search box (input) or a contenteditable', () => {
    const t = setup({ distanceR: 1.05 });
    t.ui.update();
    for (let i = 0; i < 5; i++) t.key('+', { tagName: 'INPUT' });
    for (let i = 0; i < 5; i++) t.key('=', { tagName: 'DIV', isContentEditable: true });
    t.ui.update();
    expect(t.fade.classList.has('on')).toBe(false);
  });
});
