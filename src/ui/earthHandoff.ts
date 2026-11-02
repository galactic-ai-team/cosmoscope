// Earth handoff (Lumi): fly close to Earth in Cosmoscope and fade into
// earth-walker (galactic-ai-team/earth-walker) standing at the spot that was
// under the camera. Pure math + URL + trigger logic live here (unit-tested in
// tests/ui/earthHandoff.test.ts); the DOM button/fade is src/ui/walkOnEarth.ts.
//
// Geography under the camera
// --------------------------
// Cosmoscope's Earth is an untextured sphere, so "where am I over?" is defined
// physically, from the frame contract in src/core/frames.ts:
//   - All frames share ICRS equatorial axes (+x vernal equinox, +z north
//     celestial pole). Earth's spin axis IS +z, so Earth's axial tilt is
//     already baked into the axes (ecliptic north = ECLIPTIC_NORTH, 23.44 deg
//     off +z). The vector camera - Earth centre, in those axes, gives the
//     sub-camera point's right ascension a and (geocentric) declination d.
//   - Earth's rotation: longitude = a - GMST(now), with GMST from the IAU
//     linear formula (18.697374558 h at J2000.0 + 24.06570982441908 h/day).
//     Real UTC is used (not the solar-system layer's 500x sim clock), so the
//     spot matches the real sky earth-walker would show at that moment.
//   - Latitude: geocentric d converted to geodetic on WGS84
//     (tan(phi) = tan(d) / (1 - e^2)); the two differ by <= 0.19 deg.
//   - Heading: the camera's screen-up vector projected onto the local
//     horizon, measured clockwise from north, so "up on screen" in space
//     becomes "straight ahead" on the street.
//   - Local solar hour: from the Sun's direction in the scene (Sun = helio
//     origin), hour = 12 + (a_spot - a_sun) / 15 deg. Day side in Cosmoscope
//     lands in daylight in earth-walker (it accepts ?hour=).
//
// Earth-walker URL: its permalink hash is exactly "#lat,lon,heightM,heading"
// (src/permalink.ts parsePermalink rejects anything else, including a
// trailing "&from=..."), so the handoff marker rides in the QUERY string:
//   https://earth-walker-eight.vercel.app/?from=cosmoscope&hour=14.5#40.7128,-74.006,2,90
// Today's earth-walker ignores the query and teleports to street level from
// the hash; the companion earth-walker PR (lumi/space-handoff) uses it to
// start in orbit, fly down and offer "Back to space".

export const EARTH_ID = 'planet:earth';
export const EARTH_WALKER_URL = 'https://earth-walker-eight.vercel.app/';
/** Standing eye height sent in the permalink (metres above ground). */
export const LANDING_HEIGHT_M = 2;

/**
 * Thresholds, in units of Earth's RENDERED radius (0.025 AU in
 * solarSystemLayer.ts; the sphere is inflated for visibility, so real-km
 * altitudes would be meaningless here). Distances are from Earth's centre.
 *   - flyTo 'orbit' frames Earth at 3 x approachRadius = 9 R.
 *   - CosmoControls' zoom floor is 1.05 R (#53).
 */
export const HANDOFF = {
  /** "Walk on Earth" button shows inside this distance (covers the 9 R fly-to framing). */
  showButtonR: 12,
  /** Push zone: within this distance zoom-in input counts toward the auto trigger. */
  pushZoneR: 1.25,
  /** Zoom-in notches (wheel notches / pinch log-zoom / +) needed while in the push zone. */
  pushNotches: 3,
  /** Leaving past this distance resets accumulated push (hysteresis). */
  resetR: 1.6,
} as const;

const DEG = 180 / Math.PI;
const WGS84_E2 = 0.00669437999014;
const J2000_UTC_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const MS_PER_DAY = 86_400_000;

export type V3 = ArrayLike<number>;

/** Greenwich mean sidereal time in radians, [0, 2pi). IAU 1982 linear term (~0.1 s/century drift; fine here). */
export function gmstRad(utcMs: number): number {
  const d = (utcMs - J2000_UTC_MS) / MS_PER_DAY;
  const hours = 18.697374558 + 24.06570982441908 * d;
  return wrap2pi((hours / 24) * 2 * Math.PI);
}

export interface EarthSpot {
  /** Geodetic latitude, degrees [-90, 90]. */
  lat: number;
  /** Longitude, degrees (-180, 180]. */
  lon: number;
  /** Heading of screen-up on the ground, degrees clockwise from north [0, 360). */
  headingDeg: number;
  /** Local solar hour at the spot from the scene's Sun direction, [0, 24). Null if no Sun given. */
  solarHour: number | null;
}

/**
 * The spot on Earth directly under the camera.
 * @param rel   camera position minus Earth's centre, in ICRS axes (any unit)
 * @param up    camera up vector, ICRS axes (CosmoCamera.getCameraUp)
 * @param sun   direction from Earth to the Sun, ICRS axes (any length), or null
 * @param utcMs wall-clock time (Date.now())
 */
export function spotUnderCamera(rel: V3, up: V3, sun: V3 | null, utcMs: number): EarthSpot {
  const r = Math.hypot(rel[0], rel[1], rel[2]);
  if (!(r > 0)) throw new RangeError('spotUnderCamera: camera is at Earth\'s centre');
  const x = rel[0] / r, y = rel[1] / r, z = rel[2] / r;
  const ra = Math.atan2(y, x);
  const decGc = Math.asin(Math.max(-1, Math.min(1, z)));
  const lat = geodeticFromGeocentric(decGc) * DEG;
  const lon = wrap180((ra - gmstRad(utcMs)) * DEG);

  // Local north/east unit vectors (ICRS axes) at the sub-camera point.
  const sa = Math.sin(ra), ca = Math.cos(ra), sd = Math.sin(decGc), cd = Math.cos(decGc);
  const east = [-sa, ca, 0];
  const north = [-sd * ca, -sd * sa, cd];
  const un = up[0] * north[0] + up[1] * north[1] + up[2] * north[2];
  const ue = up[0] * east[0] + up[1] * east[1] + up[2] * east[2];
  const headingDeg = Math.hypot(un, ue) < 1e-9 ? 0 : wrap360(Math.atan2(ue, un) * DEG);

  let solarHour: number | null = null;
  if (sun && Math.hypot(sun[0], sun[1]) > 0) {
    const raSun = Math.atan2(sun[1], sun[0]);
    solarHour = wrap24(12 + ((ra - raSun) * DEG) / 15);
  }
  return { lat, lon, headingDeg, solarHour };
}

/** Geocentric latitude (rad) at the surface -> geodetic latitude (rad), WGS84. */
export function geodeticFromGeocentric(phiGc: number): number {
  if (Math.abs(Math.abs(phiGc) - Math.PI / 2) < 1e-12) return phiGc;
  return Math.atan(Math.tan(phiGc) / (1 - WGS84_E2));
}

function trimFixed(v: number, decimals: number): string {
  const s = v.toFixed(decimals);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/**
 * earth-walker URL for a spot: "?from=cosmoscope[&hour=h]#lat,lon,height,heading".
 * The hash matches earth-walker's formatPermalink (6-decimal lat/lon, integer heading).
 */
export function earthWalkerUrl(spot: EarthSpot, base: string = EARTH_WALKER_URL): string {
  const q = new URLSearchParams({ from: 'cosmoscope' });
  if (spot.solarHour !== null) q.set('hour', trimFixed(spot.solarHour, 2));
  // Normalise -0 and the +-180 seam the way earth-walker's parser accepts it.
  const lat = Math.max(-90, Math.min(90, spot.lat));
  const lon = spot.lon <= -180 ? 180 : spot.lon;
  const heading = Math.round(wrap360(spot.headingDeg)) % 360;
  const hash = `${trimFixed(lat, 6)},${trimFixed(lon, 6)},${LANDING_HEIGHT_M},${heading}`;
  return `${base}?${q.toString()}#${hash.replace(/-0(?=,|$)/g, '0')}`;
}

// ---- trigger logic --------------------------------------------------------------

export interface HandoffTrigger {
  /** Call every frame with the camera's distance to Earth's centre, in rendered Earth radii. */
  update(distanceR: number): { showButton: boolean; fire: boolean };
  /** Report zoom-in input (positive notches = IN). Zoom-out input clears pending push. */
  zoomInput(notchesIn: number): void;
  /** Re-arm after a cancelled handoff. */
  reset(): void;
}

/**
 * Auto-trigger only on CONTINUED zoom-in at the floor: the camera must be in
 * the push zone (<= 1.25 R, just above the 1.05 R zoom floor) AND the user must
 * keep zooming in for >= 3 notches there. Normal fly-to framing (9 R), orbiting
 * at the floor, or a deep link to Earth never fires it.
 */
export function createHandoffTrigger(opts: Partial<typeof HANDOFF> = {}): HandoffTrigger {
  const o = { ...HANDOFF, ...opts };
  let dist = Infinity;
  let pushed = 0;
  let fired = false;
  return {
    update(distanceR: number) {
      dist = distanceR;
      if (!(distanceR <= o.resetR)) pushed = 0;
      const fire = !fired && distanceR <= o.pushZoneR && pushed >= o.pushNotches;
      if (fire) fired = true;
      return { showButton: distanceR <= o.showButtonR, fire };
    },
    zoomInput(notchesIn: number) {
      if (!Number.isFinite(notchesIn) || notchesIn === 0) return;
      if (notchesIn < 0) { pushed = 0; return; }
      if (dist <= o.pushZoneR) pushed += notchesIn;
    },
    reset() { pushed = 0; fired = false; },
  };
}

function wrap2pi(a: number): number { const t = 2 * Math.PI; return ((a % t) + t) % t; }
function wrap360(d: number): number { return ((d % 360) + 360) % 360; }
function wrap24(h: number): number { return ((h % 24) + 24) % 24; }
/** Wrap to (-180, 180]. */
function wrap180(d: number): number { const w = wrap360(d); return w > 180 ? w - 360 : w; }
