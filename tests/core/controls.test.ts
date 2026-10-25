// tests/core/controls.test.ts — CosmoControls (owner: Claude).
import { describe, expect, it, vi } from 'vitest';

import { CosmoCamera } from '../../src/core/camera';
import { CosmoControls } from '../../src/core/controls';
import { FrameStack, METERS, type FrameId } from '../../src/core/frames';

function rig(frame: FrameId = 'helio', camPos = [0, -10, 0], target = [0, 0, 0]) {
  const cam = new CosmoCamera(new FrameStack());
  cam.setPose({ frame, position: camPos, target: { frame, position: target }, up: [0, 0, 1] });
  const controls = new CosmoControls(cam, { reducedMotion: true });
  return { cam, controls };
}

function offset(cam: CosmoCamera): number[] {
  const p = cam.getCameraWorldPosition();
  const t = cam.getTargetPosition()!;
  return [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
}

const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);

describe('CosmoControls orbit', () => {
  it('yaw keeps distance and height, and turns about up', () => {
    const { cam, controls } = rig();
    controls.rotate(Math.PI / 2 / 0.005, 0); // quarter turn worth of pixels
    controls.update(1 / 60);
    const o = offset(cam);
    expect(len(o)).toBeCloseTo(10, 9);
    expect(o[2]).toBeCloseTo(0, 9);
    expect(Math.abs(o[0])).toBeCloseTo(10, 6); // swung from -y to the x axis
  });

  it('dragging down raises the camera toward up, and never flips over the pole', () => {
    const { cam, controls } = rig();
    controls.rotate(0, 50);
    controls.update(1 / 60);
    expect(offset(cam)[2]).toBeGreaterThan(0);
    controls.rotate(0, 1e6); // way past the pole
    controls.update(1 / 60);
    const o = offset(cam);
    expect(len(o)).toBeCloseTo(10, 9);
    const theta = Math.acos(o[2] / len(o));
    expect(theta).toBeGreaterThan(0);
    expect(theta).toBeLessThan(0.01);
    cam.update();
    expect(Number.isFinite(cam.three.quaternion.x)).toBe(true);
  });

  it('works in another frame against a target in a different frame', () => {
    const frames = new FrameStack();
    frames.setOrigin('planet', [METERS.au, 0, 0]);
    const cam = new CosmoCamera(frames);
    // Camera in helio, target Earth's centre in planet frame, 20,000 km away.
    cam.setPose({
      frame: 'helio',
      position: [1, -2e7 / METERS.au, 0], // 20,000 km in AU
      target: { frame: 'planet', position: [0, 0, 0] },
      up: [0, 0, 1],
    });
    const controls = new CosmoControls(cam, { reducedMotion: true });
    controls.rotate(300, 0);
    controls.update(1 / 60);
    expect(cam.distanceTo({ frame: 'planet', position: [0, 0, 0] })).toBeCloseTo(2e7, -1);
  });
});

describe('CosmoControls zoom', () => {
  it('one notch is the same relative zoom at every scale', () => {
    for (const d of [1e1, 1e12, 1e25]) {
      const { cam, controls } = rig('cosmic', [0, -d / METERS.mpc, 0]);
      controls.zoom(1);
      controls.update(1 / 60);
      const after = cam.distanceTo({ frame: 'cosmic', position: [0, 0, 0] });
      expect(after / d).toBeCloseTo(Math.exp(0.15), 6);
    }
  });

  it('pinch zooms by the spread ratio and clamps to min/max distance', () => {
    const { cam, controls } = rig('planet', [0, -10, 0]); // 10 km
    controls.pinch(0.5);
    controls.update(1 / 60);
    expect(cam.distanceTo({ frame: 'planet', position: [0, 0, 0] })).toBeCloseTo(5000, 3);
    controls.zoom(-1000);
    controls.update(1 / 60);
    expect(cam.distanceTo({ frame: 'planet', position: [0, 0, 0] })).toBeCloseTo(1, 6); // minDistance
  });
});

describe('CosmoControls behaviour', () => {
  it('damping eases input in over several frames and then goes idle', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [0, -10, 0], target: { frame: 'helio', position: [0, 0, 0] } });
    const controls = new CosmoControls(cam, { damping: 0.08 });
    controls.zoom(1);
    controls.update(1 / 60);
    const first = cam.distanceTo({ frame: 'helio', position: [0, 0, 0] }) / METERS.au;
    expect(first).toBeGreaterThan(10);
    expect(first).toBeLessThan(10 * Math.exp(0.15));
    for (let i = 0; i < 300; i++) controls.update(1 / 60);
    const last = cam.distanceTo({ frame: 'helio', position: [0, 0, 0] }) / METERS.au;
    expect(last).toBeCloseTo(10 * Math.exp(0.15), 6);
    const spy = vi.spyOn(cam, 'setPose');
    controls.update(1 / 60);
    expect(spy).not.toHaveBeenCalled(); // idle
  });

  it('disabled controls ignore input and drop pending motion', () => {
    const { cam, controls } = rig();
    controls.enabled = false;
    controls.zoom(5);
    controls.update(1 / 60);
    expect(len(offset(cam))).toBeCloseTo(10, 12);
  });

  it('does nothing without a target', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [1, 2, 3] });
    const controls = new CosmoControls(cam, { reducedMotion: true });
    controls.rotate(100, 100);
    controls.zoom(3);
    controls.update(1 / 60);
    expect(Array.from(cam.getCameraWorldPosition())).toEqual([1, 2, 3]);
  });

  it('reports user input so main.ts can cancel a flight', () => {
    const { controls } = rig();
    const spy = vi.fn();
    controls.onUserInput(spy);
    controls.rotate(1, 0);
    controls.zoom(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reports input while disabled, and a listener can re-enable so that input applies', () => {
    const { cam, controls } = rig();
    controls.enabled = false; // mid-flight
    let flying = true;
    controls.onUserInput(() => {
      if (flying) {
        flying = false; // flight.cancelFlight()
        controls.enabled = true;
      }
    });
    controls.zoom(1);
    controls.update(1 / 60);
    expect(flying).toBe(false);
    expect(len(offset(cam))).toBeCloseTo(10 * Math.exp(0.15), 6); // the grabbing input applied
  });

  it('a pointer press alone counts as user input, even while disabled', () => {
    const { controls } = rig();
    controls.enabled = false;
    const spy = vi.fn();
    controls.onUserInput(spy);
    const el = new EventTarget();
    controls.attach(el);
    el.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 1, clientX: 0, clientY: 0 }));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('CosmoControls DOM binding', () => {
  function ev(type: string, props: Record<string, unknown>): Event {
    return Object.assign(new Event(type, { cancelable: true }), props);
  }

  it('maps pointer drag, wheel and keys, and detaches cleanly', () => {
    const { cam, controls } = rig();
    const el = Object.assign(new EventTarget(), { tabIndex: -1 });
    const detach = controls.attach(el);
    expect(el.tabIndex).toBe(0);

    el.dispatchEvent(ev('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
    el.dispatchEvent(ev('pointermove', { pointerId: 1, clientX: 100, clientY: 0 }));
    el.dispatchEvent(ev('pointerup', { pointerId: 1 }));
    controls.update(1 / 60);
    expect(Math.abs(offset(cam)[0])).toBeGreaterThan(1);

    const wheel = ev('wheel', { deltaY: 100, deltaMode: 0 });
    el.dispatchEvent(wheel);
    controls.update(1 / 60);
    expect(wheel.defaultPrevented).toBe(true);
    expect(len(offset(cam))).toBeCloseTo(10 * Math.exp(0.15), 6);

    el.dispatchEvent(ev('keydown', { key: '+' }));
    controls.update(1 / 60);
    expect(len(offset(cam))).toBeCloseTo(10, 6);

    detach();
    el.dispatchEvent(ev('wheel', { deltaY: 1000, deltaMode: 0 }));
    controls.update(1 / 60);
    expect(len(offset(cam))).toBeCloseTo(10, 6);
  });

  it('two-finger pinch zooms', () => {
    const { cam, controls } = rig();
    const el = new EventTarget();
    controls.attach(el);
    el.dispatchEvent(ev('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
    el.dispatchEvent(ev('pointerdown', { pointerId: 2, clientX: 100, clientY: 0 }));
    el.dispatchEvent(ev('pointermove', { pointerId: 2, clientX: 200, clientY: 0 })); // spread doubles
    controls.update(1 / 60);
    expect(len(offset(cam))).toBeCloseTo(5, 6); // zoomed in 2x
  });
});
