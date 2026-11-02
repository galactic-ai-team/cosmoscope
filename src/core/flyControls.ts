// src/core/flyControls.ts � free-fly mode (owner: Claude).
//
// Spaceship-style flight through the whole universe, not tied to orbiting a
// target. Works on top of FrameApi exactly like CosmoControls does: the real
// pose lives in float64 in the camera, so flying from a planet's surface to a
// galaxy cluster stays precise, and Lumi's automatic frame switches keep
// running underneath.
//
//   Desktop: W/S forward/back, A/D strafe, E/Q up/down, Z/X roll,
//            arrow keys turn (for keyboard-only use), mouse look (click the
//            view to lock the pointer, or drag), Shift = boost,
//            scroll wheel = speed trim.
//   Touch:   left half of the screen is a move stick, right half drags to look.
//            UI buttons can call adjustSpeed().
//
// Speed scales with distance: a fraction of the distance to the nearest
// body's SURFACE per second, so you creep near a planet and cross between
// galaxies in seconds. The curve is injectable (Dee's speedForDistance from
// the LOD work plugs straight in). You can't fly into a body: its radius
// (times clearanceFactor) is a minimum distance, the inward part of your
// velocity is dropped, and no single frame moves more than half the gap to
// the nearest surface, so nothing can tunnel through.
//
// For LOD (Dee): getVelocity()/speed report how fast and which way you're
// going, so tiers ahead of you can be biased up.
//
// main.ts wiring (sketch):
//   const fly = new CosmoFlyControls(camera, { reducedMotion, nearestBody });
//   fly.attach(renderer.domElement);
//   F key / button: fly.enabled ? fly.stop() : (flight.cancelFlight(), fly.start());
//   per frame: controls.enabled = !flight.active && !fly.enabled; fly.update(dt);
//   frame switch: pass fly.frameHint() ?? camera's target frame to chooseFrame,
//   so flying into the solar system drops back into 'helio'.

import type { FrameApi, FramedPoint } from './camera';
import type { FrameId } from './frames';

/** Key that main.ts can use to toggle free-fly (not handled here). */
export const FLY_TOGGLE_CODE = 'KeyF';

export interface NearestBody {
  /** The body's centre. */
  point: FramedPoint;
  /** Its radius in metres (0 for points such as stars without a size). */
  radius: number;
}

export interface FlyOptions {
  /** Nearest body to the camera right now, for speed scaling and no-fly-into. */
  nearestBody?: () => NearestBody | null;
  /** Cruise speed (m/s) at a given distance to the nearest surface (m). */
  speedForDistance?: (metres: number) => number;
  /** Shift multiplier. Default 8. */
  boost?: number;
  /** Radians per pixel of mouse/touch look. Default 0.0025. */
  lookSensitivity?: number;
  /** Roll rate for Z/X, rad/s. Default 1.2. */
  rollSpeed?: number;
  /** Turn rate for the arrow keys, rad/s. Default 1.0. */
  keyTurnSpeed?: number;
  /** Time constant (s) for speeding up and slowing down. Default 0.25. */
  accelTime?: number;
  /** prefers-reduced-motion: no easing, velocity follows input at once. */
  reducedMotion?: boolean;
  /** Speed floor and ceiling, m/s. */
  minSpeed?: number;
  maxSpeed?: number;
  /**
   * Stay at least this factor times a body's radius from its centre.
   * Default 1.002 (about 13 km above Earth, 140 km above Jupiter), low enough
   * for the earth-walker handoff to trigger before you're stopped.
   */
  clearanceFactor?: number;
}

/** Default curve: half the distance to the nearest surface per second, at least 2 m/s. */
export function defaultSpeedForDistance(metres: number): number {
  return Math.max(2, 0.5 * metres);
}

/** The slice of an element attach() needs (HTMLCanvasElement satisfies it). */
export interface FlyElement {
  addEventListener(type: string, listener: (e: any) => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: (e: any) => void, options?: EventListenerOptions | boolean): void;
  requestPointerLock?(): unknown;
  ownerDocument?: (FlyKeyTarget & { pointerLockElement?: unknown; exitPointerLock?(): void }) | null;
  clientWidth?: number;
  getBoundingClientRect?(): { left: number; width: number };
}
interface FlyKeyTarget {
  addEventListener(type: string, listener: (e: any) => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: (e: any) => void, options?: EventListenerOptions | boolean): void;
}

const MOVE_CODES = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyE', 'KeyQ', 'KeyZ', 'KeyX',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space',
]);
const STICK_RADIUS_PX = 60;
const TOUCH_LOOK_GAIN = 1.5;
const SPEED_TRIM_MIN = 1e-3;
const SPEED_TRIM_MAX = 1e3;

export class CosmoFlyControls {
  private active = false;

  private readonly fwd = new Float64Array([0, 1, 0]);
  private readonly up = new Float64Array([0, 0, 1]);
  private readonly vel = new Float64Array(3); // m/s, ICRS axes
  private speedTrim = 1;

  private readonly keys = new Set<string>();
  private lookX = 0; // pending look, pixels
  private lookY = 0;
  private stickX = 0; // touch stick, -1..1 (right +)
  private stickY = 0; // -1..1 (forward +)

  private readonly opts: Required<Omit<FlyOptions, 'nearestBody'>> & Pick<FlyOptions, 'nearestBody'>;
  private readonly inputListeners = new Set<() => void>();
  private detach: (() => void) | null = null;
  private lastNearest: NearestBody | null = null;

  // Scratch (no allocation in update()).
  private readonly pos = new Float64Array(3);
  private readonly tgt = new Float64Array(3);
  private readonly ctr = new Float64Array(3);
  private readonly tmp = new Float64Array(3);

  constructor(
    private readonly camera: FrameApi,
    opts: FlyOptions = {},
  ) {
    this.opts = {
      nearestBody: opts.nearestBody,
      speedForDistance: opts.speedForDistance ?? defaultSpeedForDistance,
      boost: opts.boost ?? 8,
      lookSensitivity: opts.lookSensitivity ?? 0.0025,
      rollSpeed: opts.rollSpeed ?? 1.2,
      keyTurnSpeed: opts.keyTurnSpeed ?? 1.0,
      accelTime: opts.reducedMotion ? 0 : (opts.accelTime ?? 0.25),
      reducedMotion: opts.reducedMotion ?? false,
      minSpeed: opts.minSpeed ?? 0.5,
      maxSpeed: opts.maxSpeed ?? 1e26,
      clearanceFactor: opts.clearanceFactor ?? 1.002,
    };
  }

  // ---- mode ---------------------------------------------------------------------

  get enabled(): boolean {
    return this.active;
  }

  /** Enter free-fly, keeping exactly the current view (no jump). */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.camera.getCameraForward(this.fwd);
    this.camera.getCameraUp(this.up);
    orthonormalize(this.fwd, this.up);
    this.vel.fill(0);
    this.lookX = this.lookY = this.stickX = this.stickY = 0;
  }

  /** Leave free-fly. The camera stays where it is, looking where it was looking. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.vel.fill(0);
    this.keys.clear();
    this.lookX = this.lookY = this.stickX = this.stickY = 0;
  }

  /** Called on every user input while flying (e.g. to cancel a flyTo). */
  onUserInput(listener: () => void): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  // ---- input (pure; the DOM layer and tests call these) ---------------------------

  /** Look by (dx, dy) pixels: right turns right, up looks up. */
  look(dxPixels: number, dyPixels: number): void {
    if (!this.active) return;
    this.lookX += dxPixels;
    this.lookY += dyPixels;
    this.touched();
  }

  /** Press or release a key by KeyboardEvent.code. Returns true if it's one of ours. */
  setKey(code: string, down: boolean): boolean {
    if (!MOVE_CODES.has(code)) return false;
    if (down && this.active) {
      this.keys.add(code);
      this.touched();
    } else {
      this.keys.delete(code);
    }
    return true;
  }

  /** Touch stick, each axis -1..1 (x right, y forward). */
  setStick(x: number, y: number): void {
    this.stickX = clamp(x, -1, 1);
    this.stickY = clamp(y, -1, 1);
    if (x !== 0 || y !== 0) this.touched();
  }

  /** Multiply cruise speed by 1.25^steps (positive = faster). Clamped to 1/1000..1000. */
  adjustSpeed(steps: number): void {
    this.speedTrim = clamp(this.speedTrim * 1.25 ** steps, SPEED_TRIM_MIN, SPEED_TRIM_MAX);
    this.touched();
  }

  get speedMultiplier(): number {
    return this.speedTrim;
  }

  // ---- outputs ----------------------------------------------------------------------

  /** Current velocity in m/s along the shared ICRS axes. */
  getVelocity(out: Float64Array = new Float64Array(3)): Float64Array {
    out[0] = this.vel[0];
    out[1] = this.vel[1];
    out[2] = this.vel[2];
    return out;
  }

  /** Current speed, m/s. */
  get speed(): number {
    return Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
  }

  /** Frame of the nearest body last frame, for chooseFrame's target-frame argument. */
  frameHint(): FrameId | null {
    return this.lastNearest?.point.frame ?? null;
  }

  // ---- per frame ----------------------------------------------------------------------

  update(dt: number): void {
    if (!this.active) return;
    dt = Math.max(0, dt);
    const o = this.opts;
    const f = this.fwd;
    const u = this.up;

    // 1. Orientation: mouse/touch look, arrow keys, roll.
    let yaw = -this.lookX * o.lookSensitivity;
    let pitch = -this.lookY * o.lookSensitivity;
    this.lookX = this.lookY = 0;
    const k = this.keys;
    if (k.has('ArrowLeft')) yaw += o.keyTurnSpeed * dt;
    if (k.has('ArrowRight')) yaw -= o.keyTurnSpeed * dt;
    if (k.has('ArrowUp')) pitch += o.keyTurnSpeed * dt;
    if (k.has('ArrowDown')) pitch -= o.keyTurnSpeed * dt;
    let roll = 0;
    if (k.has('KeyZ')) roll -= o.rollSpeed * dt;
    if (k.has('KeyX')) roll += o.rollSpeed * dt;

    if (yaw !== 0) {
      rodrigues(f, u, yaw); // about up: positive turns left
    }
    if (pitch !== 0) {
      const r = cross(f, u, this.tmp); // right
      normalize(r);
      rodrigues(f, r, pitch); // about right: positive looks up
      rodrigues(u, r, pitch);
    }
    if (roll !== 0) {
      rodrigues(u, f, roll); // about forward: positive rolls right
    }
    orthonormalize(f, u);

    // 2. Speed from distance to the nearest surface.
    const frame = this.camera.getFrameId();
    const unit = this.camera.unitsPerFrame(frame);
    const nearest = o.nearestBody?.() ?? null;
    this.lastNearest = nearest;
    let surface: number;
    if (nearest) {
      surface = Math.max(1, this.camera.distanceTo(nearest.point) - nearest.radius);
    } else {
      surface = Math.max(1, this.camera.getCameraDistanceToOrigin());
    }
    const boosted = k.has('ShiftLeft') || k.has('ShiftRight');
    const cruise = clamp(o.speedForDistance(surface) * this.speedTrim * (boosted ? o.boost : 1), o.minSpeed, o.maxSpeed);

    // 3. Thrust direction in camera axes, then ease the velocity toward it.
    let thrustF = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) + this.stickY;
    let thrustR = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.stickX;
    let thrustU = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const mag = Math.hypot(thrustF, thrustR, thrustU);
    if (mag > 1) {
      thrustF /= mag;
      thrustR /= mag;
      thrustU /= mag;
    }
    const r = cross(f, u, this.tmp);
    normalize(r);
    const ease = o.accelTime <= 0 ? 1 : 1 - Math.exp(-dt / o.accelTime);
    for (let i = 0; i < 3; i++) {
      const want = (f[i] * thrustF + r[i] * thrustR + u[i] * thrustU) * cruise;
      this.vel[i] += (want - this.vel[i]) * ease;
    }
    // Speed limits apply to the eased velocity too (a big drop in cruise speed
    // near a planet must take effect now, not after the easing catches up).
    const v = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
    if (v > cruise) for (let i = 0; i < 3; i++) this.vel[i] *= cruise / v;
    if (mag === 0 && v < 1e-9 * cruise) this.vel.fill(0);

    // 4. Move, in the camera frame's units. One frame never covers more than
    //    half the gap to the nearest surface, so a long frame or a huge boost
    //    can't tunnel through a planet (and at 60 fps that cap is 30x the gap
    //    per second, far above normal cruise speeds).
    const p = this.camera.getCameraWorldPosition(frame, this.pos);
    const stepM = Math.hypot(this.vel[0], this.vel[1], this.vel[2]) * dt;
    const stepScale = stepM > 0.5 * surface ? (0.5 * surface) / stepM : 1;
    for (let i = 0; i < 3; i++) p[i] += (this.vel[i] * dt * stepScale) / unit;

    // 5. Never inside a body: push back out and drop the inward velocity.
    if (nearest && nearest.radius > 0) {
      const c = this.camera.toFrame(nearest.point.position, nearest.point.frame, frame, this.ctr);
      const dx = p[0] - c[0];
      const dy = p[1] - c[1];
      const dz = p[2] - c[2];
      const dist = Math.hypot(dx, dy, dz) * unit;
      const minR = nearest.radius * o.clearanceFactor;
      if (dist < minR && dist > 0) {
        const s = minR / dist;
        p[0] = c[0] + dx * s;
        p[1] = c[1] + dy * s;
        p[2] = c[2] + dz * s;
        const inv = 1 / (dist / unit);
        const nx = dx * inv;
        const ny = dy * inv;
        const nz = dz * inv;
        const vn = this.vel[0] * nx + this.vel[1] * ny + this.vel[2] * nz;
        if (vn < 0) {
          this.vel[0] -= nx * vn;
          this.vel[1] -= ny * vn;
          this.vel[2] -= nz * vn;
        }
      }
    }

    // 6. Hand the pose to the camera. The look-at point sits ahead at the
    //    nearest-surface distance, so the render scale follows what's near.
    const ahead = surface / unit;
    const t = this.tgt;
    for (let i = 0; i < 3; i++) t[i] = p[i] + f[i] * ahead;
    this.camera.setPose({ frame, position: p, target: { frame, position: t }, up: u });
  }

  // ---- DOM ------------------------------------------------------------------------

  /** Bind keys (document-level), mouse look, wheel speed trim and touch stick/look. */
  attach(el: FlyElement): () => void {
    this.detach?.();
    const doc = el.ownerDocument ?? null;
    const keyTarget: FlyKeyTarget = doc ?? el;
    const pointers = new Map<number, { role: 'stick' | 'look'; x0: number; y0: number; x: number; y: number }>();
    let dragging: { x: number; y: number } | null = null;

    const width = (): number => el.getBoundingClientRect?.().width ?? el.clientWidth ?? 0;
    const left = (): number => el.getBoundingClientRect?.().left ?? 0;
    const locked = (): boolean => !!doc && doc.pointerLockElement === el;

    const onKeyDown = (e: KeyboardEvent): void => {
      // No defaultPrevented check on purpose: the orbit controls (disabled while
      // flying) still preventDefault the arrow keys before this listener runs.
      if (!this.active || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (this.setKey(e.code, true)) e.preventDefault?.();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      this.setKey(e.code, false);
    };
    const onBlur = (): void => {
      this.keys.clear();
      this.setStick(0, 0);
    };
    const onDown = (e: PointerEvent): void => {
      if (!this.active) return;
      if (e.pointerType === 'touch') {
        const role = e.clientX - left() < width() / 2 ? 'stick' : 'look';
        pointers.set(e.pointerId, { role, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
      } else {
        if (!locked()) el.requestPointerLock?.();
        dragging = { x: e.clientX, y: e.clientY };
      }
      this.touched();
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.active) return;
      if (e.pointerType === 'touch') {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        if (p.role === 'stick') {
          this.setStick((e.clientX - p.x0) / STICK_RADIUS_PX, -(e.clientY - p.y0) / STICK_RADIUS_PX);
        } else {
          this.look((e.clientX - p.x) * TOUCH_LOOK_GAIN, (e.clientY - p.y) * TOUCH_LOOK_GAIN);
        }
        p.x = e.clientX;
        p.y = e.clientY;
        return;
      }
      if (locked()) {
        this.look(e.movementX ?? 0, e.movementY ?? 0);
      } else if (dragging) {
        this.look(e.clientX - dragging.x, e.clientY - dragging.y);
        dragging = { x: e.clientX, y: e.clientY };
      }
    };
    const onUp = (e: PointerEvent): void => {
      const p = pointers.get(e.pointerId);
      if (p?.role === 'stick') this.setStick(0, 0);
      pointers.delete(e.pointerId);
      if (e.pointerType !== 'touch') dragging = null;
    };
    const onWheel = (e: WheelEvent): void => {
      if (!this.active) return;
      e.preventDefault?.();
      const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : e.deltaY / 100;
      this.adjustSpeed(-notches); // wheel up = faster
    };

    keyTarget.addEventListener('keydown', onKeyDown);
    keyTarget.addEventListener('keyup', onKeyUp);
    keyTarget.addEventListener('blur', onBlur);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    const detach = (): void => {
      keyTarget.removeEventListener('keydown', onKeyDown);
      keyTarget.removeEventListener('keyup', onKeyUp);
      keyTarget.removeEventListener('blur', onBlur);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      pointers.clear();
      if (this.detach === detach) this.detach = null;
    };
    this.detach = detach;
    return detach;
  }

  dispose(): void {
    this.detach?.();
    this.inputListeners.clear();
    this.stop();
  }

  private touched(): void {
    for (const l of this.inputListeners) l();
  }
}

// ---- small vector helpers (float64, in place) -------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function normalize(v: Float64Array): void {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len > 0) {
    v[0] /= len;
    v[1] /= len;
    v[2] /= len;
  }
}

function cross(a: Float64Array, b: Float64Array, out: Float64Array): Float64Array {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** Make f unit length and u a unit vector perpendicular to it (fixing degenerate up). */
function orthonormalize(f: Float64Array, u: Float64Array): void {
  normalize(f);
  const d = f[0] * u[0] + f[1] * u[1] + f[2] * u[2];
  u[0] -= f[0] * d;
  u[1] -= f[1] * d;
  u[2] -= f[2] * d;
  if (Math.hypot(u[0], u[1], u[2]) < 1e-9) {
    // Up was parallel to forward: pick any perpendicular.
    const helper = Math.abs(f[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    u[0] = helper[0] - f[0] * (f[0] * helper[0] + f[1] * helper[1] + f[2] * helper[2]);
    u[1] = helper[1] - f[1] * (f[0] * helper[0] + f[1] * helper[1] + f[2] * helper[2]);
    u[2] = helper[2] - f[2] * (f[0] * helper[0] + f[1] * helper[1] + f[2] * helper[2]);
  }
  normalize(u);
}

/** Rotate v in place about unit axis k by angle a (Rodrigues' formula). */
function rodrigues(v: Float64Array, k: Float64Array, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * dot * (1 - c);
  const y = v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * dot * (1 - c);
  const z = v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * dot * (1 - c);
  v[0] = x;
  v[1] = y;
  v[2] = z;
}

/** True when a key event comes from a text field or editable element. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return typeof el.tagName === 'string' && /^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName);
}