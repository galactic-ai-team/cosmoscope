// src/core/camera.ts — Cosmoscope camera core v0 (owner: Claude).
//
// The camera's true pose lives here in float64: a frame id plus a position
// in that frame's units. The three.js camera is a puppet that always sits
// at the render origin (0,0,0); every layer places its objects RELATIVE to
// the camera with toCameraRelative(), so the GPU only ever sees small
// float32 numbers no matter where in the universe you are.
//
// Render units: render space = camera-relative meters / renderScale.
// renderScale is a power of ten near the focus (target) distance, so the
// thing you are looking at sits 1–20 render units away. That keeps shader
// math sane (dot(p,p) of a raw 1e26 m vector overflows float32) and keeps
// point sizes and fresnel terms meaningful at every scale. When it changes,
// onRebase fires with reason 'scale'.
//
// Layer recipe, every frame (after camera.update()):
//   camera.toCameraRelative(myPos, 'helio', mesh.position);
//   mesh.scale.setScalar(camera.layerScale('helio')); // mesh authored in AU
//
// Depth: create the renderer with RENDERER_OPTIONS (logarithmic depth), or
// near/far spanning 1e-6..1e12 render units will z-fight.
//
// The camera never switches frames on its own. Pick the frame with
// setPose(); flyTo (Dee) decides when to hop between frames.

import * as THREE from 'three';

import { FrameStack, type FrameId, type Vec3Like } from './frames';

export const RENDERER_OPTIONS = { logarithmicDepthBuffer: true } as const;

export const NEAR_RENDER = 1e-6;
export const FAR_RENDER = 1e12;
/** Smallest renderScale in meters (1 mm), for standing-on-a-surface views. */
export const MIN_RENDER_SCALE = 1e-3;

export type RebaseReason = 'scale' | 'frame' | 'origin';
export interface RebaseEvent {
  reason: RebaseReason;
  frameId: FrameId;
  renderScale: number;
}
export type RebaseListener = (e: RebaseEvent) => void;

/**
 * The camera surface other lanes code against (flyTo, registry). Import this
 * type instead of redeclaring it, so the two sides can't drift apart.
 */
export interface FrameApi {
  getFrameId(): FrameId;
  getCameraWorldPosition(frameId?: FrameId, out?: Float64Array): Float64Array;
  setCameraWorldPosition(pos: Vec3Like, frameId?: FrameId): void;
  setCameraFrameAndPosition(frameId: FrameId, pos: Vec3Like): void;
  rebaseTo(frameId: FrameId): void;
  getCameraDistanceToOrigin(): number;
  unitsPerFrame(frameId: FrameId): number;
  toFrame(point: Vec3Like, from: FrameId, to: FrameId, out?: Float64Array): Float64Array;
  setPose(pose: Pose): void;
  lookAt(point: Vec3Like, frameId?: FrameId): void;
  distanceTo(point: FramedPoint): number;
  onRebase(listener: RebaseListener): () => void;
}

export interface FramedPoint {
  frame: FrameId;
  position: Vec3Like;
}

export interface Pose {
  /** Frame the camera lives in from now on. */
  frame: FrameId;
  /** Camera position in `frame` units. */
  position: Vec3Like;
  /** Where to look. Its frame may differ from the camera's. Omit to keep the current target. */
  target?: FramedPoint;
  /** Up vector in the shared ICRS axes. Omit to keep the current one. */
  up?: Vec3Like;
}

/**
 * Pick a power-of-ten renderScale for a focus distance (meters), keeping
 * the current one while distance/scale stays within [0.5, 20] (hysteresis,
 * so a camera hovering near a boundary doesn't rebase every frame).
 */
export function chooseRenderScale(distanceMeters: number, current: number): number {
  const d = Math.max(distanceMeters, MIN_RENDER_SCALE);
  const ratio = d / current;
  if (ratio >= 0.5 && ratio <= 20) return current;
  return Math.max(MIN_RENDER_SCALE, 10 ** Math.floor(Math.log10(d)));
}

export class CosmoCamera implements FrameApi {
  readonly three: THREE.PerspectiveCamera;

  private frameId: FrameId;
  private readonly pos = new Float64Array(3);
  private targetFrame: FrameId | null = null;
  private readonly targetPos = new Float64Array(3);
  private readonly up = new Float64Array([0, 0, 1]);
  private scale = 1;

  private readonly listeners = new Set<RebaseListener>();
  private readonly unsubscribeFrames: () => void;
  // Scratch (no per-frame allocation).
  private readonly s64 = new Float64Array(3);
  private readonly sVec = new THREE.Vector3();

  constructor(
    readonly frames: FrameStack,
    three: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(50, 1, NEAR_RENDER, FAR_RENDER),
    initialFrame: FrameId = 'helio',
  ) {
    this.three = three;
    this.three.near = NEAR_RENDER;
    this.three.far = FAR_RENDER;
    this.three.position.set(0, 0, 0);
    this.three.updateProjectionMatrix();
    this.frameId = initialFrame;
    this.unsubscribeFrames = frames.onOriginChange(() => {
      // Any origin move can shift camera-relative positions; let caches know.
      this.emit('origin');
    });
  }

  // ---- pose ----------------------------------------------------------------

  setPose(pose: Pose): void {
    const frameChanged = pose.frame !== this.frameId;
    this.frameId = pose.frame;
    copy3(pose.position, this.pos);
    if (pose.target) {
      this.targetFrame = pose.target.frame;
      copy3(pose.target.position, this.targetPos);
    }
    if (pose.up) {
      copy3(pose.up, this.up);
      normalize3(this.up);
    }
    if (frameChanged) this.emit('frame');
    this.refreshScale();
  }

  /**
   * Aim at a point; `point` is in `frameId` units (default: the camera's own
   * frame). Sets the target, so renderScale follows the new focus distance.
   * Cheap and allocation-free; safe to call every frame.
   */
  lookAt(point: Vec3Like, frameId: FrameId = this.frameId): void {
    this.targetFrame = frameId;
    copy3(point, this.targetPos);
    this.refreshScale();
  }
  getTarget(out: Float64Array = new Float64Array(3)): FramedPoint | null {
    if (this.targetFrame === null) return null;
    copy3(this.targetPos, out);
    return { frame: this.targetFrame, position: out };
  }

  // ---- Dee's getters (thin wrappers over the pose) -------------------------

  getFrameId(): FrameId {
    return this.frameId;
  }

  /** Camera position expressed in `frameId` units (default: its own frame). */
  getCameraWorldPosition(frameId: FrameId = this.frameId, out?: Float64Array): Float64Array {
    return this.frames.toFrame(this.pos, this.frameId, frameId, out ?? new Float64Array(3));
  }

  /** Move the camera; `pos` is in `frameId` units. The camera keeps its own frame. */
  setCameraWorldPosition(pos: Vec3Like, frameId: FrameId = this.frameId): void {
    this.frames.toFrame(pos, frameId, this.frameId, this.pos);
    this.refreshScale();
  }

  /** Meters per unit of a frame. */
  unitsPerFrame(frameId: FrameId): number {
    return this.frames.unitsPerFrame(frameId);
  }

  /**
   * Re-express any point from one frame in another (exact; frames.toFrame
   * under the hood). For a frame offset, pass [0, 0, 0]. `out` may alias
   * `point`; pass it to avoid allocating.
   */
  toFrame(point: Vec3Like, from: FrameId, to: FrameId, out?: Float64Array): Float64Array {
    return this.frames.toFrame(point, from, to, out ?? new Float64Array(3));
  }
  /**
   * Switch frames and set position in one call; `pos` is in `frameId` units.
   * Same as setPose({ frame, position }) with target and up unchanged.
   */
  setCameraFrameAndPosition(frameId: FrameId, pos: Vec3Like): void {
    this.setPose({ frame: frameId, position: pos });
  }

  /**
   * Re-express the camera in another frame without moving it. Exact, so
   * nothing on screen changes; no interpolation needed or wanted.
   */
  rebaseTo(frameId: FrameId): void {
    if (frameId === this.frameId) return;
    this.frames.toFrame(this.pos, this.frameId, frameId, this.s64);
    this.setPose({ frame: frameId, position: this.s64 });
  }

  /** Meters from the camera to the origin of the camera's CURRENT frame. */
  getCameraDistanceToOrigin(): number {
    return Math.hypot(this.pos[0], this.pos[1], this.pos[2]) * this.frames.unitsPerFrame(this.frameId);
  }

  // ---- rendering ----------------------------------------------------------

  /** Meters per render unit. */
  get renderScale(): number {
    return this.scale;
  }

  /** Scale to apply to a mesh authored in `frameId` units. */
  layerScale(frameId: FrameId): number {
    return this.frames.unitsPerFrame(frameId) / this.scale;
  }

  /**
   * Position (in `frameId` units) -> render space, written into `out`.
   * All the precision-critical subtraction happens here in float64.
   */
  toCameraRelative(pos: Vec3Like, frameId: FrameId, out: THREE.Vector3): THREE.Vector3 {
    const rel = this.relative(pos, frameId, this.s64);
    const k = this.frames.unitsPerFrame(this.frameId) / this.scale;
    return out.set(rel[0] * k, rel[1] * k, rel[2] * k);
  }

  /** Straight-line distance in meters from the camera to a point. */
  distanceTo(point: FramedPoint): number {
    const rel = this.relative(point.position, point.frame, this.s64);
    return Math.hypot(rel[0], rel[1], rel[2]) * this.frames.unitsPerFrame(this.frameId);
  }

  /** Sync the three.js puppet. Call once per frame, before layers update. */
  update(): void {
    const cam = this.three;
    cam.position.set(0, 0, 0);
    cam.up.set(this.up[0], this.up[1], this.up[2]);
    if (this.targetFrame !== null) {
      this.toCameraRelative(this.targetPos, this.targetFrame, this.sVec);
      if (this.sVec.lengthSq() > 0) cam.lookAt(this.sVec);
    }
    cam.updateMatrixWorld();
  }

  onRebase(listener: RebaseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.unsubscribeFrames();
    this.listeners.clear();
  }

  // ---- internals ------------------------------------------------------------

  /** (point - camera) in the CAMERA's frame units, float64. */
  private relative(pos: Vec3Like, frameId: FrameId, out: Float64Array): Float64Array {
    this.frames.toFrame(pos, frameId, this.frameId, out);
    out[0] -= this.pos[0];
    out[1] -= this.pos[1];
    out[2] -= this.pos[2];
    return out;
  }

  private refreshScale(): void {
    if (this.targetFrame === null) return;
    const d = this.distanceTo({ frame: this.targetFrame, position: this.targetPos });
    const next = chooseRenderScale(d, this.scale);
    if (next !== this.scale) {
      this.scale = next;
      this.emit('scale');
    }
  }

  private emit(reason: RebaseReason): void {
    const e: RebaseEvent = { reason, frameId: this.frameId, renderScale: this.scale };
    for (const l of this.listeners) l(e);
  }
}

function copy3(src: Vec3Like, dst: Float64Array): void {
  dst[0] = src[0];
  dst[1] = src[1];
  dst[2] = src[2];
}

function normalize3(v: Float64Array): void {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) {
    v[2] = 1;
    return;
  }
  v[0] /= len;
  v[1] /= len;
  v[2] /= len;
}