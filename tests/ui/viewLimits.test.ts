import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COSMIC_WEB_EXTENT_MPC, MAX_VIEW_DISTANCE_M } from '../../src/ui/viewLimits';
import { FrameStack, METERS } from '../../src/core/frames';
import { CosmoCamera } from '../../src/core/camera';
import { CosmoControls } from '../../src/core/controls';

describe('view limits (v1.1 zoom-out cap)', () => {
  it('extent matches the 2MRS data file', () => {
    const data = JSON.parse(readFileSync(new URL('../../public/data/cosmic-web-2mrs.json', import.meta.url), 'utf8'));
    let max = 0;
    for (const p of data.points) max = Math.max(max, Math.hypot(p.xyz[0], p.xyz[1], p.xyz[2]));
    expect(Math.abs(max - COSMIC_WEB_EXTENT_MPC)).toBeLessThan(0.5);
  });
  it('caps zoom at ~2x the web extent (~2,700 million ly)', () => {
    const mly = MAX_VIEW_DISTANCE_M / 9.4607304725808e15 / 1e6;
    expect(mly).toBeGreaterThan(2600);
    expect(mly).toBeLessThan(2800);
    // Far beyond the farthest flyable galaxy, far short of Nova's 105,700 Mly.
    expect(MAX_VIEW_DISTANCE_M).toBeGreaterThan(COSMIC_WEB_EXTENT_MPC * METERS.mpc);
  });

  it('wheel zoom-out from a 2MRS galaxy stops at the cap (Nova repro)', () => {
    const cam = new CosmoCamera(new FrameStack(), undefined, 'cosmic');
    // Camera 1 Mpc from a galaxy 20 Mpc out, in the cosmic frame (Mpc units).
    cam.setPose({ frame: 'cosmic', position: [21, 0, 0], target: { frame: 'cosmic', position: [20, 0, 0] }, up: [0, 0, 1] });
    const controls = new CosmoControls(cam, { reducedMotion: true, maxDistance: MAX_VIEW_DISTANCE_M });
    for (let i = 0; i < 400; i++) { controls.zoom(5); controls.update(1 / 60); }
    const d = cam.distanceTo({ frame: 'cosmic', position: [20, 0, 0] });
    expect(d / MAX_VIEW_DISTANCE_M).toBeCloseTo(1, 6);
  });
});
