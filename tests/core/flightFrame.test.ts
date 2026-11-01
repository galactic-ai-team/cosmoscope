// tests/core/flightFrame.test.ts — Lumi: flights pick helio/galactic by distance
// from the Sun (src/core/frameSwitch.ts), same bands as the idle loop.
import { describe, expect, it } from 'vitest';

import { CosmoCamera } from '../../src/core/camera';
import { FrameStack, METERS } from '../../src/core/frames';
import { FlyToController } from '../../src/core/flyTo';
import type { LayerRegistry } from '../../src/core/layers';

const MARS_AU = 1.5;
const registry = {
  resolveTarget: (id: string) =>
    id === 'planet:mars'
      ? { frameId: 'helio' as const, worldPos: new Float64Array([MARS_AU, 0, 0]), approachRadius: 3.4e6 / METERS.au }
      : id === 'star:test:far'
        ? { frameId: 'galactic' as const, worldPos: new Float64Array([0, 0, 10]), approachRadius: 0.01 }
        : null,
} as unknown as LayerRegistry;

describe('flight frame switching', () => {
  it('a flight from deep space to Mars stays galactic (stars on) until inside 80 AU, and lands in helio', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [5000, 0, 0] });
    cam.rebaseTo('galactic');
    const fly = new FlyToController(cam, registry);
    fly.flyTo({ kind: 'planet', id: 'planet:mars', approach: 'orbit' }, 0);

    const seen: string[] = [];
    for (let t = 0; t <= 20; t += 0.05) {
      fly.update(t);
      const au = cam.distanceTo({ frame: 'helio', position: [0, 0, 0] }) / METERS.au;
      if (au > 80) expect(cam.getFrameId()).toBe('galactic');
      seen.push(cam.getFrameId());
      if (!fly.flying) break;
    }
    expect(seen[0]).toBe('galactic');
    expect(cam.getFrameId()).toBe('helio');
    const target = cam.getTargetPosition('helio');
    expect(target?.[0]).toBeCloseTo(MARS_AU, 6);
  });

  it('counts frame rebases: one switch per boundary crossing, never a flip back and forth each frame', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [5000, 0, 0] });
    cam.rebaseTo('galactic');
    const frameEvents: string[] = [];
    cam.onRebase((e) => { if (e.reason === 'frame') frameEvents.push(e.frameId); });
    const fly = new FlyToController(cam, registry);
    fly.flyTo({ kind: 'planet', id: 'planet:mars', approach: 'orbit' }, 0);
    for (let t = 0; t <= 20 && fly.flying; t += 0.05) fly.update(t);
    // galactic -> helio exactly once, inside 80 AU.
    expect(frameEvents).toEqual(['helio']);
  });

  it('a flight out from Mars to a galactic target crosses 120 AU once, and lookAt keeps aiming at the target across the switch', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [MARS_AU + 1e-4, 0, 0], target: { frame: 'helio', position: [MARS_AU, 0, 0] } });
    const frameEvents: string[] = [];
    cam.onRebase((e) => { if (e.reason === 'frame') frameEvents.push(e.frameId); });
    const fly = new FlyToController(cam, registry);
    fly.flyTo({ kind: 'star', id: 'star:test:far', approach: 'orbit' }, 0);
    let sawHelioFar = false;
    for (let t = 0; t <= 20 && fly.flying; t += 0.05) {
      fly.update(t);
      const au = cam.distanceTo({ frame: 'helio', position: [0, 0, 0] }) / METERS.au;
      if (au > 120 && cam.getFrameId() === 'helio') sawHelioFar = true;
      // The target is stored with its own frame, so it reads back exactly in galactic.
      const tgt = cam.getTargetPosition('galactic');
      expect(tgt?.[2]).toBeCloseTo(10, 9);
    }
    expect(sawHelioFar).toBe(false);
    expect(frameEvents).toEqual(['galactic']);
    expect(cam.getFrameId()).toBe('galactic');
  });
});
