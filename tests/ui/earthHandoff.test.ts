import { describe, expect, it } from 'vitest';
import {
  createHandoffTrigger,
  earthWalkerUrl,
  geodeticFromGeocentric,
  gmstRad,
  HANDOFF,
  spotUnderCamera,
} from '../../src/ui/earthHandoff';
import { ECLIPTIC_NORTH } from '../../src/core/frames';

const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
const SIDEREAL_DAY_MS = 86_164_090.5;
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
/** Unit vector at right ascension / declination (degrees), ICRS axes. */
const radec = (ra: number, dec: number) => [Math.cos(rad(dec)) * Math.cos(rad(ra)), Math.cos(rad(dec)) * Math.sin(rad(ra)), Math.sin(rad(dec))];
const Z = [0, 0, 1];

describe('gmstRad', () => {
  it('is 18.697374558 h (280.4606 deg) at J2000.0 (IAU)', () => {
    expect(deg(gmstRad(J2000))).toBeCloseTo(280.46061837, 6);
  });
  it('advances 360 deg per sidereal day and ~360.9856 deg per solar day', () => {
    expect(deg(gmstRad(J2000 + SIDEREAL_DAY_MS))).toBeCloseTo(280.46061837, 3);
    expect(deg(gmstRad(J2000 + 86_400_000))).toBeCloseTo((280.46061837 + 360.98564736629) % 360, 5);
  });
});

describe('spotUnderCamera', () => {
  it('maps right ascension to longitude through Earth rotation', () => {
    // Camera above the vernal equinox direction at J2000 noon: lon = -GMST.
    const s = spotUnderCamera([3, 0, 0], Z, null, J2000);
    expect(s.lat).toBeCloseTo(0, 9);
    expect(s.lon).toBeCloseTo(360 - 280.46061837, 6); // 79.539 deg E
    // Camera at RA = GMST sits over Greenwich.
    expect(spotUnderCamera(radec(280.46061837, 0), Z, null, J2000).lon).toBeCloseTo(0, 6);
  });
  it('is independent of distance (any unit, any length)', () => {
    const a = spotUnderCamera(radec(40, 20), Z, null, J2000);
    const b = spotUnderCamera(radec(40, 20).map((v) => v * 1e-4), Z, null, J2000);
    expect(b.lat).toBeCloseTo(a.lat, 9);
    expect(b.lon).toBeCloseTo(a.lon, 9);
  });
  it('the ground turns east under a fixed camera (6 sidereal h -> 90 deg west)', () => {
    const p = radec(120, 10);
    const a = spotUnderCamera(p, Z, null, J2000).lon;
    const b = spotUnderCamera(p, Z, null, J2000 + SIDEREAL_DAY_MS / 4).lon;
    expect(((a - b + 540) % 360) - 180).toBeCloseTo(90, 3);
  });
  it('uses +z (celestial north = Earth spin axis) for latitude, geodetic on WGS84', () => {
    expect(spotUnderCamera([0, 0, 5], Z, null, J2000).lat).toBeCloseTo(90, 9);
    expect(spotUnderCamera([0, 0, -5], Z, null, J2000).lat).toBeCloseTo(-90, 9);
    // 45 deg geocentric is 45.19 deg geodetic.
    expect(spotUnderCamera(radec(0, 45), Z, null, J2000).lat).toBeCloseTo(45.1924, 3);
    expect(deg(geodeticFromGeocentric(0))).toBe(0);
  });
  it('axial tilt: a camera over the ecliptic pole is over latitude 66.56 N (Arctic Circle)', () => {
    const s = spotUnderCamera(ECLIPTIC_NORTH, Z, null, J2000);
    // geocentric 90 - 23.4393 = 66.5607; geodetic a little higher
    expect(s.lat).toBeGreaterThan(66.56);
    expect(s.lat).toBeLessThan(66.8);
  });
  it('heading = screen-up projected on the horizon, clockwise from north', () => {
    const p = radec(30, 0);
    expect(spotUnderCamera(p, Z, null, J2000).headingDeg).toBeCloseTo(0, 6); // up = north
    const east = [-Math.sin(rad(30)), Math.cos(rad(30)), 0];
    expect(spotUnderCamera(p, east, null, J2000).headingDeg).toBeCloseTo(90, 6);
    expect(spotUnderCamera(p, [0, 0, -1], null, J2000).headingDeg).toBeCloseTo(180, 6);
    expect(spotUnderCamera(p, east.map((v) => -v), null, J2000).headingDeg).toBeCloseTo(270, 6);
    // Up straight along the radius has no horizontal part: default north.
    expect(spotUnderCamera(p, p, null, J2000).headingDeg).toBe(0);
  });
  it('solar hour from the Sun direction: sun overhead = noon, behind = midnight, 90 deg west = 18 h', () => {
    const p = radec(100, 5);
    expect(spotUnderCamera(p, Z, radec(100, -20), J2000).solarHour).toBeCloseTo(12, 9);
    expect(spotUnderCamera(p, Z, radec(280, 0), J2000).solarHour).toBeCloseTo(0, 9);
    // Sun at lower RA (west of the meridian): afternoon.
    expect(spotUnderCamera(p, Z, radec(10, 0), J2000).solarHour).toBeCloseTo(18, 9);
    expect(spotUnderCamera(p, Z, null, J2000).solarHour).toBeNull();
  });
  it('rejects a camera at Earth\'s centre', () => {
    expect(() => spotUnderCamera([0, 0, 0], Z, null, J2000)).toThrow();
  });
});

describe('earthWalkerUrl', () => {
  /** earth-walker's parsePermalink (src/permalink.ts), inlined. */
  const parse = (hash: string) => {
    const parts = hash.slice(1).split(',').map(Number);
    return parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
  };
  it('puts the marker in the query and an earth-walker permalink in the hash', () => {
    const url = earthWalkerUrl({ lat: 40.71280049, lon: -74.006, headingDeg: 90.4, solarHour: 14.256 });
    expect(url).toBe('https://earth-walker-eight.vercel.app/?from=cosmoscope&hour=14.26#40.7128,-74.006,2,90');
    const u = new URL(url);
    expect(u.searchParams.get('from')).toBe('cosmoscope');
    expect(parse(u.hash)).toEqual([40.7128, -74.006, 2, 90]);
  });
  it('omits hour without a Sun, wraps heading, normalises -0 and -180', () => {
    expect(earthWalkerUrl({ lat: -0.0000001, lon: -180, headingDeg: 359.7, solarHour: null }, 'http://x/'))
      .toBe('http://x/?from=cosmoscope#0,180,2,0');
  });
  it('round-trips spotUnderCamera output through the parser for random cameras', () => {
    for (let i = 0; i < 200; i++) {
      const s = spotUnderCamera(radec(i * 37.3, ((i * 53.1) % 180) - 90), [Math.sin(i), Math.cos(i), 0.3], radec(i * 11, 0), J2000 + i * 3.6e6);
      const h = parse(new URL(earthWalkerUrl(s)).hash)!;
      expect(h).not.toBeNull();
      expect(h[0]).toBeGreaterThanOrEqual(-90);
      expect(h[0]).toBeLessThanOrEqual(90);
      expect(h[1]).toBeGreaterThan(-180);
      expect(h[1]).toBeLessThanOrEqual(180);
      expect(h[3]).toBeGreaterThanOrEqual(0);
      expect(h[3]).toBeLessThan(360);
    }
  });
});

describe('createHandoffTrigger', () => {
  it('shows the button within 12 R (covers the 9 R fly-to framing), not beyond', () => {
    const t = createHandoffTrigger();
    expect(t.update(9).showButton).toBe(true);
    expect(t.update(HANDOFF.showButtonR + 0.1).showButton).toBe(false);
    expect(t.update(Infinity).showButton).toBe(false);
  });
  it('never fires from distance alone (fly-to framing, orbiting at the floor)', () => {
    const t = createHandoffTrigger();
    for (const d of [9, 5, 2, 1.2, 1.05, 1.05, 1.05]) expect(t.update(d).fire).toBe(false);
  });
  it('zoom-in outside the push zone does not count', () => {
    const t = createHandoffTrigger();
    t.update(3);
    t.zoomInput(10);
    expect(t.update(1.05).fire).toBe(false);
  });
  it('fires once after 3 notches of continued zoom-in at the floor', () => {
    const t = createHandoffTrigger();
    t.update(1.05);
    t.zoomInput(1);
    t.zoomInput(1);
    expect(t.update(1.05).fire).toBe(false);
    t.zoomInput(1);
    expect(t.update(1.05).fire).toBe(true);
    t.zoomInput(5);
    expect(t.update(1.05).fire).toBe(false); // only once until reset()
    t.reset();
    t.zoomInput(3);
    expect(t.update(1.05).fire).toBe(true);
  });
  it('zooming out or leaving past 1.6 R clears the push', () => {
    const t = createHandoffTrigger();
    t.update(1.1);
    t.zoomInput(2);
    t.zoomInput(-0.5);
    t.zoomInput(2);
    expect(t.update(1.1).fire).toBe(false);
    t.update(2);
    t.update(1.1);
    t.zoomInput(1.5);
    expect(t.update(1.1).fire).toBe(false);
    t.zoomInput(1.5);
    expect(t.update(1.1).fire).toBe(true);
  });
  it('ignores junk input', () => {
    const t = createHandoffTrigger();
    t.update(1.05);
    t.zoomInput(NaN);
    t.zoomInput(Infinity);
    expect(t.update(1.05).fire).toBe(false);
  });
});
