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

// Approximate isophotal diameters in light-years — FRAMING ONLY, not
// catalog measurements. approachRadius below is the body RADIUS, so an
// orbit flight (×3 in FlyToController) lands at 3× radius = 1.5×
// diameter, and a flyby (×8) at 4× diameter. The old 0.2× Sun-distance
// rule is gone: it made distant bodies stop absurdly far out and near
// ones inconsistently close.
const DIAMETER_LY: Record<string, number> = {
  'galaxy:messier:M31': 220_000,
  'galaxy:messier:M32': 8_000,
  'galaxy:messier:M110': 15_000,
  'galaxy:messier:M33': 55_000,
  'galaxy:messier:M51': 76_000,
  'galaxy:messier:M81': 90_000,
  'galaxy:messier:M82': 37_000,
  'galaxy:messier:M87': 120_000,
  'galaxy:messier:M101': 170_000,
  'galaxy:messier:M104': 130_000,
  'galaxy:common:milkyway': 100_000,
  'cluster:common:virgo': 16_000_000,
  'cluster:abell:1656': 20_000_000,
  'cluster:abell:S373': 6_000_000,
  'galaxy:pgc:17223': 14_000,
  'galaxy:pgc:3085': 7_000,
  'galaxy:pgc:4689212': 10_000,
  'galaxy:pgc:10074': 9_300,
  'galaxy:pgc:3589': 3_000,
  'galaxy:pgc:19441': 2_000,
  'galaxy:pgc:88608': 8_000,
  'galaxy:pgc:29488': 2_000,
  'galaxy:pgc:34176': 3_000,
  'galaxy:pgc:54074': 2_000,
  'galaxy:pgc:60095': 3_000,
  'galaxy:pgc:2666': 2_000,
  'galaxy:pgc:4601': 2_000,
  'galaxy:pgc:2121': 3_000,
  'galaxy:pgc:2004': 9_000,
  'galaxy:pgc:2329': 10_600,
// DIAMETER_LY additions — framing PLACEHOLDERS, not measurements.
// UFDs are ~100–1000 pc across; refine per-object from half-light radii
// later. 2,000 ly keeps sprites and approach distances sensible; the
// 0.4× distance fallback would render them as giant blobs.
'galaxy:pgc:4713565': 2_000,
'galaxy:pgc:4713559': 2_000,
'galaxy:pgc:4713561': 2_000,
'galaxy:pgc:4713563': 2_000,
'galaxy:pgc:4713557': 2_000,
'galaxy:pgc:4713558': 2_000,
'galaxy:pgc:4713552': 2_000,
'galaxy:pgc:4713553': 2_000,
'galaxy:pgc:4713560': 2_000,
'galaxy:pgc:4689223': 2_000,
// DIAMETER_LY additions — same framing-placeholder convention as part 1.
'galaxy:ufd:hydrus-1': 2_000,
'galaxy:ufd:horologium-1': 2_000,
'galaxy:ufd:reticulum-2': 2_000,
'galaxy:ufd:eridanus-2': 2_000,
'galaxy:ufd:carina-2': 2_000,
'galaxy:ufd:ursa-major-2': 2_000,
'galaxy:ufd:ursa-major-1': 2_000,
'galaxy:ufd:willman-1': 2_000,
'galaxy:ufd:pegasus-3': 2_000,
'galaxy:ufd:aquarius-2': 2_000,
'galaxy:ufd:tucana-2': 2_000,
'galaxy:ufd:pisces-2': 2_000,
};

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
// Local Group dwarfs + Magellanic Clouds under galaxy:pgc:<n>, verified
// against Wikipedia/NED designations. Ultra-faints and NGC 147/185 are a
// later batch, not this one.
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
  { id: 'galaxy:pgc:17223', name: 'Large Magellanic Cloud', aliases: ['LMC', 'Nubecula Major', 'ESO 56-115'], kind: 'galaxy', type: 'Magellanic spiral (SBm)', constellation: 'Dorado', raDeg: 80.89, decDeg: -69.76, distanceMly: 0.163, blurb: 'The Milky Way\'s brightest satellite — a barred dwarf spiral mid-interaction with the SMC.' },
  { id: 'galaxy:pgc:3085', name: 'Small Magellanic Cloud', aliases: ['SMC', 'NGC 292', 'Nubecula Minor'], kind: 'galaxy', type: 'Irregular (SBm pec)', constellation: 'Tucana', raDeg: 13.19, decDeg: -72.83, distanceMly: 0.204, blurb: 'The smaller Cloud — a disrupted barred irregular, paired with the LMC.' },
  { id: 'galaxy:pgc:4689212', name: 'Sagittarius Dwarf', aliases: ['Sgr dSph', 'Sag DEG'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Sagittarius', raDeg: 283.83, decDeg: -30.55, distanceMly: 0.080, blurb: 'Being torn apart by the Milky Way right now — its stream wraps the whole sky.' },
  { id: 'galaxy:pgc:10074', name: 'Fornax Dwarf', aliases: ['Fornax dSph', 'ESO 356-4'], kind: 'galaxy', type: 'Dwarf elliptical (dE0)', constellation: 'Fornax', raDeg: 40.00, decDeg: -34.45, distanceMly: 0.466, blurb: 'The brightest classical dwarf spheroidal — and it hosts six globular clusters.' },
  { id: 'galaxy:pgc:3589', name: 'Sculptor Dwarf', aliases: ['Sculptor dSph', 'ESO 351-30'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Sculptor', raDeg: 15.04, decDeg: -33.71, distanceMly: 0.290, blurb: 'One of the first dwarfs ever found — ancient, metal-poor, nearly pristine.' },
  { id: 'galaxy:pgc:19441', name: 'Carina Dwarf', aliases: ['Carina dSph', 'ESO 206-G20'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Carina', raDeg: 100.40, decDeg: -50.97, distanceMly: 0.330, blurb: 'A bursty little dwarf — star formation in distinct episodes across billions of years.' },
  { id: 'galaxy:pgc:88608', name: 'Sextans Dwarf', aliases: ['Sextans I', 'Sextans dSph'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Sextans', raDeg: 153.26, decDeg: -1.61, distanceMly: 0.290, blurb: 'Faint and diffuse — one of the lowest-surface-brightness dwarfs known.' },
  { id: 'galaxy:pgc:29488', name: 'Leo I', aliases: ['Regulus Dwarf', 'DDO 74', 'UGC 5470'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Leo', raDeg: 152.11, decDeg: 12.31, distanceMly: 0.820, blurb: 'The most distant classical Milky Way satellite — hiding in Regulus\'s glare.' },
  { id: 'galaxy:pgc:34176', name: 'Leo II', aliases: ['Leo B', 'DDO 93'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Leo', raDeg: 168.37, decDeg: 22.15, distanceMly: 0.690, blurb: 'A quiet old dwarf — mostly ancient stars, barely a whisper of gas left.' },
  { id: 'galaxy:pgc:54074', name: 'Ursa Minor Dwarf', aliases: ['UMi Dwarf', 'DDO 199', 'UGC 9749'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Ursa Minor', raDeg: 227.29, decDeg: 67.22, distanceMly: 0.200, blurb: 'A dark-matter-dominated relic — almost no star formation for billions of years.' },
  { id: 'galaxy:pgc:60095', name: 'Draco Dwarf', aliases: ['Draco dSph', 'DDO 208', 'UGC 10822'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Draco', raDeg: 260.05, decDeg: 57.92, distanceMly: 0.260, blurb: 'One of the most dark-matter-dominated objects known.' },
  { id: 'galaxy:pgc:2666', name: 'Andromeda I', aliases: ['And I'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Andromeda', raDeg: 11.42, decDeg: 38.04, distanceMly: 2.40, blurb: 'M31\'s closest dwarf spheroidal companion.' },
  { id: 'galaxy:pgc:4601', name: 'Andromeda II', aliases: ['And II'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Pisces', raDeg: 19.12, decDeg: 33.42, distanceMly: 2.22, blurb: 'An M31 satellite with an unusually extended star-formation history.' },
  { id: 'galaxy:pgc:2121', name: 'Andromeda III', aliases: ['And III'], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Andromeda', raDeg: 8.89, decDeg: 36.50, distanceMly: 2.44, blurb: 'A faint M31 companion, found on the same 1970 plates as And I and II.' },
{ id: 'galaxy:pgc:2004', name: 'NGC 147', aliases: ['DDO 3', 'UGC 326', 'Caldwell 17'], kind: 'galaxy', type: 'Dwarf elliptical (dE5)', constellation: 'Cassiopeia', raDeg: 8.30, decDeg: 48.51, distanceMly: 2.38, blurb: 'M31\'s elongated companion — gravitationally bound to NGC 185, a degree away.' },
{ id: 'galaxy:pgc:2329', name: 'NGC 185', aliases: ['UGC 396', 'Caldwell 18'], kind: 'galaxy', type: 'Dwarf spheroidal (dE3)', constellation: 'Cassiopeia', raDeg: 9.74, decDeg: 48.34, distanceMly: 2.05, blurb: 'The Local Group\'s only known Seyfert — a dwarf with an active nucleus and young star clusters.' },
// BODIES entries — ultra-faint batch (PGC-verified) + CVn I (separate scope)
{ id: 'galaxy:pgc:4713565', name: 'Segue 2', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Aries', raDeg: 34.8167, decDeg: 20.1753, distanceMly: 0.1142, blurb: 'One of the faintest galaxies known — a whisper of ancient stars.' },
{ id: 'galaxy:pgc:4713559', name: 'Segue 1', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph, debated — possibly globular cluster)', constellation: 'Leo', raDeg: 151.7667, decDeg: 16.0819, distanceMly: 0.0750, blurb: 'So faint its very nature is debated — dwarf galaxy or globular cluster.' },
{ id: 'galaxy:pgc:4713561', name: 'Leo IV', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Leo', raDeg: 173.2375, decDeg: -0.5333, distanceMly: 0.5023, blurb: 'A faint Leo companion, almost entirely ancient stars.' },
{ id: 'galaxy:pgc:4713563', name: 'Leo V', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Leo', raDeg: 172.79, decDeg: 2.22, distanceMly: 0.5708, blurb: 'A distant, ghostly Leo dwarf on the edge of the Milky Way reach.' },
{ id: 'galaxy:pgc:4713557', name: 'Coma Berenices', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Coma Berenices', raDeg: 186.7458, decDeg: 23.9192, distanceMly: 0.1435, blurb: 'A faint Coma dwarf, dark-matter dominated like its kin.' },
{ id: 'galaxy:pgc:4713558', name: 'Canes Venatici II', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Canes Venatici', raDeg: 194.2917, decDeg: 34.3208, distanceMly: 0.4892, blurb: 'A dim companion in the Hunting Dogs, found by the Sloan survey.' },
{ id: 'galaxy:pgc:4713552', name: 'Boötes II', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Boötes', raDeg: 209.5, decDeg: 12.85, distanceMly: 0.1370, blurb: 'A tiny Boötes companion, barely more than a star clusters glow.' },
{ id: 'galaxy:pgc:4713553', name: 'Boötes I', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Boötes', raDeg: 210.025, decDeg: 14.5, distanceMly: 0.1957, blurb: 'The archetypal ultra-faint — the first of its kind recognized.' },
{ id: 'galaxy:pgc:4713560', name: 'Hercules', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Hercules', raDeg: 247.7583, decDeg: 12.7917, distanceMly: 0.4403, blurb: 'A stretched, elongated dwarf, pulled by the Milky Way tides.' },
{ id: 'galaxy:pgc:4689223', name: 'Canes Venatici I', aliases: [], kind: 'galaxy', type: 'Dwarf spheroidal (dSph)', constellation: 'Canes Venatici', raDeg: 202.0146, decDeg: 33.5558, distanceMly: 0.6849, blurb: 'A brighter classical dwarf — the Hunting Dogs larger companion. Separate scope from the ultra-faint batch.' },
// BODIES entries — ultra-faint batch, part 2 (ufd slugs, PGCs unknown)
// Aliases intentionally empty: PGC numbers go here if ever found.
{ id: 'galaxy:ufd:hydrus-1', name: 'Hydrus 1', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Hydrus', raDeg: 37.389, decDeg: -79.3089, distanceMly: 0.0900, blurb: 'A faint southern dwarf, barely brighter than a star cluster.' },
// Distance conflict: 68 vs 79/87/100 kpc. Table uses Jerjen 68 (deepest follow-up).
{ id: 'galaxy:ufd:horologium-1', name: 'Horologium I', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Horologium', raDeg: 43.8820, decDeg: -54.1188, distanceMly: 0.2218, blurb: 'A far southern ultra-faint, one of the dimmest known.' },
{ id: 'galaxy:ufd:reticulum-2', name: 'Reticulum II', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Reticulum', raDeg: 53.9256, decDeg: -54.0492, distanceMly: 0.1031, blurb: 'A tiny Reticulum dwarf, almost entirely old stars.' },
// Distance conflict: 370 vs 339 kpc; the 370 figure may be Galactocentric.
{ id: 'galaxy:ufd:eridanus-2', name: 'Eridanus II', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Eridanus', raDeg: 56.0838, decDeg: -43.5338, distanceMly: 1.2068, blurb: 'A remote Eridanus dwarf, far out on the Milky Way edge.' },
// NOT PGC 20125 — that is the old Argo dwarf at ~4 Mpc, ~100x too far.
{ id: 'galaxy:ufd:carina-2', name: 'Carina II', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Carina', raDeg: 114.1066, decDeg: -57.9991, distanceMly: 0.1181, blurb: 'A faint Carina dwarf in the Magellanic neighborhood.' },
// Distance variant: 30 vs 32/35 kpc; table uses 30.
{ id: 'galaxy:ufd:ursa-major-2', name: 'Ursa Major II', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Ursa Major', raDeg: 132.8750, decDeg: 63.13, distanceMly: 0.0978, blurb: 'A dim Ursa Major dwarf, stretched by galactic tides.' },
{ id: 'galaxy:ufd:ursa-major-1', name: 'Ursa Major I', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Ursa Major', raDeg: 158.72, decDeg: 51.92, distanceMly: 0.3262, blurb: 'A diffuse Ursa Major dwarf of ancient stars.' },
{ id: 'galaxy:ufd:willman-1', name: 'Willman 1', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph, debated — possibly star cluster)', constellation: 'Ursa Major', raDeg: 162.3438, decDeg: 51.0501, distanceMly: 0.1257, blurb: 'A debated object — dwarf galaxy or star cluster, still unsettled.' },
{ id: 'galaxy:ufd:pegasus-3', name: 'Pegasus III', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Pegasus', raDeg: 336.102, decDeg: 5.405, distanceMly: 0.7012, blurb: 'A distant Pegasus dwarf on the far side of the halo.' },
{ id: 'galaxy:ufd:aquarius-2', name: 'Aquarius II', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Aquarius', raDeg: 338.4813, decDeg: -9.3274, distanceMly: 0.3519, blurb: 'A faint Aquarius dwarf of old stars.' },
// Distance variant: 58 vs 50/70 kpc; table uses 58.
{ id: 'galaxy:ufd:tucana-2', name: 'Tucana II', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Tucana', raDeg: 342.9796, decDeg: -58.5689, distanceMly: 0.1892, blurb: 'A southern Tucana dwarf, faint and far-flung.' },
// Not Andromeda II, despite the old Martin et al. alias.
{ id: 'galaxy:ufd:pisces-2', name: 'Pisces II', aliases: [], kind: 'galaxy', type: 'Ultra-faint dwarf (dSph)', constellation: 'Pisces', raDeg: 344.6292, decDeg: 5.9525, distanceMly: 0.5969, blurb: 'A faint Pisces dwarf in the outer halo.' },
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
    Distance: b.distanceMly >= 1
      ? `${b.distanceMly} million light-years`
      : `${Math.round(b.distanceMly * 1000)} thousand light-years`,
  },
  blurb: b.blurb,
}));

register(GALAXY_ENTRIES);

// Galactic-frame positions in PARSECS (float64), computed once at load.
const positionsPc = new Float64Array(BODIES.length * 3);
// Body diameters in parsecs, same source as resolveTarget's approachRadius
// (DIAMETER_LY, framing only) — drives the size-scaled sprite below.
const diametersPc = new Float64Array(BODIES.length);
const byId = new Map<string, number>();
BODIES.forEach((b, i) => {
  byId.set(b.id, i);
  const [x, y, z] = icrsPosition(b.raDeg, b.decDeg, b.distanceMly * PC_PER_MLY);
  positionsPc[i * 3] = x;
  positionsPc[i * 3 + 1] = y;
  positionsPc[i * 3 + 2] = z;
  diametersPc[i] = (DIAMETER_LY[b.id] ?? b.distanceMly * 1e6 * 0.4) / LY_PER_PC;
});

// Color by type: spirals cool blue-white, ellipticals gold, irregulars
// teal, dwarfs lavender, clusters magenta. Documented so the legend can
// reuse it. Elliptical is checked before dwarf so M32/M110 stay gold.
function colorFor(b: BodyDatum): THREE.Color {
  if (b.kind === 'cluster') return new THREE.Color(0xff9ecb);
  const t = b.type.toLowerCase();
  if (t.startsWith('elliptical')) return new THREE.Color(0xffd9a0);
  if (t.includes('irregular')) return new THREE.Color(0x9fe8d0);
  if (t.includes('dwarf')) return new THREE.Color(0xc4b5fd);
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
  // Body radius in parsecs. Unknown bodies fall back to the old rule
  // (40% of Sun-distance as diameter).
  const diameterLy = DIAMETER_LY[id] ?? b.distanceMly * 1e6 * 0.4;
  return {
    frameId: 'galactic',
    worldPos: new Float64Array([
      positionsPc[i * 3],
      positionsPc[i * 3 + 1],
      positionsPc[i * 3 + 2],
    ]),
    approachRadius: diameterLy / 2 / LY_PER_PC,
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
  // Per-point size in render units, refilled in update() alongside positions.
  const sizes = new Float32Array(n);
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  // Size-scaled sprites: each galaxy renders at its true angular size
  // (diameter / distance), so M31 at arrival fills ~a third of the view
  // instead of a fixed 6px dot. PointsMaterial can't do per-point size,
  // hence a ShaderMaterial with three's standard attenuation convention
  // (gl_PointSize ∝ size / distance × viewportHeight/2 — exact at fov 90°,
  // within ~2× for typical fovs). Clamped: max 40% of viewport height so a
  // galaxy you're inside doesn't white out the screen, min 2px so distant
  // dwarfs stay findable.
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: makeGlowTexture() },
      uScale: { value: 1 },
      uViewportH: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uScale;
      uniform float uViewportH;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float px = aSize * (uScale / -mvPosition.z);
        gl_PointSize = clamp(px, 2.0, uViewportH * 0.4);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor, 0.95) * tex;
      }
    `,
    vertexColors: true,
    transparent: true,
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
      const sizeAttr = geometry.getAttribute('aSize') as THREE.BufferAttribute;
      // Render units per galactic parsec — same scale toCameraRelative
      // applies to positions, so sizes and positions stay in one space.
      const scale = camera.layerScale('galactic');
      for (let i = 0; i < n; i++) {
        scratch[0] = positionsPc[i * 3];
        scratch[1] = positionsPc[i * 3 + 1];
        scratch[2] = positionsPc[i * 3 + 2];
        camera.toCameraRelative(scratch, 'galactic', tmpVec);
        attr.setXYZ(i, tmpVec.x, tmpVec.y, tmpVec.z);
        sizeAttr.setX(i, diametersPc[i] * scale);
      }
      attr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      // Viewport height in device pixels (drawing-buffer height) for the
      // attenuation math. Assumes a fullscreen canvas — main.ts can pass
      // renderer.getDrawingBufferSize() later for exactness.
      const viewportH = window.innerHeight * window.devicePixelRatio;
      material.uniforms.uScale.value = viewportH * 0.5;
      material.uniforms.uViewportH.value = viewportH;
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
