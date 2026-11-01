// tests/core/cancelFrame.test.ts — Lumi (Dee's suggestion): cancelFlight()
// runs one chooseFrame pass so a cancelled flight ends in the right frame.
import { describe, expect, it } from 'vitest';

import { CosmoCamera } from '../../src/core/camera';
import { FrameStack, METERS } from '../../src/core/frames';
import { FlyToController } from '../../src/core/flyTo';
import type { LayerRegistry } from '../../src/core/layers';

const registry = {
  resolveTarget: (id: string) =>
    id === 'planet:mars'
      ? { frameId: 'helio' as const, worldPos: new Float64Array([1.5, 0, 0]), approachRadius: 3.4e6 / METERS.au }
      : null,
} as unknown as LayerRegistry;

const SUN = { frame: 'helio' as const, position: [0, 0, 0] };

describe('cancelFlight frame pass', () => {
  it('a flight cancelled 5000 AU from the Sun leaves the camera in galactic, not helio', async () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [5000, 0, 0] });
    const fly = new FlyToController(cam, registry);
    const h = fly.flyTo({ kind: 'planet', id: 'planet:mars', approach: 'orbit' }, 0);
    const before = cam.distanceTo(SUN);
    fly.cancelFlight();
    await h.promise;
    expect(fly.flying).toBe(false);
    expect(cam.getFrameId()).toBe('galactic');
    expect(cam.distanceTo(SUN) / before).toBeCloseTo(1, 9); // rebase doesn't move the camera
  });

  it('a flight cancelled 1 Mpc out settles in cosmic in one pass', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [METERS.mpc / METERS.au, 0, 0] });
    const fly = new FlyToController(cam, registry);
    fly.flyTo({ kind: 'planet', id: 'planet:mars', approach: 'orbit' }, 0);
    fly.cancelFlight();
    expect(cam.getFrameId()).toBe('cosmic');
  });

  it('a flight cancelled near the Sun stays in helio', () => {
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'helio', position: [10, 0, 0] });
    const fly = new FlyToController(cam, registry);
    fly.flyTo({ kind: 'planet', id: 'planet:mars', approach: 'orbit' }, 0);
    fly.update(0.1);
    fly.cancelFlight();
    expect(cam.getFrameId()).toBe('helio');
  });
});
