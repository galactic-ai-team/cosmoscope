// tests/layers/milkyWay.test.ts (Lumi, P0 b, Stephon's 10:48 PM report): the
// Milky Way is a barred spiral in the galactic plane, seen from above the disk
// on arrival, that stays out of the in-galaxy star view.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generatorParamsFor } from '../../src/layers/galaxyProfiles';
import { MW_FADE_LY, MW_VIEW_ELEVATION_DEG, milkyWayBasis, milkyWayFade, milkyWayViewDir, ngpUnit } from '../../src/ui/proceduralGalaxies';
import { createProceduralGalaxy } from '../../src/galaxies/generator';

describe('Milky Way mesh', () => {
  // Galactic Centre, Sun-centred ICRS parsecs (RA 266.405, Dec -28.936, 8.27 kpc).
  const ra = (266.405 * Math.PI) / 180, dec = (-28.936 * Math.PI) / 180, d = 8270;
  const gc = [d * Math.cos(dec) * Math.cos(ra), d * Math.cos(dec) * Math.sin(ra), d * Math.sin(dec)];

  it('lies in the galactic plane: Z = north galactic pole, the Sun in the disk plane', () => {
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
    const m = milkyWayBasis(gc);
    m.extractBasis(x, y, z);
    expect(m.determinant()).toBeCloseTo(1);
    const ngpRa = (192.859 * Math.PI) / 180, ngpDec = (27.128 * Math.PI) / 180;
    expect(z.x).toBeCloseTo(Math.cos(ngpDec) * Math.cos(ngpRa), 6);
    expect(z.z).toBeCloseTo(Math.sin(ngpDec), 6);
    const toSun = new THREE.Vector3(-gc[0], -gc[1], -gc[2]).normalize();
    expect(Math.abs(toSun.dot(z))).toBeLessThan(0.01); // Sun within ~0.5 deg of the plane
    expect(toSun.dot(x)).toBeCloseTo(Math.cos((27 * Math.PI) / 180), 2); // bar 27 deg off the Sun line
  });
  it('is generated as a barred spiral (bar stars along local X)', () => {
    const g = createProceduralGalaxy(generatorParamsFor('galaxy:common:milkyway')!);
    let pts: THREE.Points | null = null;
    g.container.traverse((o) => { if (!pts && o instanceof THREE.Points) pts = o; });
    expect(pts).not.toBeNull();
    expect((pts as unknown as THREE.Points).geometry.getAttribute('position').count).toBeGreaterThan(5000);
  });
  it('is hidden inside the star field and fully in from 100,000 ly out', () => {
    expect(milkyWayFade(0)).toBe(0);
    expect(milkyWayFade(MW_FADE_LY.start)).toBe(0);
    expect(milkyWayFade(80_000)).toBeCloseTo(0.5);
    expect(milkyWayFade(MW_FADE_LY.end)).toBe(1);
    expect(milkyWayFade(150_000)).toBe(1);
  });
});

describe('Milky Way arrival view', () => {
  it('swings an edge-on (in-plane) offset up to MW_VIEW_ELEVATION_DEG above the disk, same longitude', () => {
    const n = ngpUnit();
    // An in-plane offset: any vector minus its NGP component.
    const v = [1, 0, 0];
    const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    const inPlane = [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]];
    const out = milkyWayViewDir(inPlane);
    expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1);
    const elev = Math.asin(out[0] * n[0] + out[1] * n[1] + out[2] * n[2]) * 180 / Math.PI;
    expect(elev).toBeCloseTo(MW_VIEW_ELEVATION_DEG, 6);
    // Same azimuth: the in-plane part points the same way as the input.
    const l = Math.hypot(inPlane[0], inPlane[1], inPlane[2]);
    const dot = (out[0] * inPlane[0] + out[1] * inPlane[1] + out[2] * inPlane[2]) / l;
    expect(dot).toBeCloseTo(Math.cos(MW_VIEW_ELEVATION_DEG * Math.PI / 180), 6);
  });
  it('copes with an offset straight along the pole', () => {
    const out = milkyWayViewDir(ngpUnit());
    expect(out.every(Number.isFinite)).toBe(true);
  });
});
