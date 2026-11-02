import * as THREE from 'three';

export interface GalaxyParams {
  type: 'spiral' | 'elliptical' | 'irregular';
  starCount: number;
  radius: number; // in kiloparsecs (kpc)
  arms?: number;
  pitchAngle?: number; // radians
  bulgeRadius: number;
  innerColor: THREE.Color;
  outerColor: THREE.Color;
  eccentricity?: number; // for elliptical
  scatter?: number;
}

export interface GeneratedGalaxy {
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  mesh: THREE.Points;
}

export function createProceduralGalaxy(params: GalaxyParams): GeneratedGalaxy {
  const count = params.starCount;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  const colorInside = params.innerColor;
  const colorOutside = params.outerColor;
  const scatter = params.scatter ?? 0.15;
  const arms = params.arms ?? 2;
  const pitch = params.pitchAngle ?? 0.5;

  const colorMix = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;

    // Decide if star belongs to bulge or disk/arms
    const isBulge = Math.random() < 0.25;
    let radius = 0;
    let x = 0;
    let y = 0;
    let z = 0;

    if (isBulge || params.type === 'elliptical') {
      // Spherical or ellipsoidal bulge distribution
      const r = Math.pow(Math.random(), 2) * params.bulgeRadius;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);

      const ecc = params.eccentricity ?? 1.0;
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.sin(phi) * Math.sin(theta) * (params.type === 'elliptical' ? ecc : 0.6);
      z = r * Math.cos(phi);

      radius = r;
    } else if (params.type === 'spiral') {
      // Logarithmic spiral arms
      const r = Math.pow(Math.random(), 0.8) * params.radius;
      const armIndex = Math.floor(Math.random() * arms);
      const armOffsetAngle = (armIndex / arms) * Math.PI * 2;
      
      // Logarithmic spiral formula: theta = ln(r / r0) / tan(pitch)
      const spiralAngle = (Math.log(Math.max(r, 0.1) / 0.5) / Math.tan(pitch)) + armOffsetAngle;

      // Add Gaussian-like scatter around the arm curve
      const randomSkewX = (Math.random() - 0.5) * scatter * r;
      const randomSkewZ = (Math.random() - 0.5) * scatter * r;
      const verticalScatter = (Math.random() - 0.5) * 0.1 * params.radius * (1 - r / params.radius);

      x = Math.cos(spiralAngle) * r + randomSkewX;
      z = Math.sin(spiralAngle) * r + randomSkewZ;
      y = verticalScatter;

      radius = r;
    } else {
      // Irregular galaxy (clumpy, scattered distribution)
      const r = Math.random() * params.radius;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI * 0.5;

      x = r * Math.cos(phi) * Math.cos(theta);
      z = r * Math.cos(phi) * Math.sin(theta);
      y = r * Math.sin(phi) * 0.5;

      radius = r;
    }

    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    // Color gradient based on distance from center (older redder stars in core, blue arms)
    const normalizedDist = Math.min(radius / params.radius, 1.0);
    colorMix.copy(colorInside).lerp(colorOutside, normalizedDist);

    // Add slight random color variation per star
    const lum = 0.8 + Math.random() * 0.4;
    colors[i3] = colorMix.r * lum;
    colors[i3 + 1] = colorMix.g * lum;
    colors[i3 + 2] = colorMix.b * lum;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.12,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const mesh = new THREE.Points(geometry, material);

  return { geometry, material, mesh };
}

