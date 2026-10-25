// tests/core/cosmicFrame.test.ts — Lumi (Nova's handoff): galactic <-> cosmic
// auto-rebase by distance from the Sun (src/core/frameSwitch.ts).
import { describe, expect, it } from 'vitest';

import { CosmoCamera } from '../../src/core/camera';
import { FrameStack, METERS } from '../../src/core/frames';
import { FlyToController } from '../../src/core/flyTo';
import { chooseFrame, ENTER_GALACTIC_M, LEAVE_GALACTIC_M } from '../../src/core/frameSwitch';
import type { LayerRegistry } from '../../src/core/layers';

const MPC = METERS.mpc;
const AU = METERS.au;

describe('chooseFrame (galactic <-> cosmic)', () => {
  it('thresholds are 0.5 Mpc out and 0.3 Mpc back', () => {
    expect(LEAVE_GALACTIC_M).toBe(0.5 * MPC);
    expect(ENTER_GALACTIC_M).toBe(0.3 * MPC);
  });

  it('leaves galactic past 0.5 Mpc, whatever the target', () => {
    expect(chooseFrame('galactic', 0.49 * MPC, 'galactic')).toBe('galactic');
    expect(chooseFrame('galactic', 0.51 * MPC, 'galactic')).toBe('cosmic');
    expect(chooseFrame('galactic', 0.78 * MPC)).toBe('cosmic'); // Andromeda
    expect(chooseFrame('galactic', 16.5 * MPC, 'cosmic')).toBe('cosmic'); // Virgo
  });

  it('returns inside 0.3 Mpc only for galactic-or-nearer targets', () => {
    expect(chooseFrame('cosmic', 0.29 * MPC, 'galactic')).toBe('galactic');
    expect(chooseFrame('cosmic', 0.29 * MPC, 'planet')).toBe('galactic');
    expect(chooseFrame('cosmic', 0.29 * MPC, 'cosmic')).toBe('cosmic');
    expect(chooseFrame('cosmic', 0.29 * MPC)).toBe('cosmic');
  });

  it('has hysteresis between 0.3 and 0.5 Mpc', () => {
    expect(chooseFrame('galactic', 0.4 * MPC, 'galactic')).toBe('galactic');
    expect(chooseFrame('cosmic', 0.4 * MPC, 'galactic')).toBe('cosmic');
  });

  it('settles in one call across several bands', () => {
    expect(chooseFrame('helio', 1 * MPC)).toBe('cosmic');
    expect(chooseFrame('cosmic', 1 * AU, 'helio')).toBe('helio');
    expect(chooseFrame('cosmic', 1 * AU, 'galactic')).toBe('galactic');
  });
});

describe('camera rebase galactic <-> cosmic', () => {
  it('rebaseTo is exact both ways at Mpc distances', () => {
    const cam = new CosmoCamera(new FrameStack());
    const pc = 780_000; // Andromeda, in parsecs
    cam.setPose({ frame: 'galactic', position: [pc, 1234.5, -6789.25] });
    const sun = { frame: 'galactic' as const, position: [0, 0, 0] };
    const before = cam.distanceTo(sun);
    cam.rebaseTo(chooseFrame(cam.getFrameId(), before, 'galactic'));
    expect(cam.getFrameId()).toBe('cosmic');
    expect(cam.distanceTo(sun) / before).toBeCloseTo(1, 12);
    cam.rebaseTo('galactic');
    const p = cam.getCameraWorldPosition();
    expect(p[0]).toBeCloseTo(pc, 6);
    expect(p[1]).toBeCloseTo(1234.5, 6);
  });

  it('a flight out to a galaxy at 0.78 Mpc goes cosmic past 0.5 Mpc and lands there', () => {
    const ANDROMEDA_PC = 780_000;
    const registry = {
      resolveTarget: (id: string) =>
        id === 'galaxy:m31'
          ? { frameId: 'galactic' as const, worldPos: new Float64Array([ANDROMEDA_PC, 0, 0]), approachRadius: 30_000 }
          : null,
    } as unknown as LayerRegistry;
    const cam = new CosmoCamera(new FrameStack());
    cam.setPose({ frame: 'galactic', position: [-10, 0, 0] });
    const fly = new FlyToController(cam, registry);
    fly.flyTo({ kind: 'galaxy', id: 'galaxy:m31', approach: 'orbit' }, 0);

    for (let t = 0; t <= 20; t += 0.05) {
      fly.update(t);
      const mpc = cam.distanceTo({ frame: 'galactic', position: [0, 0, 0] }) / MPC;
      if (mpc < 0.5) expect(cam.getFrameId()).toBe('galactic');
      if (!fly.flying) break;
    }
    expect(cam.getFrameId()).toBe('cosmic');
    const target = cam.getTargetPosition('galactic');
    expect(target?.[0]).toBeCloseTo(ANDROMEDA_PC, 3);
  });
});
