// src/core/frames.ts — Cosmoscope frame API v0 (owner: Claude).
//
// A frame is a named coordinate system: an origin plus a unit. Every
// position in Cosmoscope is a float64 triple tagged with the frame it is
// expressed in. Nothing here touches three.js or the GPU.
//
// v0 conventions (change only by team agreement):
//   - Axes: all frames share ONE orientation, ICRS equatorial (J2000):
//     +x toward the vernal equinox, +z toward the north celestial pole.
//     HYG, Gaia and RA/Dec galaxy catalogs are native to this; ask JPL
//     Horizons for ICRF vectors. Frames differ only by origin and unit.
//   - Origins are stored in ROOT meters (root = 'cosmic'). Defaults put
//     every origin at the Sun. 'planet' is meant to follow a body (the
//     solar-system lane moves it to Earth, etc.) via setOrigin().
//   - Precision comes from float64 + camera-relative rendering (camera.ts),
//     not from units. Units exist so layer data stays human-sized
//     (km, AU, pc, Mpc) and so shaders see numbers near 1.

export type FrameId = 'planet' | 'helio' | 'galactic' | 'cosmic';

/** Innermost to outermost; also the natural zoom-out order. */
export const FRAME_ORDER: readonly FrameId[] = ['planet', 'helio', 'galactic', 'cosmic'];

export const METERS = {
  km: 1e3,
  au: 1.495978707e11, // IAU 2012, exact
  pc: 3.0856775814913673e16,
  mpc: 3.0856775814913673e22,
} as const;

/** Obliquity of the ecliptic at J2000 (radians), IAU 2006. */
export const OBLIQUITY_J2000 = (84381.406 / 3600) * (Math.PI / 180);
/** Ecliptic north pole as a unit vector in the shared ICRS axes. */
export const ECLIPTIC_NORTH: readonly [number, number, number] = [
  0,
  -Math.sin(OBLIQUITY_J2000),
  Math.cos(OBLIQUITY_J2000),
];

export interface FrameInfo {
  readonly id: FrameId;
  readonly parent: FrameId | null;
  /** Meters per unit of this frame. */
  readonly unitMeters: number;
  /** Origin in root (cosmic) meters. Read-only view; use setOrigin(). */
  readonly origin: Readonly<Float64Array>;
}

/** Any 3-element float64 position: [x, y, z]. */
export type Vec3Like = ArrayLike<number>;

export type OriginChangeListener = (id: FrameId) => void;

interface MutableFrame {
  id: FrameId;
  parent: FrameId | null;
  unitMeters: number;
  origin: Float64Array;
}

const DEFS: ReadonlyArray<Omit<MutableFrame, 'origin'>> = [
  { id: 'planet', parent: 'helio', unitMeters: METERS.km },
  { id: 'helio', parent: 'galactic', unitMeters: METERS.au },
  { id: 'galactic', parent: 'cosmic', unitMeters: METERS.pc },
  { id: 'cosmic', parent: null, unitMeters: METERS.mpc },
];

export class FrameStack {
  private readonly frames = new Map<FrameId, MutableFrame>();
  private readonly listeners = new Set<OriginChangeListener>();
  // Scratch for toFrame; FrameStack is single-threaded.
  private readonly scratch = new Float64Array(3);

  constructor() {
    for (const d of DEFS) this.frames.set(d.id, { ...d, origin: new Float64Array(3) });
  }

  get(id: FrameId): FrameInfo {
    return this.frame(id);
  }

  /** Meters per unit of a frame (Dee's unitsPerFrame). */
  unitsPerFrame(id: FrameId): number {
    return this.frame(id).unitMeters;
  }

  /** Move a frame's origin (root meters). Fires origin-change listeners. */
  setOrigin(id: FrameId, rootMeters: Vec3Like): void {
    if (id === 'cosmic') throw new Error('frames: the root frame origin is fixed');
    const o = this.frame(id).origin;
    if (o[0] === rootMeters[0] && o[1] === rootMeters[1] && o[2] === rootMeters[2]) return;
    o[0] = rootMeters[0];
    o[1] = rootMeters[1];
    o[2] = rootMeters[2];
    for (const l of this.listeners) l(id);
  }

  /** Subscribe to origin moves. Returns an unsubscribe function. */
  onOriginChange(listener: OriginChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Position in `id` units -> root meters. */
  toRootMeters(pos: Vec3Like, id: FrameId, out = new Float64Array(3)): Float64Array {
    const f = this.frame(id);
    out[0] = f.origin[0] + pos[0] * f.unitMeters;
    out[1] = f.origin[1] + pos[1] * f.unitMeters;
    out[2] = f.origin[2] + pos[2] * f.unitMeters;
    return out;
  }

  /** Root meters -> position in `id` units. */
  fromRootMeters(m: Vec3Like, id: FrameId, out = new Float64Array(3)): Float64Array {
    const f = this.frame(id);
    out[0] = (m[0] - f.origin[0]) / f.unitMeters;
    out[1] = (m[1] - f.origin[1]) / f.unitMeters;
    out[2] = (m[2] - f.origin[2]) / f.unitMeters;
    return out;
  }

  /** Re-express a position from one frame in another. `out` may alias `pos`. */
  toFrame(pos: Vec3Like, from: FrameId, to: FrameId, out = new Float64Array(3)): Float64Array {
    if (from === to) {
      out[0] = pos[0];
      out[1] = pos[1];
      out[2] = pos[2];
      return out;
    }
    const a = this.frame(from);
    const b = this.frame(to);
    // Origin difference first, so two nearby origins far from the root
    // don't lose precision against each other.
    const s = this.scratch;
    s[0] = a.origin[0] - b.origin[0];
    s[1] = a.origin[1] - b.origin[1];
    s[2] = a.origin[2] - b.origin[2];
    const k = a.unitMeters / b.unitMeters;
    out[0] = s[0] / b.unitMeters + pos[0] * k;
    out[1] = s[1] / b.unitMeters + pos[1] * k;
    out[2] = s[2] / b.unitMeters + pos[2] * k;
    return out;
  }

  private frame(id: FrameId): MutableFrame {
    const f = this.frames.get(id);
    if (!f) throw new Error(`frames: unknown frame '${id}'`);
    return f;
  }
}