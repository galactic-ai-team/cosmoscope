// src/core/__tests__/flyControls.test.ts � free-fly mode (owner: Claude).
import { describe, expect, it, vi } from 'vitest';

import { CosmoCamera } from '../camera';
import { CosmoFlyControls, defaultSpeedForDistance, type NearestBody } from '../flyControls';
import { FrameStack, type FrameId } from '../frames';

/** Camera at `pos` (frame units) looking along +y with +z up. */
function rig(frame: FrameId, pos: number[], opts: ConstructorParameters<typeof CosmoFlyControls>[1] = {}) {
  const cam = new CosmoCamera(new FrameStack());
  cam.setPose({
    frame,
    position: pos,
    target: { frame, position: [pos[0], pos[1] + 1, pos[2]] },
    up: [0, 0, 1],
  });
  const fly = new CosmoFlyControls(cam, { reducedMotion: true, ...opts });
  fly.start();
  return { cam, fly };
}

const v = (a: ArrayLike<number>) => Array.from(a);
const sub = (a: ArrayLike<number>, b: ArrayLike<number>) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);

describe('free-fly: entering and leaving', () => {
  it('start() keeps the exact view: no movement and no turn without input', () => {
    const { cam, fly } = rig('helio', [1, 2, 3]);
    const before = v(cam.getCameraWorldPosition());
    fly.update(1 / 60);
    cam.update();
    expect(v(cam.getCameraWorldPosition())).toEqual(before);
    expect(cam.getCameraForward()[1]).toBeCloseTo(1, 9);
    expect(cam.getCameraUp()[2]).toBeCloseTo(1, 9);
  });

  it('does nothing while disabled, and stop() zeroes the velocity', () => {
    const { cam, fly } = rig('helio', [1, 0, 0]);
    fly.setKey('KeyW', true);
    fly.update(0.5);
    expect(fly.speed).toBeGreaterThan(0);
    fly.stop();
    expect(fly.speed).toBe(0);
    const before = v(cam.getCameraWorldPosition());
    fly.setKey('KeyW', true);
    fly.update(0.5);
    expect(v(cam.getCameraWorldPosition())).toEqual(before);
  });
});

describe('free-fly: speed scales with distance', () => {
  it('covers half the distance to the nearest surface per second, at every scale', () => {
    for (const [frame, metres] of [
      ['helio', 1e9],
      ['galactic', 1e18],
      ['cosmic', 1e24],
    ] as const) {
      const unit = new FrameStack().unitsPerFrame(frame);
      const { cam: c, fly } = rig(frame, [metres / unit, 0, 0]);
      fly.setKey('KeyW', true);
      const before = v(c.getCameraWorldPosition());
      fly.update(0.01); // short step so distance barely changes
      const moved = len(sub(c.getCameraWorldPosition(), before)) * unit;
      expect(moved / 0.01).toBeCloseTo(defaultSpeedForDistance(metres), -Math.floor(Math.log10(metres)) + 3);
    }
  });

  it('Shift boosts 8x and the speed trim multiplies on top', () => {
    const { cam, fly } = rig('helio', [1, 0, 0]);
    const step = () => {
      const before = v(cam.getCameraWorldPosition());
      fly.update(0.001);
      return len(sub(cam.getCameraWorldPosition(), before));
    };
    fly.setKey('KeyW', true);
    const base = step();
    fly.setKey('ShiftLeft', true);
    expect(step() / base).toBeCloseTo(8, 2);
    fly.setKey('ShiftLeft', false);
    fly.adjustSpeed(4);
    expect(fly.speedMultiplier).toBeCloseTo(1.25 ** 4, 9);
    expect(step() / base).toBeCloseTo(1.25 ** 4, 2);
  });

  it('uses the distance to the nearest SURFACE, so you slow right down near a planet', () => {
    const R = 6_371_000;
    const earth: NearestBody = { point: { frame: 'planet', position: [0, 0, 0] }, radius: R };
    const { cam, fly } = rig('planet', [(R + 1000) / 1000, 0, 0], { nearestBody: () => earth, clearanceFactor: 1 });
    fly.setKey('KeyW', true);
    const before = v(cam.getCameraWorldPosition());
    fly.update(0.1);
    const metresPerSecond = (len(sub(cam.getCameraWorldPosition(), before)) * 1000) / 0.1;
    expect(metresPerSecond).toBeCloseTo(500, -1); // half of the 1 km altitude per second
  });

  it('eases speed in over the acceleration time', () => {
    const { fly } = rig('helio', [1, 0, 0], { reducedMotion: false, accelTime: 0.25 });
    fly.setKey('KeyW', true);
    fly.update(1 / 60);
    const first = fly.speed;
    for (let i = 0; i < 120; i++) fly.update(1 / 60);
    expect(first).toBeLessThan(fly.speed * 0.2);
    expect(fly.speed).toBeGreaterThan(0);
  });
});

describe('free-fly: steering', () => {
  it('W flies along the view direction; D strafes right; E goes up', () => {
    const { cam, fly } = rig('helio', [1, 0, 0]);
    const delta = (code: string) => {
      fly.setKey(code, true);
      const before = v(cam.getCameraWorldPosition());
      fly.update(0.01);
      fly.setKey(code, false);
      fly.update(0); // reduced motion: velocity drops to zero with no input
      const d = sub(cam.getCameraWorldPosition(), before);
      const l = len(d);
      return d.map((x) => x / l);
    };
    expect(delta('KeyW')[1]).toBeCloseTo(1, 6);
    expect(delta('KeyD')[0]).toBeCloseTo(1, 6); // facing +y with +z up, right is +x
    expect(delta('KeyE')[2]).toBeCloseTo(1, 6);
  });

  it('mouse right turns right, mouse up looks up, Z/X roll about the view axis', () => {
    const { cam, fly } = rig('helio', [1, 0, 0]);
    fly.look(100, 0);
    fly.update(1 / 60);
    expect(cam.getCameraForward()[0]).toBeGreaterThan(0.1); // turned toward +x (right)

    const r2 = rig('helio', [1, 0, 0]);
    r2.fly.look(0, -100);
    r2.fly.update(1 / 60);
    expect(r2.cam.getCameraForward()[2]).toBeGreaterThan(0.1); // looking up

    const r3 = rig('helio', [1, 0, 0]);
    r3.fly.setKey('KeyX', true);
    r3.fly.update(0.5);
    const up = r3.cam.getCameraUp();
    const fwd = r3.cam.getCameraForward();
    expect(up[0]).toBeGreaterThan(0.1); // rolled right
    expect(fwd[1]).toBeCloseTo(1, 9); // view direction unchanged
  });

  it('keeps forward and up orthonormal after lots of turning', () => {
    const { cam, fly } = rig('helio', [1, 0, 0]);
    for (let i = 0; i < 500; i++) {
      fly.look(37, -11);
      fly.setKey('KeyX', i % 2 === 0);
      fly.update(1 / 60);
    }
    const f = cam.getCameraForward();
    const u = cam.getCameraUp();
    expect(Math.hypot(f[0], f[1], f[2])).toBeCloseTo(1, 9);
    expect(Math.hypot(u[0], u[1], u[2])).toBeCloseTo(1, 9);
    expect(f[0] * u[0] + f[1] * u[1] + f[2] * u[2]).toBeCloseTo(0, 9);
  });
});

describe('free-fly: never inside a body', () => {
  it('stops just above the surface when flying straight at a planet at huge boost, and stays there', () => {
    const R = 6_371_000;
    const earth: NearestBody = { point: { frame: 'planet', position: [0, 0, 0] }, radius: R };
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'planet', position: [0, -3 * R / 1000, 0], target: { frame: 'planet', position: [0, 0, 0] }, up: [0, 0, 1] });
    const fly = new CosmoFlyControls(cam, { reducedMotion: true, nearestBody: () => earth, boost: 1000 });
    fly.start();
    fly.setKey('KeyW', true);
    fly.setKey('ShiftLeft', true);
    for (let i = 0; i < 600; i++) fly.update(0.1);
    const d = cam.distanceTo(earth.point);
    expect(d).toBeGreaterThanOrEqual(R * 1.002 - 1e-3); // never inside the clearance
    expect(d).toBeLessThan(R * 1.01); // and it really got there (no runaway tunnelling)
    expect(fly.frameHint()).toBe('planet');
  });
});

describe('free-fly: velocity for LOD', () => {
  it('reports velocity in m/s along the view direction', () => {
    const { fly } = rig('helio', [1, 0, 0]);
    fly.setKey('KeyW', true);
    fly.update(0.001);
    const vel = fly.getVelocity();
    expect(vel[1]).toBeGreaterThan(0);
    expect(Math.abs(vel[0]) + Math.abs(vel[2])).toBeLessThan(vel[1] * 1e-9);
    expect(fly.speed).toBeCloseTo(vel[1], 6);
  });
});

describe('free-fly: DOM binding', () => {
  function ev(type: string, props: Record<string, unknown>): Event {
    return Object.assign(new Event(type, { cancelable: true }), props);
  }

  function dom() {
    const doc = Object.assign(new EventTarget(), { pointerLockElement: null as unknown });
    const el = Object.assign(new EventTarget(), {
      ownerDocument: doc,
      requestPointerLock: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, width: 800 }),
    });
    return { doc, el };
  }

  it('keys work page-wide, but not while typing or with Ctrl/Cmd held', () => {
    const { cam, fly } = rig('helio', [1, 0, 0]);
    const { doc, el } = dom();
    fly.attach(el);
    const typing = ev('keydown', { code: 'KeyW' });
    Object.defineProperty(typing, 'target', { value: { tagName: 'INPUT' } });
    doc.dispatchEvent(typing);
    doc.dispatchEvent(ev('keydown', { code: 'KeyW', metaKey: true }));
    const before = v(cam.getCameraWorldPosition());
    fly.update(0.01);
    expect(v(cam.getCameraWorldPosition())).toEqual(before);
    const w = ev('keydown', { code: 'KeyW' });
    doc.dispatchEvent(w);
    expect(w.defaultPrevented).toBe(true);
    fly.update(0.01);
    expect(cam.getCameraWorldPosition()[1]).toBeGreaterThan(before[1]);
  });

  it('arrow keys still turn when another listener (the disabled orbit controls) already preventDefault-ed them', () => {
    const { cam, fly } = rig('helio', [1, 0, 0]);
    const { doc, el } = dom();
    doc.addEventListener('keydown', (e) => e.preventDefault()); // attached first, like CosmoControls
    fly.attach(el);
    doc.dispatchEvent(ev('keydown', { code: 'ArrowRight' }));
    fly.update(0.5);
    expect(cam.getCameraForward()[0]).toBeGreaterThan(0.1);
  });

  it('mouse down asks for pointer lock; locked mouse movement looks around', () => {
    const { cam, fly } = rig('helio', [1, 0, 0]);
    const { doc, el } = dom();
    fly.attach(el);
    el.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 }));
    expect(el.requestPointerLock).toHaveBeenCalled();
    doc.pointerLockElement = el;
    el.dispatchEvent(ev('pointermove', { pointerType: 'mouse', movementX: 120, movementY: 0 }));
    fly.update(1 / 60);
    expect(cam.getCameraForward()[0]).toBeGreaterThan(0.1);
  });

  it('touch: left half is a move stick, right half looks', () => {
    const { cam, fly } = rig('helio', [1, 0, 0]);
    const { el } = dom();
    fly.attach(el);
    el.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 500 }));
    el.dispatchEvent(ev('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 440 })); // push up = forward
    const before = v(cam.getCameraWorldPosition());
    fly.update(0.01);
    expect(cam.getCameraWorldPosition()[1]).toBeGreaterThan(before[1]);
    el.dispatchEvent(ev('pointerup', { pointerType: 'touch', pointerId: 1 }));

    el.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 600, clientY: 300 }));
    el.dispatchEvent(ev('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 660, clientY: 300 }));
    fly.update(1 / 60);
    expect(cam.getCameraForward()[0]).toBeGreaterThan(0.05);
  });

  it('wheel trims speed; detach removes every listener', () => {
    const { fly } = rig('helio', [1, 0, 0]);
    const { doc, el } = dom();
    const detach = fly.attach(el);
    const wheel = ev('wheel', { deltaY: -100, deltaMode: 0 });
    el.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(fly.speedMultiplier).toBeCloseTo(1.25, 9);
    detach();
    el.dispatchEvent(ev('wheel', { deltaY: -100, deltaMode: 0 }));
    doc.dispatchEvent(ev('keydown', { code: 'KeyW' }));
    expect(fly.speedMultiplier).toBeCloseTo(1.25, 9);
    expect(fly.speed).toBe(0);
  });

  it('reports user input so main.ts can cancel a running flyTo', () => {
    const { fly } = rig('helio', [1, 0, 0]);
    const spy = vi.fn();
    fly.onUserInput(spy);
    fly.setKey('KeyW', true);
    fly.look(5, 0);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('defaultSpeedForDistance', () => {
  it('is half the distance per second with a 2 m/s floor', () => {
    expect(defaultSpeedForDistance(1)).toBe(2);
    expect(defaultSpeedForDistance(1e20)).toBe(5e19);
  });
});