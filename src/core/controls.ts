// src/core/controls.ts — Cosmoscope camera controls v0 (owner: Claude).
//
// Replaces three's OrbitControls, which can't work here: it moves the
// three.js camera, and the core pins that puppet at the render origin.
// CosmoControls turns drag / wheel / pinch / keys into float64 moves of the
// real pose (FrameApi), orbiting the current target.
//
//   - Orbit: drag (or arrow keys) rotates the camera around its target,
//     about the `up` axis, with the polar angle clamped so it never flips
//     over a pole.
//   - Zoom: wheel / pinch / +/- multiply the distance to the target, so one
//     notch is the same RELATIVE zoom at 1 m and at 1e26 m.
//   - Damping: input accumulates and eases in over ~0.1 s; reducedMotion
//     applies it immediately.
//   - No target, no orbit: controls do nothing until something is targeted.
//
// main.ts wiring:
//   const controls = new CosmoControls(camera, { reducedMotion });
//   controls.attach(renderer.domElement);
//   controls.onUserInput(() => {                 // grabbing cancels a flight
//     if (flight.flying) {
//       flight.cancelFlight();
//       controls.enabled = true;                 // so this same input applies
//     }
//   });
//   // per frame, after flight.update(dt) and before camera.update():
//   controls.enabled = !flight.flying;
//   controls.update(dt);
//
// Input math is in plain methods (rotate, zoom, pinch) so it is testable
// without a DOM; attach() only maps events onto them.

import type { FrameApi } from './camera';

export interface ControlsOptions {
  /** Orbit axis in the shared ICRS axes. Default: north celestial pole. Use ECLIPTIC_NORTH for solar-system views. */
  up?: ArrayLike<number>;
  /** Radians per pixel of drag. */
  rotateSpeed?: number;
  /** Natural-log zoom per wheel notch (0.15 is ~16% per notch). */
  zoomStep?: number;
  /** Closest approach to the target, meters. */
  minDistance?: number;
  /** Farthest distance from the target, meters. */
  maxDistance?: number;
  /** Easing time constant in seconds. */
  damping?: number;
  /** prefers-reduced-motion: no easing, input applies at once. */
  reducedMotion?: boolean;
}

/** The slice of an element attach() needs (HTMLElement satisfies it). */
export interface ControlsElement {
  addEventListener(type: string, listener: (e: any) => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: (e: any) => void, options?: EventListenerOptions | boolean): void;
  setPointerCapture?(id: number): void;
  releasePointerCapture?(id: number): void;
  tabIndex?: number;
}

const POLE_MARGIN = 1e-3; // radians kept clear of each pole
const KEY_ROTATE = 0.05; // radians per arrow press
const KEY_ZOOM = 1; // wheel notches per +/- press
const WHEEL_NOTCH = 100; // deltaY pixels per notch (DOM_DELTA_PIXEL)

export class CosmoControls {
  enabled = true;

  private readonly up = new Float64Array([0, 0, 1]);
  private readonly rotateSpeed: number;
  private readonly zoomStep: number;
  private readonly minDistance: number;
  private readonly maxDistance: number;
  private readonly damping: number;

  // Pending input, eased in by update().
  private pendingYaw = 0;
  private pendingPitch = 0;
  private pendingLogZoom = 0;

  private readonly inputListeners = new Set<() => void>();
  private detach: (() => void) | null = null;

  // Scratch (no allocation in update()).
  private readonly cam = new Float64Array(3);
  private readonly tgt = new Float64Array(3);
  private readonly off = new Float64Array(3);
  private readonly axis = new Float64Array(3);

  constructor(
    private readonly camera: FrameApi,
    opts: ControlsOptions = {},
  ) {
    if (opts.up) this.setUp(opts.up);
    this.rotateSpeed = opts.rotateSpeed ?? 0.005;
    this.zoomStep = opts.zoomStep ?? 0.15;
    this.minDistance = opts.minDistance ?? 1;
    this.maxDistance = opts.maxDistance ?? 1e27;
    this.damping = opts.reducedMotion ? 0 : (opts.damping ?? 0.08);
  }

  setUp(up: ArrayLike<number>): void {
    const len = Math.hypot(up[0], up[1], up[2]);
    if (len === 0) return;
    this.up[0] = up[0] / len;
    this.up[1] = up[1] / len;
    this.up[2] = up[2] / len;
  }

  /**
   * Called on every user input (press, drag, wheel, pinch, key), INCLUDING
   * while disabled, and BEFORE the enabled check. So a listener can cancel a
   * flight and set `enabled = true`, and the very input that grabbed the
   * camera is applied instead of dropped.
   */
  onUserInput(listener: () => void): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  // ---- input (pure; the DOM layer and tests call these) --------------------

  /**
   * Drag by (dx, dy) pixels, OrbitControls-style: dragging right swings the
   * camera so the scene follows the pointer; dragging down raises the camera
   * toward `up` (looking down on the target).
   */
  rotate(dxPixels: number, dyPixels: number): void {
    this.touched();
    if (!this.enabled) return;
    this.pendingYaw -= dxPixels * this.rotateSpeed;
    this.pendingPitch += dyPixels * this.rotateSpeed;
  }

  /** Zoom by wheel notches: positive = out, negative = in. */
  zoom(notches: number): void {
    this.touched();
    if (!this.enabled) return;
    this.pendingLogZoom += notches * this.zoomStep;
  }

  /** Pinch: ratio = previous finger spread / new spread (>1 zooms out). */
  pinch(ratio: number): void {
    if (!(ratio > 0)) return;
    this.touched();
    if (!this.enabled) return;
    this.pendingLogZoom += Math.log(ratio);
  }

  /** Drop any eased-in input that hasn't been applied yet. */
  stop(): void {
    this.pendingYaw = 0;
    this.pendingPitch = 0;
    this.pendingLogZoom = 0;
  }

  // ---- per frame ------------------------------------------------------------

  update(dt: number): void {
    if (!this.enabled) {
      this.stop();
      return;
    }
    if (this.pendingYaw === 0 && this.pendingPitch === 0 && this.pendingLogZoom === 0) return;

    const k = this.damping <= 0 ? 1 : 1 - Math.exp(-Math.max(dt, 0) / this.damping);
    let yaw = this.pendingYaw * k;
    let pitch = this.pendingPitch * k;
    let logZoom = this.pendingLogZoom * k;
    this.pendingYaw -= yaw;
    this.pendingPitch -= pitch;
    this.pendingLogZoom -= logZoom;
    // Snap tiny remainders so update() goes idle.
    if (Math.abs(this.pendingYaw) < 1e-7) {
      yaw += this.pendingYaw;
      this.pendingYaw = 0;
    }
    if (Math.abs(this.pendingPitch) < 1e-7) {
      pitch += this.pendingPitch;
      this.pendingPitch = 0;
    }
    if (Math.abs(this.pendingLogZoom) < 1e-7) {
      logZoom += this.pendingLogZoom;
      this.pendingLogZoom = 0;
    }

    const frame = this.camera.getFrameId();
    if (this.camera.getTargetPosition(frame, this.tgt) === null) {
      this.stop();
      return;
    }
    this.camera.getCameraWorldPosition(frame, this.cam);
    const o = this.off;
    o[0] = this.cam[0] - this.tgt[0];
    o[1] = this.cam[1] - this.tgt[1];
    o[2] = this.cam[2] - this.tgt[2];
    const dist = Math.hypot(o[0], o[1], o[2]);
    if (dist === 0) return;

    // Yaw: rotate the offset about `up`.
    if (yaw !== 0) rodrigues(o, this.up, yaw);

    // Pitch: positive pitch lowers the polar angle (camera rises toward up).
    // Rotate about (up x offset), clamped away from both poles.
    if (pitch !== 0) {
      const u = this.up;
      const cosTheta = clamp((o[0] * u[0] + o[1] * u[1] + o[2] * u[2]) / dist, -1, 1);
      const theta = Math.acos(cosTheta);
      const next = clamp(theta - pitch, POLE_MARGIN, Math.PI - POLE_MARGIN);
      const applied = theta - next;
      const a = this.axis;
      a[0] = u[1] * o[2] - u[2] * o[1];
      a[1] = u[2] * o[0] - u[0] * o[2];
      a[2] = u[0] * o[1] - u[1] * o[0];
      const alen = Math.hypot(a[0], a[1], a[2]);
      if (alen > 0 && applied !== 0) {
        a[0] /= alen;
        a[1] /= alen;
        a[2] /= alen;
        // Rotating by -applied about (up x o) moves o toward up.
        rodrigues(o, a, -applied);
      }
    }

    // Zoom: scale the offset in log space, clamped in meters.
    const unit = this.camera.unitsPerFrame(frame);
    const meters = dist * unit;
    const nextMeters = clamp(meters * Math.exp(logZoom), this.minDistance, this.maxDistance);
    const s = nextMeters / meters;
    // rodrigues preserves length, so dist is still |o|.
    this.cam[0] = this.tgt[0] + o[0] * s;
    this.cam[1] = this.tgt[1] + o[1] * s;
    this.cam[2] = this.tgt[2] + o[2] * s;
    this.camera.setPose({ frame, position: this.cam, up: this.up });
  }

  // ---- DOM ------------------------------------------------------------------

  /** Bind pointer, wheel and keyboard input. Returns (and stores) a detach function. */
  attach(el: ControlsElement): () => void {
    this.detach?.();
    const pointers = new Map<number, { x: number; y: number }>();
    let lastSpread = 0;

    const spread = (): number => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };

    const onDown = (e: PointerEvent): void => {
      this.touched(); // a press alone counts as grabbing the camera
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture?.(e.pointerId);
      if (pointers.size === 2) lastSpread = spread();
    };
    const onMove = (e: PointerEvent): void => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 1) {
        this.rotate(dx, dy);
      } else if (pointers.size === 2) {
        const now = spread();
        if (lastSpread > 0 && now > 0) this.pinch(lastSpread / now);
        lastSpread = now;
      }
    };
    const onUp = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      el.releasePointerCapture?.(e.pointerId);
      lastSpread = pointers.size === 2 ? spread() : 0;
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault?.();
      // deltaMode 1 = lines, 2 = pages; normalize to notches.
      const scale = e.deltaMode === 1 ? 1 / 3 : e.deltaMode === 2 ? 1 : 1 / WHEEL_NOTCH;
      this.zoom(e.deltaY * scale);
    };
    const onKey = (e: KeyboardEvent): void => {
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':
          this.rotate(-KEY_ROTATE / this.rotateSpeed, 0);
          break;
        case 'ArrowRight':
          this.rotate(KEY_ROTATE / this.rotateSpeed, 0);
          break;
        case 'ArrowUp': // raise the camera
          this.rotate(0, KEY_ROTATE / this.rotateSpeed);
          break;
        case 'ArrowDown': // lower the camera
          this.rotate(0, -KEY_ROTATE / this.rotateSpeed);
          break;
        case '+':
        case '=':
        case 'PageUp':
          this.zoom(-KEY_ZOOM);
          break;
        case '-':
        case '_':
        case 'PageDown':
          this.zoom(KEY_ZOOM);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault?.();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKey);
    if (typeof el.tabIndex === 'number' && el.tabIndex < 0) el.tabIndex = 0; // focusable for keys

    const detach = (): void => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
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

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
