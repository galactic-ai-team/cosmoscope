// src/layers/galaxies.ts
// Nova's galaxies & deep-sky layer for Cosmoscope.
// Implements Dee's ScaleLayer directly (src/core/layers.ts) — no adapter.
// Constructed via createGalaxiesLayer(scene, camera), the same factory
// pattern as GPT-6's makeStarsLayer: enter() receives the FrameApi, but
// scene membership and render scaling come from the factory closures.
// Rendering follows Claude's camera recipe: each frame, every body's
// float64 galactic-frame position (parsecs) goes through
// camera.toCameraRelative() — frame conversion, camera subtraction and
// render-unit scaling in one call, no group-scale hack, and frame hops
// (galactic → cosmic) just work.
// Ids confirmed: <kind>:<catalog>:<id> (galaxy:messier:M31,
// galaxy:common:milkyway, galaxy:sdss:<objid> for the later sample).
// Catalog distanceM stays METRES per src/catalog.ts; frame positions
// are parsecs. resolveTarget returns Dee's ResolvedTarget shape.
// Data: static, public-domain catalog values — validate against
// NED/HyperLEDA before launch.

import * as THREE from 'three';

import type { FrameApi, CosmoCamera } from '../core/camera';
import type { ResolvedTarget, ScaleLayer } from '../core/layers';
import { register, type CatalogEntry } from '../catalog';

const LY_M = 9.4607e15; // metres per light-year (catalog distanceM only)
const MLY_M = LY_M * 1e6; // metres per million light-years
const LY_PER_PC = 3.26156; // light-years per parsec
const PC_PER_MLY = 1e6 / LY_PER_PC; // parsecs per million light-years

// Lane constants from Claude. GC drives the Milky Way center entry
// below; NGP is the Milky Way disk-plane normal for the band file.
export const GALACTIC_CENTER = {
  raDeg: 266.405,
  decDeg: -28.936,
  distancePc: 8270, // 8.27 kpc
} as const;

export const NORTH_GALACTIC_POLE = {
  raDeg: 192.859,
  decDeg: 27.128,
} as const;

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** RA/Dec + distance → Sun-centred ICRS Cartesian in parsecs. */
function icrsPosition(
  raDeg: number,
  decDeg: number,
  distancePc: number,
): [number, number, number] {
  const ra = degToRad(raDeg);
  const dec = degToRad(decDeg);
  const cd = Math.cos(dec);
  return [
    cd * Math.cos(ra) * distancePc,
    cd * Math.sin(ra) * distancePc,
    Math.sin(dec) * distancePc,
  ];
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
  { id: 'galaxy:common:milkyway', name: 'Milky Way', aliases: ['Galactic Center', 'Sgr A*'], kind: 'galaxy', type: 'Barred spiral (SBbc)', constellation: 'Sagittarius', raDeg: GALACTIC_CENTER.raDeg, decDeg: GALACTIC_CENTER.decDeg, distanceMly: (GALACTIC_CENTER.distancePc * LY_PER_PC) / 1e6, blurb: 'Home. We live inside this one — this target is its center.' },
  { id: 'cluster:common:virgo', name: 'Virgo Cluster', aliases: ['M87 group'], kind: 'cluster', type: 'Galaxy cluster', constellation: 'Virgo', raDeg: 186.75, decDeg: 12.67, distanceMly: 54, blurb: 'The nearest great cluster — over a thousand galaxies, heart of our supercluster.' },
  { id: 'cluster:abell:1656', name: 'Coma Cluster', aliases: ['Abell 1656'], kind: 'cluster', type: 'Galaxy cluster', constellation: 'Coma Berenices', raDeg: 194.95, decDeg: 27.98, distanceMly: 320, blurb: 'A dense swarm of thousands of galaxies, a classic cosmic-web node.' },
  { id: 'cluster:abell:S373', name: 'Fornax Cluster', aliases: ['Abell S373'], kind: 'cluster', type: 'Galaxy cluster', constellation: 'Fornax', raDeg: 54.73, decDeg: -35.45, distanceMly: 62, blurb: 'The second-richest cluster nearby, a southern-sky anchor of the web.' },
];

// Catalog entries for Lumi's search + info panels. distanceM stays metres
// per the catalog contract; frame positions below are parsecs.
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

// Galactic-frame positions in PARSECS (float64), computed once at load.
const positionsPc = new Float64Array(BODIES.length * 3);
const byId = new Map<string, number>();
BODIES.forEach((b, i) => {
  byId.set(b.id, i);
  const [x, y, z] = icrsPosition(b.raDeg, b.decDeg, b.distanceMly * PC_PER_MLY);
  positionsPc[i * 3] = x;
  positionsPc[i * 3 + 1] = y;
  positionsPc[i * 3 + 2] = z;
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

// Stars→galaxies handoff, agreed with GPT-6: stars fade out across
// 60,000–100,000 ly from the Sun. The fade lives on the stars side;
// galaxies are visible at all distances (we see Andromeda from Earth!).
export const STAR_HANDOFF_LY = { fadeStart: 60_000, fadeEnd: 100_000 } as const;

/** Shared resolveTarget: both layers route ids through the same data. */
function resolveGalaxyTarget(id: string): ResolvedTarget | null {
  const i = byId.get(id);
  if (i === undefined) return null;
  const b = BODIES[i];
  return {
    frameId: 'galactic',
    worldPos: new Float64Array([
      positionsPc[i * 3],
      positionsPc[i * 3 + 1],
      positionsPc[i * 3 + 2],
    ]),
    // Flyby framing: stop at 20% of the body's distance.
    approachRadius: b.distanceMly * PC_PER_MLY * 0.2,
  };
}

/**
 * Build the galaxies ScaleLayer. The registry activates layers by frame
 * (frames below) and crossfades opacity; update() receives the camera's
 * distance to the origin for LOD decisions (unused at this seed size).
 * No per-frame allocation: one scratch Float64Array + one Vector3.
 */
export function createGalaxiesLayer(
  scene: THREE.Scene,
  camera: CosmoCamera,
): ScaleLayer {
  const n = BODIES.length;
  const positions = new Float32Array(n * 3); // camera-relative, refilled in update()
  const colors = new Float32Array(n * 3);
  BODIES.forEach((b, i) => {
    const col = colorFor(b);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 6,
    sizeAttenuation: false,
    map: makeGlowTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // positions are rebased every frame

  const scratch = new Float64Array(3);
  const tmpVec = new THREE.Vector3();

  const layer: ScaleLayer = {
    idPrefix: 'galaxy',
    // Visible in both frames: galactic positions convert to the camera's
    // frame inside toCameraRelative, so cosmic-frame cameras work too.
    frames: ['galactic', 'cosmic'],
    renderBudget: n,

    enter(_api: FrameApi): void {
      scene.add(points);
    },

    exit(): void {
      points.removeFromParent();
    },

    update(_dt: number, _distance: number, _api: FrameApi): void {
      const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        scratch[0] = positionsPc[i * 3];
        scratch[1] = positionsPc[i * 3 + 1];
        scratch[2] = positionsPc[i * 3 + 2];
        camera.toCameraRelative(scratch, 'galactic', tmpVec);
        attr.setXYZ(i, tmpVec.x, tmpVec.y, tmpVec.z);
      }
      attr.needsUpdate = true;
    },

    resolveTarget: resolveGalaxyTarget,
  };
  return layer;
}

/**
 * Clusters share this file's data, but the registry routes by id prefix,
 * so cluster:* ids need their own entry. Rendered by the galaxies layer
 * above (same Points object); this entry only routes resolveTarget.
 * frames: [] means it never activates on its own.
 */
export const clustersRoute: ScaleLayer = {
  idPrefix: 'cluster',
  frames: [],
  renderBudget: 0,
  enter(_api: FrameApi): void {},
  exit(): void {},
  update(_dt: number, _distance: number, _api: FrameApi): void {},
  resolveTarget: resolveGalaxyTarget,
};

export default createGalaxiesLayer;
