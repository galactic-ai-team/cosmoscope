import * as THREE from 'three';
import { METERS } from '../core/frames';

export interface GalaxyProfile {
  id: string;
  name: string;
  morphology: 'Sa' | 'Sb' | 'Sc' | 'SBb' | 'SBc' | 'E' | 'Irr' | 'dSph' | string;
  diameterLy: number;
  inclinationDeg: number;
  positionAngleDeg: number;
  armCount: number;
  pitchDeg: number;
  bulgeFraction: number;
  dustStrength: number;
  starCountNear: number;
  seed: number;
}

export interface GeneratedGalaxy {
  container: THREE.Group;
  setLODTier(tier: number): void;
  dispose(): void;
}

// Seeded PRNG (Mulberry32)
function createSeededRng(seed: number) {
  let t = seed += 0x6d2b79f5;
  return function () {
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Generate soft circular particle texture
function createParticleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(220,235,255,0.8)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface StarParticle {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  importance: number; // For sorting into LOD tiers
  isDust: boolean;
}

export function createProceduralGalaxy(profile: GalaxyProfile): GeneratedGalaxy {
  const container = new THREE.Group();
  container.name = `galaxy:${profile.id}`;

  const rng = createSeededRng(profile.seed);
  const radiusMeters = (profile.diameterLy / 2) * METERS.ly;

  const totalStars = Math.min(Math.max(profile.starCountNear, 1000), 15000);
  const stars: StarParticle[] = [];

  const isBarred = profile.morphology.startsWith('SB');
  const isElliptical = profile.morphology === 'E' || profile.morphology === 'dSph';
  const isIrregular = profile.morphology === 'Irr';

  const arms = profile.armCount > 0 ? profile.armCount : 2;
  const pitchRad = THREE.MathUtils.degToRad(profile.pitchDeg || 15);

  const coreColor = new THREE.Color(0xfff5e6); // Warm yellow-white bulge
  const armColor = new THREE.Color(0x88ccff);  // Young blue star clusters
  const dustColor = new THREE.Color(0x2a1a12); // Dark brown/red dust

  // 1. Generate Star & Dust Population
  for (let i = 0; i < totalStars; i++) {
    const isDust = i < totalStars * (profile.dustStrength * 0.15);
    const isBulge = !isIrregular && !isElliptical && (rng() < profile.bulgeFraction);

    let x = 0, y = 0, z = 0;
    let importance = rng();

    if (isElliptical || isIrregular) {
      const r = Math.pow(rng(), 0.6) * radiusMeters;
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos((rng() * 2) - 1);
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.sin(phi) * Math.sin(theta) * 0.5;
      z = r * Math.cos(phi) * (isElliptical ? 0.7 : 0.4);
    } else if (isBulge) {
      const r = Math.pow(rng(), 2) * (radiusMeters * profile.bulgeFraction);
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos((rng() * 2) - 1);
      
      // Barred spiral core elongation
      const barStretch = isBarred && rng() < 0.5 ? 2.5 : 1.0;
      x = r * Math.sin(phi) * Math.cos(theta) * barStretch;
      y = r * Math.sin(phi) * Math.sin(theta) * 0.4;
      z = r * Math.cos(phi) * 0.6;
      importance += 0.5; // Bulge/core stars are prominent
    } else {
      // Spiral disk & arms
      const r = Math.pow(rng(), 0.8) * radiusMeters;
      const armIdx = Math.floor(rng() * arms);
      const armOffsetAngle = (armIdx / arms) * Math.PI * 2;
      
      // Logarithmic spiral math
      const spiralAngle = (Math.log(Math.max(r, radiusMeters * 0.05) / (radiusMeters * 0.1)) / Math.tan(pitchRad)) + armOffsetAngle;
      
      let scatter = 0.12 * radiusMeters;
      if (isDust) {
        // Dust lanes ride the inner edge of spiral arms
        scatter *= 0.8;
      }

      const offsetX = (rng() - 0.5) * scatter * (r / radiusMeters);
      const offsetZ = (rng() - 0.5) * scatter * (r / radiusMeters);
      const verticalScatter = (rng() - 0.5) * 0.03 * radiusMeters * (1 - r / radiusMeters);

      x = Math.cos(spiralAngle) * r + offsetX;
      z = Math.sin(spiralAngle) * r + offsetZ;
      y = verticalScatter;
    }

    // Colors
    const distRatio = Math.hypot(x, z) / radiusMeters;
    const color = new THREE.Color();
    if (isDust) {
      color.copy(dustColor);
      importance *= 0.2;
    } else {
      color.copy(coreColor).lerp(armColor, Math.min(distRatio * 1.2, 1.0));
      // Random stellar variation
      const lum = 0.7 + rng() * 0.6;
      color.multiplyScalar(lum);
    }

    stars.push({ x, y, z, r: color.r, g: color.g, b: color.b, importance, isDust });
  }

  // Sort by importance descending so Dee's LOD tier slices contain the brightest/most critical stars first
  stars.sort((a, b) => b.importance - a.importance);

  // 2. Define LOD Tiers (Tier 0: Full, Tier 1: Arms/Disk only, Tier 2: Sparse Sprite, Tier 3: Glow Dot)
  const tierCounts = [
    stars.length,
    Math.floor(stars.length * 0.5),
    Math.floor(stars.length * 0.15),
    Math.floor(stars.length * 0.03)
  ];

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(stars.length * 3);
  const colors = new Float32Array(stars.length * 3);

  stars.forEach((s, idx) => {
    positions[idx * 3]     = s.x;
    positions[idx * 3 + 1] = s.y;
    positions[idx * 3 + 2] = s.z;

    colors[idx * 3]     = s.r;
    colors[idx * 3 + 1] = s.g;
    colors[idx * 3 + 2] = s.b;
  });

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const particleTexture = createParticleTexture();

  // Create shared material with fixed-pixel soft round sprites
  const material = new THREE.PointsMaterial({
    size: 3.0,
    sizeAttenuation: false,
    vertexColors: true,
    map: particleTexture,
    transparent: true,
    opacity: 0.9,
    alphaTest: 0.05,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const pointsMesh = new THREE.Points(geometry, material);

  // Apply galaxy orientation (Inclination & Position Angle)
  const incRad = THREE.MathUtils.degToRad(profile.inclinationDeg);
  const paRad = THREE.MathUtils.degToRad(profile.positionAngleDeg);
  pointsMesh.rotation.x = incRad;
  pointsMesh.rotation.z = paRad;

  container.add(pointsMesh);

  // Initial tier set
  geometry.setDrawRange(0, tierCounts[0]);

  return {
    container,
    setLODTier(tier: number) {
      const t = Math.max(0, Math.min(tier, tierCounts.length - 1));
      geometry.setDrawRange(0, tierCounts[t]);
      // Adjust point size/opacity subtly per tier for smooth LOD transitions
      material.size = t === 3 ? 5.0 : 3.0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      particleTexture.dispose();
      container.clear();
    }
  };
}