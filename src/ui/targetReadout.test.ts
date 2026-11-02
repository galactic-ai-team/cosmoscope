// src/ui/targetReadout.test.ts (owner: Claude)
import { describe, expect, it } from 'vitest';

import { CosmoCamera } from '../core/camera';
import { CosmoFlyControls } from '../core/flyControls';
import { FrameStack } from '../core/frames';
import { pickNearestBody } from './freeFly';
import { targetReadout, type ReadoutDeps } from './targetReadout';

const LY = 9.4607304725808e15;

describe('targetReadout', () => {
  const deps = (cam: CosmoCamera, pos: number[]): ReadoutDeps => ({
    resolve: (id) => (id === 'galaxy:messier:M31' ? { frameId: 'galactic', worldPos: pos } : null),
    distanceTo: (p) => cam.distanceTo(p),
    nameOf: (id) => (id === 'galaxy:messier:M31' ? 'Andromeda Galaxy' : undefined),
    format: (m) => `${Math.round(m / LY)} ly`,
  });

  it('is empty with no pick or an unresolvable pick', () => {
    const cam = new CosmoCamera(new FrameStack());
    expect(targetReadout(null, deps(cam, [0, 0, 0]))).toBe('');
    expect(targetReadout('nope', deps(cam, [0, 0, 0]))).toBe('');
  });

  it('in free-fly, follows the picked galaxy, not the nearest body (the reported bug)', () => {
    // Sun at the galactic origin; "M31" 2.5 Mly away along +x (parsecs).
    const M31_PC = 2.5e6 / 3.26156;
    const m31 = [M31_PC, 0, 0];
    const cam = new CosmoCamera(new FrameStack());
    // Start 330,000 ly from M31, on the Sun's side, facing it (like an orbit fly-to).
    const startPc = M31_PC - 330_000 / 3.26156;
    cam.setPose({ frame: 'galactic', position: [startPc, 0, 0], target: { frame: 'galactic', position: m31 }, up: [0, 0, 1] });
    const fly = new CosmoFlyControls(cam, {
      reducedMotion: true,
      speedForDistance: (m) => Math.max(2, m),
      nearestBody: () =>
        pickNearestBody(
          [
            { point: { frame: 'galactic', position: [0, 0, 0] }, radius: 0 }, // Sun
            { point: { frame: 'galactic', position: m31 }, radius: 0 },
          ],
          (p) => cam.distanceTo(p),
        ),
    });
    fly.start();
    const readLy = () => Number(targetReadout('galaxy:messier:M31', deps(cam, m31)).match(/: (\d+) ly/)![1]);

    fly.setKey('KeyS', true); // back away from M31, toward the Sun
    for (let i = 0; i < 240; i++) fly.update(1 / 60);
    fly.setKey('KeyS', false);
    const back = readLy();
    // The look-at point now sits at the (nearer) Sun's distance; the readout must not follow it.
    const lookAt = cam.distanceTo(cam.getTarget()!) / LY;
    expect(lookAt).toBeLessThan(back / 2);
    expect(back).toBeGreaterThan(330_000);

    fly.setKey('KeyW', true); // fly back toward M31
    for (let i = 0; i < 180; i++) fly.update(1 / 60);
    expect(readLy()).toBeLessThan(back);
    expect(targetReadout('galaxy:messier:M31', deps(cam, m31))).toMatch(/^Distance to Andromeda Galaxy: /);
  });
});
