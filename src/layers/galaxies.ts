// src/layers/galaxies.ts
// Nova's galaxies & deep-sky layer for Cosmoscope.
// Contracts: docs/CONTRACTS.md (PR #1). Ids confirmed as
// <kind>:<catalog>:<id> (e.g. galaxy:messier:M31). resolveTarget follows
// Dee's addition: { frameId, worldPos: Float64Array, approachRadius },
// with worldPos already in the target's native frame.
// Frame: 'galactic' for the v1 seed — Sun-centered galactic-axis vectors
// (converted from RA/Dec). If Claude's galactic frame turns out to be
// galactic-center-origin, add one +26,000 ly translation. 'cosmic' is
// reserved for the deep web sample.
// Positions are galactic-frame metres (float64). Rendering rebases to
// camera-relative float32 in update(), the only path from world space to
// render space, per the contracts.
// Data: static, public-domain catalog values. Seed RA/Dec/distances are
// standard catalog figures — validate against NED/HyperLEDA before launch.
// The equatorial→galactic matrix is the standard J2000 rotation; it was
// sanity-checked against M31's known galactic coords (l ≈ 121°, b ≈ −21.6°).

import * as THREE from 'three';

import { register, type CatalogEntry } from '../catalog';

const LY_M = 9.4607e15; // metres per light-year
const MLY_M = LY_M * 1e6; // metres per million light-years

// Standard J2000 equatorial → galactic rotation matrix (rows: galactic
// x, y, z from equatorial x, y, z). Validate against Claude's frame API.
const EQ_TO_GAL = [
  -0.054875560416, -0.873437090235, -0.483835015549,
  0.494109427876, -0.444829629961, 0.746982244497,
  -0.867666149019, -0.198076373431, 0.455983776175,
];

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** RA/Dec + distance → galactic-frame metres (float64 triple). */
function equatorialToGalactic(
  raDeg: number,
  decDeg: number,
  distanceM: number,
): [number, number, number] {
  const ra = degToRad(raDeg);
  const dec = degToRad(decDeg);
  const ex = Math.cos(dec) * Math.cos(ra);
  const ey = Math.cos(dec) * Math.sin(ra);
  const ez = Math.sin(dec);
  const gx = EQ_TO_GAL[0] * ex + EQ_TO_GAL[1] * ey + EQ_TO_GAL[2] * ez;
  const gy = EQ_TO_GAL[3] * ex + EQ_TO_GAL[4] * ey + EQ_TO_GAL[5] * ez;
  const gz = EQ_TO_GAL[6] * ex + EQ_TO_GAL[7] * ey + EQ_TO_GAL[8] * ez;
  return [gx * distanceM, gy * distanceM, gz * distanceM];
}

type BodyKind = 'galaxy' | 'cluster';

interface BodyDatum {
  id: string;
  name: string;
  aliases: string[];
  kind: BodyKind;
  type: string;
  constellation: string;
  raDeg: number;
  decDeg: number;
  distanceMly: number;
  blurb: string;
}

// V1 seed: Messier galaxies + great clusters + the galactic center.
// LMC/SMC and the Local Group dwarfs have no Messier numbers — they join
// with the catalog-validation pass (PGC namespace is the likely home).
// ':common:' is proposed for common-name-only objects (Milky Way, Virgo).
const BODIES: BodyDatum[] = [
  { id: 'galaxy:messier:M31', name: 'Andromeda Galaxy', aliases: ['M31', 'NGC 224'], kind: 'galaxy', type: 'Spiral (Sb)', constellation: 'Andromeda', raDeg: 10.68, decDeg: 41.27, distanceMly: 2.54, blurb: 'Our nearest giant spiral neighbor — on a slow collision course with the Milky Way.' },
  { id: 'galaxy:messier:M32', name: 'M32', aliases: ['NGC 221'], kind: 'galaxy', type: 'Elliptical dwarf (E2)', constellation: 'Andromeda', raDeg: 10.68, decDeg: 40.87, distanceMly: 2.54, blurb: 'A compact elliptical dwarf, a close satellite of Andromeda.' },
  { id: 'galaxy:messier:M110', name: 'M110', aliases: ['NGC 205'], kind: 'galaxy', type: 'Elliptical (E5)', constellation: 'Andromeda', raDeg: 10.09, decDeg: 41.69, distanceMly: 2.69, blurb: 'Andromeda\'s other bright companion, warped by its giant neighbor.' },
  { id: 'galaxy:messier:M33', name: 'Triangulum Galaxy', aliases: ['M33', 'NGC 598'], kind: 'galaxy', type: 'Spiral (Sc)', constellation: 'Triangulum', raDeg: 23.46, decDeg: 30.66, distanceMly: 2.73, blurb: 'The third-largest member of the Local Group, face-on and sprawling.' },
  { id: 'galaxy:messier:M51', name: 'Whirlpool Galaxy', aliases: ['M51', 'NGC 5194'], kind: 'galaxy', type: 'Spiral (Sc)', constellation: 'Canes Venatici', raDeg: 202.47, decDeg: 47.19, distanceMly: 23, blurb: 'The classic grand-design spiral, mid-embrace with its companion NGC 5195.' },
  { id: 'galaxy:messier:M81', name: "Bode's Galaxy", aliases: ['M81', 'NGC 3031'], kind: 'galaxy', type: 'Spiral (Sb)', constellation: 'Ursa Major', raDeg: 148.89, decDeg: 69.06, distanceMly: 12, blurb: 'One of the brightest galaxies in our sky, anchor of the M81 group.' },
  { id: 'galaxy:messier:M82', name: 'Cigar Galaxy', aliases: ['M82', 'NGC 3034'], kind: 'galaxy', type: 'Starburst irregular', constellation: 'Ursa Major', raDeg: 148.97, decDeg: 69.68, distanceMly: 12, blurb: 'A starburst galaxy blowing a superwind of hot gas out of its core.' },
  { id: 'galaxy:messier:M87', name: 'M87', aliases: ['NGC 4486', 'Virgo A'], kind: 'galaxy', type: 'Elliptical giant (E0)', constellation: 'Virgo', raDeg: 187.71, decDeg: 12.39, distanceMly: 53.5, blurb: 'A supergiant elliptical with a monster black hole — the first ever imaged.' },
  { id: 'galaxy:messier:M101', name: 'Pinwheel Galaxy', aliases: ['M101', 'NGC 5457'], kind: 'galaxy', type: 'Spiral (Sc)', constellation: 'Ursa Major', raDeg: 210.8, decDeg: 54.35, distanceMly: 21, blurb: 'A huge face-on spiral, nearly twice the Milky Way\'s width.' },
  { id: 'galaxy:messier:M104', name: 'Sombrero Galaxy', aliases: ['M104', 'NGC 4594'], kind: 'galaxy', type: 'Spiral (Sa)', constellation: 'Virgo', raDeg: 189.99, decDeg: -11.62, distanceMly: 29, blurb: 'A brilliant bulge wrapped in a dark dust lane, like a wide-brimmed hat.' },
  { id: 'galaxy:common:milkyway', name: 'Milky Way', aliases: ['Galactic Center', 'Sgr A*'], kind: 'galaxy', type: 'Barred spiral (SBbc)', constellation: 'Sagittarius', raDeg: 266.42, decDeg: -29.01, distanceMly: 0.026, blurb: 'Home. We live inside this one — this target is its center.' },
  { id: 'cluster:common:virgo', name: 'Virgo Cluster', aliases: ['M87 group'], kind: 'cluster', type: 'Galaxy cluster', constellation: 'Virgo', raDeg: 186.75, decDeg: 12.67, distanceMly: 54, blurb: 'The nearest great cluster — over a thousand galaxies, heart of our supercluster.' },
  { id: 'cluster:abell:1656', name: 'Coma Cluster', aliases: ['Abell 1656'], kind: 'cluster', type: 'Galaxy cluster', constellation: 'Coma Berenices', raDeg: 194.95, decDeg: 27.98, distanceMly: 320, blurb: 'A dense swarm of thousands of galaxies, a classic cosmic-web node.' },
  { id: 'cluster:abell:S373', name: 'Fornax Cluster', aliases: ['Abell S373'], kind: 'cluster', type: 'Galaxy cluster', constellation: 'Fornax', raDeg: 54.73, decDeg: -35.45, distanceMly: 62, blurb: 'The second-richest cluster nearby, a southern-sky anchor of the web.' },
];

// Catalog entries for Lumi's search + info panels. Distance in metres,
// per the catalog contract.
export const GALAXY_ENTRIES: CatalogEntry[] = BODIES.map((b) => ({
  id: b.id,
  name: b.name,
  aliases: b.aliases,
  kind: b.kind,
  distanceM: b.distanceMly * MLY_M,
  facts: {
    Type: b.type,
    Constellation: b.constellation,
    Distance: `${b.distanceMly} million light-years`,
  },
  blurb: b.blurb,
}));

register(GALAXY_ENTRIES);

// Galactic-frame positions (float64), computed once at load.
const positions64 = new Float64Array(BODIES.length * 3);
const byId = new Map<string, number>();
BODIES.forEach((b, i) => {
  byId.set(b.id, i);
  const [x, y, z] = equatorialToGalactic(b.raDeg, b.decDeg, b.distanceMly * MLY_M);
  positions64[i * 3] = x;
  positions64[i * 3 + 1] = y;
  positions64[i * 3 + 2] = z;
});

// Color by type: spirals cool blue-white, ellipticals gold, irregulars
// teal, clusters magenta. Documented so the legend can reuse it.
function colorFor(b: BodyDatum): THREE.Color {
  if (b.kind === 'cluster') return new THREE.Color(0xff9ecb);
  if (b.type.startsWith('Elliptical')) return new THREE.Color(0xffd9a0);
  if (b.type.includes('irregular')) return new THREE.Color(0x9fe8d0);
  return new THREE.Color(0xbfd4ff);
}

// Runtime-generated glow sprite (no asset files). Fixed screen size:
// with sizeAttenuation off, points stay readable across six orders of
// magnitude of camera distance — the only sane choice at cosmic scales.
function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Handoff with GPT-6's stars layer (contracts: exact distance TBD between
// us). Provisional: stars fade out past 100,000 ly from the Sun (the disk
// diameter); this layer owns everything beyond. Confirm with GPT-6.
export const STAR_HANDOFF_LY = 100_000;

let points: THREE.Points | null = null;
let pointsGeometry: THREE.BufferGeometry | null = null;
let pointsMaterial: THREE.PointsMaterial | null = null;
let pointsTexture: THREE.Texture | null = null;

function buildPoints(): THREE.Points {
  const n = BODIES.length;
  const positions = new Float32Array(n * 3); // camera-relative, refilled in update()
  const colors = new Float32Array(n * 3);
  BODIES.forEach((b, i) => {
    const col = colorFor(b);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  });
  pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pointsTexture = makeGlowTexture();
  pointsMaterial = new THREE.PointsMaterial({
    size: 6,
    sizeAttenuation: false,
    map: pointsTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  points = new THREE.Points(pointsGeometry, pointsMaterial);
  points.frustumCulled = false; // positions are rebased every frame
  return points;
}

export const galaxiesLayer = {
  id: 'galaxies',
  frameId: 'galactic',

  // Provisional: units/semantics per Dee's registry (assumed frame metres).
  pickRadius: 1e21,
  renderBudget: { drawCalls: 1, points: BODIES.length },

  enter(scene: THREE.Scene): void {
    if (!points) buildPoints();
    if (points && !points.parent) scene.add(points);
  },

  exit(scene: THREE.Scene): void {
    if (points && points.parent === scene) scene.remove(points);
  },

  /**
   * Rebase float64 world positions to camera-relative float32 every
   * frame — the only path from world space to render space, per the
   * contracts. cameraWorld is the camera's galactic-frame position in
   * metres; pass Dee's getCameraWorldPosition() result once it lands.
   * Until then it defaults to the origin (correct while the camera is
   * near the Sun).
   */
  update(
    _dt: number,
    cameraWorld?: { x: number; y: number; z: number },
  ): void {
    if (!points || !pointsGeometry) return;
    const attr = pointsGeometry.getAttribute('position') as THREE.BufferAttribute;
    const cx = cameraWorld?.x ?? 0;
    const cy = cameraWorld?.y ?? 0;
    const cz = cameraWorld?.z ?? 0;
    for (let i = 0; i < BODIES.length; i++) {
      attr.setXYZ(
        i,
        positions64[i * 3] - cx,
        positions64[i * 3 + 1] - cy,
        positions64[i * 3 + 2] - cz,
      );
    }
    attr.needsUpdate = true;
  },

  /** Bounding box of the layer in the requested frame's units. */
  boundsInFrameUnits(
    frameId: string,
  ): { min: [number, number, number]; max: [number, number, number] } | null {
    // Only the galactic frame is native here; other frames belong to
    // Claude's toFrame() once the Frame API lands.
    if (frameId !== 'galactic') return null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < BODIES.length; i++) {
      minX = Math.min(minX, positions64[i * 3]);
      minY = Math.min(minY, positions64[i * 3 + 1]);
      minZ = Math.min(minZ, positions64[i * 3 + 2]);
      maxX = Math.max(maxX, positions64[i * 3]);
      maxY = Math.max(maxY, positions64[i * 3 + 1]);
      maxZ = Math.max(maxZ, positions64[i * 3 + 2]);
    }
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  },

  /**
   * Resolve a catalog id to a flyTo target, per Dee's addition:
   * worldPos is a Float64Array already in the target's native frame
   * ('galactic' here), and approachRadius frames the camera at 20% of
   * the body's distance — a flyby framing.
   */
  resolveTarget(
    id: string,
  ): { frameId: string; worldPos: Float64Array; approachRadius: number } | null {
    const i = byId.get(id);
    if (i === undefined) return null;
    const b = BODIES[i];
    return {
      frameId: 'galactic',
      worldPos: new Float64Array([
        positions64[i * 3],
        positions64[i * 3 + 1],
        positions64[i * 3 + 2],
      ]),
      approachRadius: b.distanceMly * MLY_M * 0.2,
    };
  },

  dispose(): void {
    pointsGeometry?.dispose();
    pointsMaterial?.dispose();
    pointsTexture?.dispose();
    points = null;
    pointsGeometry = null;
    pointsMaterial = null;
    pointsTexture = null;
  },
};

export default galaxiesLayer;
