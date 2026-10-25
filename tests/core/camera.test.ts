// tests/core/camera.test.ts — camera core, Dee's getters, and the
// 1 m -> 1e26 m precision sweep (owner: Claude).
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { chooseRenderScale, CosmoCamera, MIN_RENDER_SCALE } from '../../src/core/camera';
import { FrameStack, METERS, type FrameId } from '../../src/core/frames';

const PIXEL_RAD = ((50 * Math.PI) / 180) / 1080; // 1 px at 1080p, 50 deg fov

describe('CosmoCamera pose and getters', () => {
  it('getFrameId / getCameraWorldPosition / setCameraWorldPosition / unitsPerFrame', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [1, 0, 0] });
    expect(cam.getFrameId()).toBe('helio');
    expect(Array.from(cam.getCameraWorldPosition())).toEqual([1, 0, 0]);
    expect(cam.getCameraWorldPosition('planet')[0]).toBeCloseTo(METERS.au / METERS.km, 3);
    expect(cam.unitsPerFrame('galactic')).toBe(METERS.pc);

    cam.setCameraWorldPosition([METERS.au / METERS.km * 2, 0, 0], 'planet');
    expect(cam.getFrameId()).toBe('helio'); // keeps its own frame
    expect(cam.getCameraWorldPosition()[0]).toBeCloseTo(2, 12);
  });

  it('getCameraWorldPosition reuses `out` (no per-frame allocation)', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [3, 4, 5] });
    const out = new Float64Array(3);
    expect(cam.getCameraWorldPosition('helio', out)).toBe(out);
    expect(Array.from(out)).toEqual([3, 4, 5]);
  });

  it('distanceTo works across frames', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'planet', position: [0, 0, 0] });
    expect(cam.distanceTo({ frame: 'galactic', position: [1.3, 0, 0] })).toBeCloseTo(1.3 * METERS.pc, -6);
  });

  it('keeps the three.js camera at the origin, looking at the target', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({
      frame: 'helio',
      position: [5, 0, 0],
      target: { frame: 'helio', position: [5, 3, 0] },
      up: [0, 0, 1],
    });
    cam.update();
    expect(cam.three.position.length()).toBe(0);
    const dir = cam.three.getWorldDirection(new THREE.Vector3());
    expect(dir.y).toBeCloseTo(1, 6);
  });
});

describe('renderScale and rebase events', () => {
  it('chooses a power of ten with hysteresis', () => {
    expect(chooseRenderScale(3e9, 1)).toBe(1e9);
    expect(chooseRenderScale(1.5e10, 1e9)).toBe(1e9); // ratio 15, inside band
    expect(chooseRenderScale(3e10, 1e9)).toBe(1e10); // ratio 30, rebase
    expect(chooseRenderScale(4e8, 1e9)).toBe(1e8); // ratio 0.4, rebase
    expect(chooseRenderScale(0, 1)).toBe(MIN_RENDER_SCALE);
  });

  it('puts the target 1–20 render units away and fires scale/frame/origin events', () => {
    const frames = new FrameStack();
    const cam = new CosmoCamera(frames);
    const events: string[] = [];
    cam.onRebase((e) => events.push(e.reason));

    cam.setPose({ frame: 'galactic', position: [0, 0, 0], target: { frame: 'galactic', position: [4.2, 0, 0] } });
    cam.update();
    const rel = cam.toCameraRelative([4.2, 0, 0], 'galactic', new THREE.Vector3());
    expect(rel.length()).toBeGreaterThanOrEqual(1);
    expect(rel.length()).toBeLessThanOrEqual(20);
    expect(events).toContain('frame');
    expect(events).toContain('scale');

    const spy = vi.fn();
    cam.onRebase(spy);
    frames.setOrigin('planet', [1, 0, 0]);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'origin' }));
  });

  it('layerScale converts a mesh authored in frame units to render units', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [0, 0, 0], target: { frame: 'helio', position: [2, 0, 0] } });
    expect(cam.layerScale('helio') * cam.renderScale).toBeCloseTo(METERS.au, -3);
  });
});

/**
 * The precision sweep. For each focus distance d from 1 m to 1e26 m, put a
 * target somewhere realistic for that scale (often far from its frame's
 * origin), put the camera d meters away, then nudge the target by a tiny
 * fraction of d. The on-screen angle must move by the expected amount to
 * well under a pixel. Also confirm the naive approach (float32 absolute
 * positions) fails, so the test is actually testing something.
 */
describe('precision: 1 m -> 1e26 m', () => {
  // Where a target at each scale plausibly sits, in root meters from the Sun.
  function placement(d: number): { frame: FrameId; origin: number } {
    if (d < 1e7) return { frame: 'planet', origin: METERS.au }; // on/near Earth
    if (d < 1e13) return { frame: 'helio', origin: 30 * METERS.au }; // out by Neptune
    if (d < 1e20) return { frame: 'galactic', origin: 8200 * METERS.pc }; // galactic center
    return { frame: 'cosmic', origin: 0.78 * METERS.mpc * (d > 1e24 ? 1000 : 1) }; // Andromeda / far web
  }

  function f32(x: number): number {
    return Math.fround(x);
  }

  for (let e = 0; e <= 26; e++) {
    const d = 10 ** e;
    it(`d = 1e${e} m stays sub-pixel`, () => {
      const { frame, origin } = placement(d);
      const frames = new FrameStack();
      if (frame === 'planet') frames.setOrigin('planet', [origin, 0, 0]);
      const unit = frames.unitsPerFrame(frame);
      // Target in its frame (planet frame origin is Earth, so local ~0;
      // other frames have origin at the Sun, so the target is far out).
      const local = frame === 'planet' ? 6371e3 / unit : origin / unit;
      const target = [local, 0, 0];
      const camPos = [local, (d / unit), 0];

      const cam = new CosmoCamera(frames);
      cam.setPose({ frame, position: camPos, target: { frame, position: target } });
      cam.update();

      const nudge = (d * 1e-3) / unit; // 0.1% of d, expected angle ~1e-3 rad
      const a = cam.toCameraRelative(target, frame, new THREE.Vector3());
      const b = cam.toCameraRelative([target[0] + nudge, 0, 0], frame, new THREE.Vector3());
      const angle = a.angleTo(b);
      const expected = Math.atan(1e-3);
      expect(Math.abs(angle - expected)).toBeLessThan(PIXEL_RAD * 0.01);

      // Render-space magnitude stays shader-friendly.
      expect(a.length()).toBeGreaterThanOrEqual(0.5);
      expect(a.length()).toBeLessThanOrEqual(20);
    });
  }

  it('the naive float32-absolute approach really does break (sanity check)', () => {
    // Camera 1 m from a point on Earth's surface, positions stored in
    // float32 meters from the Sun: spacing at 1.5e11 m is ~16 km.
    const earth = METERS.au;
    const targetX = f32(earth + 6371e3);
    const nudgedX = f32(earth + 6371e3 + 1e-3);
    expect(nudgedX - targetX).toBe(0); // the 1 mm nudge vanished entirely
  });
});