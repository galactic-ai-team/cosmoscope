import * as THREE from 'three';
import { METERS } from '../core/frames';
import type { GalaxyGeneratorParams } from '../layers/galaxyProfiles';

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

// Cached module-level particle texture with DOM-safe fallback for Vitest
let cachedTexture: THREE.Texture | null = null;
function getParticleTexture(): THREE.Texture {
  if (cachedTexture) return cachedTexture;
  if (typeof document === 'undefined') {
    return new THREE.Texture();
  }
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
  cachedTexture = texture;
  return cachedTexture;
}

interface StarParticle {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  importance: number;
}

export function createProceduralGalaxy(profile: GalaxyGeneratorParams): GeneratedGalaxy {
  const container = new THREE.Group();
  container.name = `galaxy:${profile.id}`;

  const rng = createSeededRng(profile.seed);
  const radiusMeters = (profile.diameterLy / 2) * METERS.ly;

  const totalStars = Math.min(Math.max(profile.starCountNear, 200), 12000);
  const stars: StarParticle[] = [];
  const dustStars: StarParticle[] = [];

  const isBarred = profile.morphology.startsWith('SB');
  const isElliptical = profile.morphology === 'E' || profile.morphology === 'dSph';
  const isIrregular = profile.morphology === 'Irr';

  const arms = profile.armCount > 0 ? profile.armCount : 2;
  const pitchRad = THREE.MathUtils.degToRad(profile.pitchDeg || 15);

  const coreColor = new THREE.Color(0xfff5e6); // Warm yellow-white bulge
  const armColor = new THREE.Color(0x88ccff);  // Young blue star clusters
  const hiiColor = new THREE.Color(0xff22aa);  // H II emission pink/magenta knots
  const dustColor = new THREE.Color(0x1a0f0a); // Dark brown/red dust

  // 1. Generate Star Population (Bulge, Smooth Exponential Disk, Spiral Arms, and H II Knots)
  for (let i = 0; i < totalStars; i++) {
    const isBulge = !isElliptical && !isIrregular && (rng() < profile.bulgeFraction);
    const isSmoothDisk = !isBulge && !isElliptical && !isIrregular && (rng() < 0.25); // 25% smooth disk share
    const isHII = !isBulge && !isSmoothDisk && !isElliptical && !isIrregular && (rng() < 0.10); // 10% H II emission knots

    let x = 0, y = 0, z = 0;
    let importance = rng();
    let starColor = new THREE.Color();

    if (isElliptical || isIrregular) {
      if (isIrregular && profile.armCount > 0 && i < totalStars * 0.5) {
        const r = Math.pow(rng(), 0.8) * radiusMeters;
        const armIdx = Math.floor(rng() * arms);
        const armOffsetAngle = (armIdx / arms) * Math.PI * 2;
        const spiralAngle = (Math.log(Math.max(r, radiusMeters * 0.05) / (radiusMeters * 0.1)) / Math.tan(pitchRad)) + armOffsetAngle;
        const scatter = 0.15 * radiusMeters;
        x = Math.cos(spiralAngle) * r + (rng() - 0.5) * scatter;
        y = Math.sin(spiralAngle) * r + (rng() - 0.5) * scatter;
        z = (rng() - 0.5) * 0.05 * radiusMeters;
      } else {
        const r = Math.pow(rng(), 0.6) * radiusMeters;
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos((rng() * 2) - 1);
        x = r * Math.sin(phi) * Math.cos(theta);
        y = r * Math.sin(phi) * Math.sin(theta);
        z = r * Math.cos(phi) * (isElliptical ? 0.7 : 0.4);
      }
      starColor.copy(coreColor).lerp(armColor, 0.5);
    } else if (isBulge) {
      const bulgeRadius = radiusMeters * 0.22;
      
      if (isBarred && rng() < 0.4) {
        const barLength = bulgeRadius * 1.5;
        const barWidth = bulgeRadius * 0.35;
        const t = (rng() - 0.5) * barLength;
        const perp = (rng() - 0.5) * barWidth;
        x = t;
        y = perp;
        z = (rng() - 0.5) * barWidth * 0.4;
      } else {
        const r = Math.pow(rng(), 2) * bulgeRadius;
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos((rng() * 2) - 1);
        x = r * Math.sin(phi) * Math.cos(theta);
        y = r * Math.sin(phi) * Math.sin(theta);
        z = r * Math.cos(phi) * 0.6;
      }
      importance += 0.5;
      starColor.copy(coreColor);
    } else if (isSmoothDisk) {
      // Smooth exponential disk underneath arms to eliminate hollow gaps
      const scaleLength = radiusMeters * 0.3;
      const r = Math.min(-scaleLength * Math.log(1 - rng() * 0.99), radiusMeters);
      const theta = rng() * Math.PI * 2;
      x = Math.cos(theta) * r;
      y = Math.sin(theta) * r;
      z = (rng() - 0.5) * 0.02 * radiusMeters;
      starColor.copy(coreColor).lerp(armColor, 0.6);
    } else {
      // Spiral arms & H II emission regions
      const r = Math.pow(rng(), 0.8) * radiusMeters;
      const armIdx = Math.floor(rng() * arms);
      const armOffsetAngle = (armIdx / arms) * Math.PI * 2;
      
      const spiralAngle = (Math.log(Math.max(r, radiusMeters * 0.05) / (radiusMeters * 0.1)) / Math.tan(pitchRad)) + armOffsetAngle;
      const scatter = isHII ? 0.06 * radiusMeters : 0.12 * radiusMeters; // Tighter clustering for H II knots

      const offsetX = (rng() - 0.5) * scatter * (r / radiusMeters);
      const offsetY = (rng() - 0.5) * scatter * (r / radiusMeters);
      const verticalScatter = (rng() - 0.5) * 0.03 * radiusMeters * (1 - r / radiusMeters);

      x = Math.cos(spiralAngle) * r + offsetX;
      y = Math.sin(spiralAngle) * r + offsetY;
      z = verticalScatter;

      if (isHII) {
        starColor.copy(hiiColor);
        importance += 0.4; // Keep H II knots in high LOD tiers
      } else {
        const distRatio = Math.hypot(x, y) / radiusMeters;
        starColor.copy(coreColor).lerp(armColor, Math.min(distRatio * 1.2, 1.0));
      }
    }

    const lum = 0.7 + rng() * 0.6;
    starColor.multiplyScalar(lum);

    stars.push({ x, y, z, r: starColor.r, g: starColor.g, b: starColor.b, importance });
  }

  // 2. Generate Separate Dust Lanes (Skip for ellipticals)
  if (!isElliptical) {
    const dustCount = Math.floor(totalStars * (profile.dustStrength * 0.2));
    for (let i = 0; i < dustCount; i++) {
      const r = Math.pow(rng(), 0.8) * radiusMeters * 0.8;
      const armIdx = Math.floor(rng() * arms);
      const armOffsetAngle = (armIdx / arms) * Math.PI * 2;
      const spiralAngle = (Math.log(Math.max(r, radiusMeters * 0.05) / (radiusMeters * 0.1)) / Math.tan(pitchRad)) + armOffsetAngle - 0.05;

      const x = Math.cos(spiralAngle) * r + (rng() - 0.5) * 0.05 * radiusMeters;
      const y = Math.sin(spiralAngle) * r + (rng() - 0.5) * 0.05 * radiusMeters;
      const z = (rng() - 0.5) * 0.01 * radiusMeters;

      dustStars.push({ x, y, z, r: dustColor.r, g: dustColor.g, b: dustColor.b, importance: 0.1 });
    }
  }

  stars.sort((a, b) => b.importance - a.importance);

  const tierCounts = [
    stars.length,
    Math.floor(stars.length * 0.5),
    Math.floor(stars.length * 0.15),
    Math.floor(stars.length * 0.03)
  ];

  // Build Star Mesh
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
  geometry.setDrawRange(0, tierCounts[0]);

  const material = new THREE.PointsMaterial({
    size: 3.0,
    sizeAttenuation: false,
    vertexColors: true,
    map: getParticleTexture(),
    transparent: true,
    opacity: 0.9,
    alphaTest: 0.05,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const pointsMesh = new THREE.Points(geometry, material);

  // Build Dust Mesh
  let dustMesh: THREE.Points | null = null;
  let dustGeometry: THREE.BufferGeometry | null = null;
  let dustMaterial: THREE.PointsMaterial | null = null;

  if (dustStars.length > 0) {
    dustGeometry = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustStars.length * 3);
    const dustCol = new Float32Array(dustStars.length * 3);
    dustStars.forEach((s, idx) => {
      dustPos[idx * 3] = s.x;
      dustPos[idx * 3 + 1] = s.y;
      dustPos[idx * 3 + 2] = s.z;
      dustCol[idx * 3] = s.r;
      dustCol[idx * 3 + 1] = s.g;
      dustCol[idx * 3 + 2] = s.b;
    });
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeometry.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));

    dustMaterial = new THREE.PointsMaterial({
      size: 3.5,
      sizeAttenuation: false,
      vertexColors: true,
      map: getParticleTexture(),
      transparent: true,
      opacity: profile.dustStrength * 0.7,
      blending: THREE.NormalBlending,
      depthWrite: false
    });

    dustMesh = new THREE.Points(dustGeometry, dustMaterial);
  }

  const incRad = THREE.MathUtils.degToRad(profile.inclinationDeg ?? 0);
  const paRad = THREE.MathUtils.degToRad(profile.positionAngleDeg ?? 0);

  pointsMesh.rotation.order = 'ZXY';
  pointsMesh.rotation.z = paRad;
  pointsMesh.rotation.x = incRad;
  container.add(pointsMesh);

  if (dustMesh) {
    dustMesh.rotation.order = 'ZXY';
    dustMesh.rotation.z = paRad;
    dustMesh.rotation.x = incRad;
    container.add(dustMesh);
  }

  return {
    container,
    setLODTier(tier: number) {
      const t = Math.max(0, Math.min(tier, tierCounts.length - 1));
      geometry.setDrawRange(0, tierCounts[t]);
      material.size = t === 3 ? 5.0 : 3.0;
      if (dustMesh) {
        dustMesh.visible = t <= 1;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      if (dustGeometry) dustGeometry.dispose();
      if (dustMaterial) dustMaterial.dispose();
      container.clear();
    }
  };
}