import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PROC_FULL_PX,
  PROC_MIN_PX,
  UNPROFILED_MAX_PX,
  apparentPx,
  glowStyle,
  proceduralFade,
  proceduralPointSize,
} from '../../src/layers/galaxyBlend';
import { applyProceduralFade, fadeMat } from '../../src/ui/proceduralGalaxies';

describe('galaxyBlend (Lumi P0: no glow + dot blobs)', () => {
  it('apparentPx is diameter / distance over the fov, in viewport px', () => {
    expect(apparentPx(1, 10, 0.5, 800)).toBeCloseTo(160);
    expect(apparentPx(1, 0, 0.5, 800)).toBe(0);
  });

  it('unprofiled galaxies and clusters are a subtle point at every size', () => {
    for (const px of [0.5, 3, 40, 300, 5000]) {
      const s = glowStyle(px, false);
      expect(s.px).toBeLessThanOrEqual(UNPROFILED_MAX_PX);
      expect(s.alpha).toBeLessThan(1);
    }
  });

  it('profiled: full glow while the mesh is hidden, faint halo once it is in', () => {
    expect(glowStyle(10, true)).toEqual({ px: 10, alpha: 1 });
    const big = glowStyle(500, true);
    expect(big.px).toBeCloseTo(150);
    expect(big.alpha).toBeLessThan(0.5);
  });

  it('procedural mesh fades in between PROC_MIN_PX and PROC_FULL_PX', () => {
    expect(proceduralFade(PROC_MIN_PX - 1)).toBe(0);
    expect(proceduralFade((PROC_MIN_PX + PROC_FULL_PX) / 2)).toBeCloseTo(0.5);
    expect(proceduralFade(PROC_FULL_PX + 1)).toBe(1);
  });

  it('small galaxies get small stars, never fat dots', () => {
    expect(proceduralPointSize(5, 24)).toBe(1);
    expect(proceduralPointSize(5, 48)).toBe(2);
    expect(proceduralPointSize(3, 500)).toBe(3);
  });

  it('applyProceduralFade does not shrink sizes frame over frame and follows LOD resets', () => {
    const mat = new THREE.PointsMaterial({ size: 3.5, opacity: 0.6 });
    const m = [fadeMat(mat)];
    for (let i = 0; i < 5; i++) applyProceduralFade(m, 48);
    expect(mat.size).toBe(2);
    expect(mat.opacity).toBeCloseTo(0.3);
    applyProceduralFade(m, 400);
    expect(mat.size).toBe(3.5);
    expect(mat.opacity).toBeCloseTo(0.6);
    mat.size = 5; // generator setLODTier reset
    applyProceduralFade(m, 48);
    expect(mat.size).toBe(2);
    applyProceduralFade(m, 400);
    expect(mat.size).toBe(5);
  });
});
