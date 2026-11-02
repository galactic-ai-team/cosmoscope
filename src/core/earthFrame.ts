// src/core/earthFrame.ts � Cosmoscope sky axes <-> Earth lat/lon (owner: Claude).
//
// Cosmoscope's frames all use ICRS axes (fixed to the distant sky). Earth
// spins under them, and its axis also drifts slowly (precession, ~50"/year),
// so "what's under the camera" needs both:
//   ICRS (&#8776; mean J2000)  --precession (IAU 1976)-->  mean equator of date
//                        --Earth rotation (GMST, IAU 1982)-->  Earth-fixed
// then Earth-fixed x/y/z -> geodetic lat/lon/height on WGS84.
//
// Left out on purpose: nutation (&#8804; ~17", about 0.5 km on the ground), polar
// motion (&#8804; ~0.5", ~15 m), the ICRS frame bias (~0.02") and UT1-UTC (&#8804; 0.9 s,
// &#8804; ~0.4 km). Together they stay well under a kilometre, which is plenty for
// handing a camera to earth-walker. Precession alone would be ~40 km by 2026,
// which is why it's included.

import type { Vec3Like } from './frames';

const ARCSEC = Math.PI / (180 * 3600);
const DEG = Math.PI / 180;

/** WGS84 ellipsoid. */
export const WGS84_A = 6378137.0;
export const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);
const E2 = WGS84_F * (2 - WGS84_F);
const EP2 = E2 / (1 - E2);

export interface GeodeticPosition {
  /** Degrees, north positive. */
  lat: number;
  /** Degrees, east positive, in (-180, 180]. */
  lon: number;
  /** Metres above the WGS84 ellipsoid. */
  height: number;
}

/** Julian centuries since J2000.0 (2000-01-01 12:00 UTC), treating UTC as UT1/TT. */
export function julianCenturies(date: Date): number {
  const jd = date.getTime() / 86_400_000 + 2440587.5;
  return (jd - 2451545.0) / 36525;
}

/** Greenwich mean sidereal time, radians in [0, 2&#960;) (IAU 1982). */
export function gmst(date: Date): number {
  const t = julianCenturies(date);
  // Seconds of time; 876600 h = 36525 days of 24 h, converted to seconds below.
  const seconds = 67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  const rad = ((seconds % 86400) / 86400) * 2 * Math.PI;
  return ((rad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Rotation of the coordinate frame about z by angle a (R3 in IAU notation). */
function r3(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
/** Rotation of the coordinate frame about y by angle a (R2). */
function r2(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}
function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
function apply(m: Mat3, v: Vec3Like): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}
function applyTransposed(m: Mat3, v: Vec3Like): [number, number, number] {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

/** IAU 1976 precession matrix: mean J2000 -> mean equator and equinox of date. */
export function precessionMatrix(date: Date): Mat3 {
  const t = julianCenturies(date);
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) * ARCSEC;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) * ARCSEC;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) * ARCSEC;
  return mul(r3(-z), mul(r2(theta), r3(-zeta)));
}

/** Full ICRS -> Earth-fixed rotation at `date` (precession, then Earth's spin). */
export function icrsToEarthMatrix(date: Date): Mat3 {
  return mul(r3(gmst(date)), precessionMatrix(date));
}

/** Earth-fixed x/y/z (metres) -> WGS84 geodetic latitude, longitude, height. */
export function ecefToGeodetic(x: number, y: number, z: number): GeodeticPosition {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  if (p < 1e-9) {
    return { lat: z >= 0 ? 90 : -90, lon: 0, height: Math.abs(z) - WGS84_B };
  }
  // Bowring's formula, then two Newton refinements: sub-millimetre everywhere.
  const theta = Math.atan2(z * WGS84_A, p * WGS84_B);
  let lat = Math.atan2(z + EP2 * WGS84_B * Math.sin(theta) ** 3, p - E2 * WGS84_A * Math.cos(theta) ** 3);
  let n = WGS84_A;
  let height = 0;
  for (let i = 0; i < 2; i++) {
    const sinLat = Math.sin(lat);
    n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
    height = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + height)));
  }
  const sinLat = Math.sin(lat);
  n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  height = Math.abs(Math.cos(lat)) > 1e-10 ? p / Math.cos(lat) - n : Math.abs(z) / Math.abs(sinLat) - n * (1 - E2);
  return { lat: lat / DEG, lon: lon / DEG, height };
}

/** WGS84 geodetic -> Earth-fixed x/y/z, metres. */
export function geodeticToEcef(latDeg: number, lonDeg: number, height: number): [number, number, number] {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return [
    (n + height) * Math.cos(lat) * Math.cos(lon),
    (n + height) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - E2) + height) * sinLat,
  ];
}

/**
 * Where on Earth a point is, given its offset from Earth's centre in ICRS
 * axes (metres) at `date`. Height is above the WGS84 ellipsoid.
 */
export function icrsToLatLon(offsetFromEarthCentre: Vec3Like, date: Date): GeodeticPosition {
  const [x, y, z] = apply(icrsToEarthMatrix(date), offsetFromEarthCentre);
  return ecefToGeodetic(x, y, z);
}

/** Inverse of icrsToLatLon: ICRS offset from Earth's centre (metres) for a spot on Earth. */
export function latLonToIcrs(latDeg: number, lonDeg: number, height: number, date: Date): [number, number, number] {
  return applyTransposed(icrsToEarthMatrix(date), geodeticToEcef(latDeg, lonDeg, height));
}

/**
 * Compass heading (degrees clockwise from north) of an ICRS direction as seen
 * from a spot on Earth, for handing the camera's facing to earth-walker.
 * Returns 0 when the direction is straight up or down.
 */
export function icrsDirectionToHeading(directionIcrs: Vec3Like, latDeg: number, lonDeg: number, date: Date): number {
  const [dx, dy, dz] = apply(icrsToEarthMatrix(date), directionIcrs);
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  // Local east and north unit vectors in Earth-fixed axes.
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const e = dx * east[0] + dy * east[1] + dz * east[2];
  const nn = dx * north[0] + dy * north[1] + dz * north[2];
  if (Math.hypot(e, nn) < 1e-12) return 0;
  return ((Math.atan2(e, nn) / DEG) % 360 + 360) % 360;
}