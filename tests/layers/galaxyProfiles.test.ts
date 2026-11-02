// tests/layers/galaxyProfiles.test.ts — per-galaxy catalog data:
// profile sanity, budget caps, deterministic seeds, default/null
// behavior of generatorParamsFor. No network.

import { describe, expect, it } from 'vitest';

import {
  GALAXY_PROFILES,
  MAX_STAR_COUNT_NEAR,
  generatorParamsFor,
  hashSeed,
} from '../../src/layers/galaxyProfiles';

describe('GALAXY_PROFILES', () => {
  it('covers the named majors', () => {
    for (const id of [
      'galaxy:messier:M31',
      'galaxy:messier:M33',
      'galaxy:messier:M51',
      'galaxy:messier:M81',
      'galaxy:messier:M82',
      'galaxy:messier:M87',
      'galaxy:messier:M101',
      'galaxy:messier:M104',
      'galaxy:pgc:17223', // LMC
      'galaxy:pgc:3085', // SMC
    ]) {
      expect(GALAXY_PROFILES[id], id).toBeDefined();
    }
  });

  it('has Andromeda as the edge-on Sb it is', () => {
    const m31 = GALAXY_PROFILES['galaxy:messier:M31'];
    expect(m31.morphology).toBe('Sb');
    expect(m31.diameterLy).toBe(220_000);
    expect(m31.inclinationDeg).toBe(77);
    expect(m31.positionAngleDeg).toBe(38);
    expect(m31.armCount).toBe(2);
  });

  it('keeps every profile inside sane ranges and the budget cap', () => {
    for (const p of Object.values(GALAXY_PROFILES)) {
      expect(p.diameterLy).toBeGreaterThan(0);
      if (p.inclinationDeg !== null) {
        expect(p.inclinationDeg).toBeGreaterThanOrEqual(0);
        expect(p.inclinationDeg).toBeLessThanOrEqual(90);
      }
      if (p.positionAngleDeg !== null) {
        expect(p.positionAngleDeg).toBeGreaterThanOrEqual(0);
        expect(p.positionAngleDeg).toBeLessThan(180);
      }
      expect(p.bulgeFraction).toBeGreaterThanOrEqual(0);
      expect(p.bulgeFraction).toBeLessThanOrEqual(1);
      expect(p.dustStrength).toBeGreaterThanOrEqual(0);
      expect(p.dustStrength).toBeLessThanOrEqual(1);
      expect(p.starCountNear).toBeGreaterThanOrEqual(200);
      expect(p.starCountNear).toBeLessThanOrEqual(MAX_STAR_COUNT_NEAR);
      expect(p.seed).toBe(hashSeed(p.id));
      if (p.morphology === 'E' || p.morphology === 'dSph') {
        expect(p.armCount).toBe(0);
        expect(p.pitchDeg).toBe(0);
      }
    }
  });

  it('orders pitch by Hubble type: Sa tighter than Sb tighter than Sc', () => {
    const sa = GALAXY_PROFILES['galaxy:messier:M104'];
    const sb = GALAXY_PROFILES['galaxy:messier:M31'];
    const sc = GALAXY_PROFILES['galaxy:messier:M33'];
    expect(sa.pitchDeg).toBeLessThan(sb.pitchDeg);
    expect(sb.pitchDeg).toBeLessThan(sc.pitchDeg);
  });
});

describe('generatorParamsFor', () => {
  it('returns verified profiles flagged as such', () => {
    const p = generatorParamsFor('galaxy:messier:M33');
    expect(p?.fromProfile).toBe(true);
    expect(p?.morphology).toBe('Sc');
  });

  it('builds the Milky Way as a barred spiral (Lumi, P0 b) and returns null for clusters', () => {
    const mw = generatorParamsFor('galaxy:common:milkyway');
    expect(mw?.fromProfile).toBe(true);
    expect(mw?.morphology).toBe('SBbc');
    expect(mw?.morphology.startsWith('SB')).toBe(true); // the generator bars SB*
    expect(mw?.diameterLy).toBe(100_000);
    expect(generatorParamsFor('cluster:common:virgo')).toBeNull();
    expect(generatorParamsFor('cluster:abell:1656')).toBeNull();
  });

  it('gives unprofiled galaxies a capped, deterministic dwarf default', () => {
    const a = generatorParamsFor('galaxy:pgc:10074', 9_300);
    const b = generatorParamsFor('galaxy:pgc:10074', 9_300);
    expect(a).toEqual(b);
    expect(a?.morphology).toBe('dSph');
    expect(a?.fromProfile).toBe(false);
    expect(a?.starCountNear).toBeLessThanOrEqual(1_500);
    expect(generatorParamsFor('galaxy:ufd:hydrus-1')?.diameterLy).toBe(2_000);
  });
});

describe('hashSeed', () => {
  it('is deterministic and separates ids', () => {
    expect(hashSeed('galaxy:messier:M31')).toBe(hashSeed('galaxy:messier:M31'));
    expect(hashSeed('galaxy:messier:M31')).not.toBe(hashSeed('galaxy:messier:M33'));
  });
});
