// src/core/__tests__/earthFrame.test.ts � ICRS <-> Earth lat/lon (owner: Claude).
import { describe, expect, it } from 'vitest';

import {
  WGS84_A,
  ecefToGeodetic,
  geodeticToEcef,
  gmst,
  icrsDirectionToHeading,
  icrsToLatLon,
  latLonToIcrs,
  precessionMatrix,
} from '../earthFrame';

const J2000 = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
const Y2025 = new Date(Date.UTC(2025, 0, 1, 12, 0, 0));
const deg = (r: number) => (r * 180) / Math.PI;

describe('gmst', () => {
  it('is 18.697374558 h (280.4606�) at J2000.0', () => {
    expect(deg(gmst(J2000))).toBeCloseTo(280.46061837, 5);
  });

  it('advances one sidereal day (~23h56m4s of clock time) per full turn', () => {
    const later = new Date(J2000.getTime() + 86164.0905 * 1000);
    const diff = (deg(gmst(later)) - deg(gmst(J2000)) + 360) % 360;
    expect(Math.min(diff, 360 - diff)).toBeLessThan(0.001);
  });
});

describe('precession', () => {
  it('moves the J2000 equinox ~0.32� east in right ascension by 2025', () => {
    const p = precessionMatrix(Y2025);
    const [x, y] = [p[0], p[3]]; // image of the ICRS x axis
    expect(deg(Math.atan2(y, x))).toBeCloseTo(0.32, 2);
  });

  it('tilts the J2000 pole by ~0.139� by 2025', () => {
    const p = precessionMatrix(Y2025);
    const zz = p[8];
    expect(deg(Math.acos(zz))).toBeCloseTo(0.139, 3);
  });

  it('is the identity at J2000', () => {
    const p = precessionMatrix(J2000);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(p[i]).toBeCloseTo(v, 12));
  });
});

describe('geodetic conversions', () => {
  it('puts the equator and pole on the ellipsoid at height 0', () => {
    const eq = ecefToGeodetic(WGS84_A, 0, 0);
    expect(eq.lat).toBeCloseTo(0, 9);
    expect(eq.lon).toBeCloseTo(0, 9);
    expect(eq.height).toBeCloseTo(0, 3);
    const pole = ecefToGeodetic(0, 0, 6356752.314245);
    expect(pole.lat).toBe(90);
    expect(pole.height).toBeCloseTo(0, 3);
  });

  it('round-trips lat/lon/height to sub-millimetre, including altitude', () => {
    for (const [lat, lon, h] of [
      [40.7411, -73.9897, 30],
      [45.9837, 7.7848, 3100],
      [-33.86, 151.21, 400_000],
      [89.9, 10, 1000],
    ]) {
      const g = ecefToGeodetic(...geodeticToEcef(lat, lon, h));
      expect(g.lat).toBeCloseTo(lat, 8);
      expect(g.lon).toBeCloseTo(lon, 8);
      expect(Math.abs(g.height - h)).toBeLessThan(1e-3);
    }
  });
});

describe('icrsToLatLon', () => {
  it('at J2000.0 the ICRS x axis (vernal equinox) is over longitude 360 - 280.46 = 79.54� E', () => {
    const g = icrsToLatLon([WGS84_A + 1000, 0, 0], J2000);
    expect(g.lat).toBeCloseTo(0, 6);
    expect(g.lon).toBeCloseTo(79.5393816, 4);
    expect(g.height).toBeCloseTo(1000, 3);
  });

  it('round-trips through latLonToIcrs at any date', () => {
    const when = new Date(Date.UTC(2026, 10, 1, 18, 30, 0));
    for (const [lat, lon, h] of [
      [40.7411, -73.9897, 2_000],
      [45.9837, 7.7848, 50_000],
      [-60, -120, 1_000_000],
    ]) {
      const g = icrsToLatLon(latLonToIcrs(lat, lon, h, when), when);
      expect(g.lat).toBeCloseTo(lat, 7);
      expect(g.lon).toBeCloseTo(lon, 7);
      expect(Math.abs(g.height - h)).toBeLessThan(1e-3);
    }
  });

  it('precession matters: skipping it is ~40 km off at the surface by 2026', () => {
    const when = new Date(Date.UTC(2026, 6, 1, 0, 0, 0));
    const icrs = latLonToIcrs(40.7411, -73.9897, 0, when);
    // Same point with Earth rotation only (what a GMST-only conversion would do).
    const a = gmst(when);
    const xe = Math.cos(a) * icrs[0] + Math.sin(a) * icrs[1];
    const ye = -Math.sin(a) * icrs[0] + Math.cos(a) * icrs[1];
    const g = ecefToGeodetic(xe, ye, icrs[2]);
    const dLat = (g.lat - 40.7411) * 111_320;
    const dLon = (g.lon + 73.9897) * 111_320 * Math.cos((40.7411 * Math.PI) / 180);
    const km = Math.hypot(dLat, dLon) / 1000;
    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(60);
  });
});

describe('icrsDirectionToHeading', () => {
  it('reads north, east and west correctly at a spot on Earth', () => {
    const when = new Date(Date.UTC(2026, 10, 1, 12, 0, 0));
    const lat = 40.7411;
    const lon = -73.9897;
    const here = latLonToIcrs(lat, lon, 0, when);
    const north = latLonToIcrs(lat + 0.01, lon, 0, when).map((v, i) => v - here[i]);
    const east = latLonToIcrs(lat, lon + 0.01, 0, when).map((v, i) => v - here[i]);
    const n = icrsDirectionToHeading(north, lat, lon, when);
    expect(Math.min(n, 360 - n)).toBeLessThan(0.05);
    expect(icrsDirectionToHeading(east, lat, lon, when)).toBeCloseTo(90, 1);
    expect(icrsDirectionToHeading(east.map((v) => -v), lat, lon, when)).toBeCloseTo(270, 1);
  });
});