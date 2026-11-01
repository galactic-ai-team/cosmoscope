import { describe, it, expect } from 'vitest';
import { glowOpacity, glowDiameterM, GLOW_FULL_M, GLOW_GONE_M } from '../../src/ui/starGlow';

const RSUN = 6.957e8, AU = 1.495978707e11;

describe('focus-star glow (v1.1 tour star stops)', () => {
  it('is fully visible at a star stop (0.07 AU) and fades out by 2000 AU', () => {
    expect(glowOpacity(0.07 * AU)).toBe(1);
    expect(glowOpacity(GLOW_FULL_M)).toBe(1);
    const mid = glowOpacity(Math.sqrt(GLOW_FULL_M * GLOW_GONE_M));
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(glowOpacity(GLOW_GONE_M)).toBe(0);
    expect(glowOpacity(NaN)).toBe(0);
  });

  it('draws the true disc at the stop: tens of px across, centred star clearly visible', () => {
    const dist = 15 * RSUN; // tour approach: 5 R_sun * orbit 3x
    const d = glowDiameterM(dist, RSUN, 50, 900);
    const px = d / ((2 * dist * Math.tan((50 * Math.PI) / 360)) / 900);
    const discPx = px * 0.4; // solid core fraction
    expect(discPx).toBeGreaterThan(80);
    expect(discPx).toBeLessThan(900);
  });

  it('keeps a pixel floor far away', () => {
    const dist = 1000 * AU;
    const d = glowDiameterM(dist, RSUN, 50, 900);
    const px = d / ((2 * dist * Math.tan((50 * Math.PI) / 360)) / 900);
    expect(px).toBeCloseTo(14, 6);
  });
});
