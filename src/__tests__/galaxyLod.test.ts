// src/__tests__/galaxyLod.test.ts
// Unit tests for galaxyLod.ts: tier tables, presets, speedForDistance, boost.

import { describe, expect, it } from 'vitest';
import {
  GALAXY_PRESETS,
  KLY,
  MLY,
  boostMultiplierForDistance,
  galaxyLodTiers,
  speedForDistance,
} from '../core/galaxyLod';

describe('galaxyLodTiers', () => {
  it('returns 4 tiers, ascending maxDistance, last = Infinity', () => {
    const tiers = galaxyLodTiers({ radiusLy: 100_000 });
    expect(tiers).toHaveLength(4);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].maxDistance).toBeGreaterThan(tiers[i - 1].maxDistance);
    }
    expect(tiers[tiers.length - 1].maxDistance).toBe(Infinity);
  });

  it('budgetFracs sum to ~1.0 so a single galaxy fills the budget', () => {
    const tiers = galaxyLodTiers({ radiusLy: 100_000 });
    const sum = tiers.reduce((s, t) => s + t.budgetFrac, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('larger galaxies have larger full-render distance', () => {
    const big = galaxyLodTiers({ radiusLy: 110_000 }); // Andromeda
    const small = galaxyLodTiers({ radiusLy: 14_000 }); // LMC
    expect(big[0].maxDistance).toBeGreaterThan(small[0].maxDistance);
    // The ratio should match the radius ratio (110/14 ≈ 7.86).
    const ratio = big[0].maxDistance / small[0].maxDistance;
    expect(ratio).toBeCloseTo(110 / 14, 1);
  });

  it('respects fullDistanceMultiple override', () => {
    const t3 = galaxyLodTiers({ radiusLy: 100_000, fullDistanceMultiple: 3 });
    const t5 = galaxyLodTiers({ radiusLy: 100_000, fullDistanceMultiple: 5 });
    expect(t5[0].maxDistance / t3[0].maxDistance).toBeCloseTo(5 / 3, 6);
  });

  it('every tier has a crossfadeRatio in (0,1)', () => {
    for (const t of galaxyLodTiers({ radiusLy: 100_000 })) {
      const cr = t.crossfadeRatio ?? 0.15;
      expect(cr).toBeGreaterThan(0);
      expect(cr).toBeLessThan(1);
    }
  });
});

describe('GALAXY_PRESETS', () => {
  it('every preset is a valid 4-tier table', () => {
    for (const [name, tiers] of Object.entries(GALAXY_PRESETS)) {
      expect(tiers, `preset "${name}"`).toHaveLength(4);
      expect(tiers[tiers.length - 1].maxDistance).toBe(Infinity);
    }
  });

  it('Andromeda has a larger full-render distance than LMC', () => {
    expect(GALAXY_PRESETS.andromeda[0].maxDistance).toBeGreaterThan(
      GALAXY_PRESETS.lmc[0].maxDistance,
    );
  });
});

describe('speedForDistance', () => {
  it('clamps to FLOOR at tiny distances', () => {
    expect(speedForDistance(0)).toBe(50);
    expect(speedForDistance(100)).toBe(50); // 100/10 = 10, below floor
  });

  it('clamps to CEILING at universe scale', () => {
    expect(speedForDistance(1e30)).toBe(1e25);
    expect(speedForDistance(1e26)).toBe(1e25);
  });

  it('is monotonically non-decreasing', () => {
    let prev = 0;
    for (const d of [1e6, 1e10, 1e14, 1e18, 1e22, 1e25]) {
      const s = speedForDistance(d);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('crosses 1 AU in ~10 seconds at the AU-tier speed', () => {
    // At 1 AU, distance/10 = 1 AU per 10 seconds of travel.
    const AU = 1.496e11;
    const speed = speedForDistance(AU);
    const secondsToCross1AU = AU / speed;
    expect(secondsToCross1AU).toBeCloseTo(10, 0);
  });

  // IAU value used in src/core/frames.ts METERS.ly. Keep in sync.
  const IAU_LY_M = 9.4607304725808e15;

  it('converts kilolight-years and megalight-years using the IAU light-year', () => {
    expect(METERS.kly).toBeCloseTo(IAU_LY_M * 1e3, 0);
    expect(METERS.mly).toBeCloseTo(IAU_LY_M * 1e6, 0);
  });
});

describe('boostMultiplierForDistance', () => {
  it('is ~2× at near-ground distances (decade <= 8)', () => {
    // 1e8 m = 100,000 km, decade = 8
    expect(boostMultiplierForDistance(1e8)).toBeCloseTo(2, 5);
    // Closer than that, still 2× (no negative boost)
    expect(boostMultiplierForDistance(1e6)).toBeCloseTo(2, 5);
  });

  it('grows with distance, reaching ~20× at intergalactic scale', () => {
    // decade = 20 → 2 + 1.8*12 = 23.6
    const m = boostMultiplierForDistance(1e20);
    expect(m).toBeGreaterThan(20);
    // decade = 24 → 2 + 1.8*16 = 30.8
    const M = boostMultiplierForDistance(1e24);
    expect(M).toBeGreaterThan(m);
  });

  it('is monotonically non-decreasing', () => {
    let prev = 0;
    for (const d of [1e6, 1e10, 1e14, 1e18, 1e22, 1e26]) {
      const m = boostMultiplierForDistance(d);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
});