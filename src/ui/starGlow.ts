// Focus-star glow (Lumi, v1.1). The HYG star field is fixed-size points (and
// leaves the Sun out), so a star stop at ~15 solar radii showed an empty
// centre (Nova: Grand Tour Sun / Rigil Kentaurus at 0.07 AU). This draws the
// focused star as a disc + glow at its true angular size, with a small pixel
// floor, and fades out with distance so the point field takes over.
import * as THREE from 'three';
import type { CosmoCamera } from '../core/camera';
import type { FrameId } from '../core/frames';

const SOLAR_RADIUS_M = 6.957e8;
const AU = 1.495978707e11;
/** Fully visible inside this distance from the star... */
export const GLOW_FULL_M = 200 * AU;
/** ...and gone past this one (the point field draws it from there). */
export const GLOW_GONE_M = 2000 * AU;
/** Smallest on-screen diameter, px, so a distant focus star still reads. */
const MIN_PX = 14;
/** Fraction of the sprite's half-width that is solid disc (the rest is glow). */
const CORE = 0.4;

/** Opacity for a camera at distM metres from the focus star (1 near, 0 far). */
export function glowOpacity(distM: number): number {
  if (!(distM >= 0)) return 0;
  if (distM <= GLOW_FULL_M) return 1;
  if (distM >= GLOW_GONE_M) return 0;
  const t = Math.log(distM / GLOW_FULL_M) / Math.log(GLOW_GONE_M / GLOW_FULL_M);
  return 1 - t;
}

/**
 * Sprite diameter in metres at distM: true disc (radius rM) scaled so the
 * disc fills CORE of the sprite, but never under MIN_PX on a viewport
 * viewportPx tall with vertical FOV fovDeg.
 */
export function glowDiameterM(distM: number, rM: number, fovDeg: number, viewportPx: number): number {
  const trueD = (2 * rM) / CORE;
  const mPerPx = (2 * distM * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportPx);
  return Math.max(trueD, MIN_PX * mPerPx);
}

function makeTexture(): THREE.Texture {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(CORE * 0.85, 'rgba(255,255,255,1)');
  grad.addColorStop(CORE, 'rgba(255,255,255,0.75)');
  grad.addColorStop(CORE + 0.12, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface FocusStar {
  frame: FrameId;
  position: ArrayLike<number>;
  /** Star radius, metres (default: 1 solar radius). */
  radiusM?: number;
  color?: THREE.ColorRepresentation;
}

export interface StarGlow {
  /** Star to draw, or null to hide (e.g. focus moved to a planet or galaxy). */
  setFocus(star: FocusStar | null): void;
  update(): void;
  dispose(): void;
}

export function createStarGlow(scene: THREE.Scene, camera: CosmoCamera): StarGlow {
  const material = new THREE.SpriteMaterial({
    map: makeTexture(),
    color: 0xfff2d6,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'lumi-focus-star-glow';
  sprite.frustumCulled = false;
  sprite.renderOrder = 10;
  sprite.visible = false;
  scene.add(sprite);
  let focus: FocusStar | null = null;
  const pos = new Float64Array(3);
  const v = new THREE.Vector3();

  return {
    setFocus(star) {
      focus = star;
      if (star) {
        pos[0] = star.position[0]; pos[1] = star.position[1]; pos[2] = star.position[2];
        material.color.set(star.color ?? 0xfff2d6);
      }
    },
    update() {
      if (!focus) { sprite.visible = false; return; }
      const distM = camera.distanceTo({ frame: focus.frame, position: pos });
      const a = glowOpacity(distM);
      if (a <= 0) { sprite.visible = false; return; }
      camera.toCameraRelative(pos, focus.frame, v);
      sprite.position.copy(v);
      const dM = glowDiameterM(distM, focus.radiusM ?? SOLAR_RADIUS_M, camera.three.fov, innerHeight);
      const s = dM / camera.renderScale;
      sprite.scale.set(s, s, 1);
      material.opacity = a;
      sprite.visible = true;
    },
    dispose() {
      sprite.removeFromParent();
      material.map?.dispose();
      material.dispose();
    },
  };
}
