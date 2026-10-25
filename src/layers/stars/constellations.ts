
import * as THREE from 'three';
import type { CosmoCamera } from '../../core/camera';
import type { HygRow } from './catalog';

type Edge = readonly [string, string];

type Pattern = {
  name: string;
  edges: readonly Edge[];
};

// Traditional visual connections, not physical stellar bonds.
// Big Dipper is an asterism within Ursa Major.
const PATTERNS: readonly Pattern[] = [
  {
    name: 'Orion',
    edges: [
      ['Betelgeuse', 'Bellatrix'],
      ['Betelgeuse', 'Alnitak'],
      ['Bellatrix', 'Mintaka'],
      ['Alnitak', 'Alnilam'],
      ['Alnilam', 'Mintaka'],
      ['Alnitak', 'Saiph'],
      ['Mintaka', 'Rigel'],
      ['Saiph', 'Rigel'],
    ],
  },
  {
    name: 'Big Dipper',
    edges: [
      ['Dubhe', 'Merak'],
      ['Merak', 'Phecda'],
      ['Phecda', 'Megrez'],
      ['Megrez', 'Dubhe'],
      ['Megrez', 'Alioth'],
      ['Alioth', 'Mizar'],
      ['Mizar', 'Alkaid'],
    ],
  },
  {
    name: 'Cassiopeia',
    edges: [
      ['Caph', 'Schedar'],
      ['Schedar', 'Navi'],
      ['Navi', 'Ruchbah'],
      ['Ruchbah', 'Segin'],
    ],
  },
  {
    name: 'Cygnus',
    edges: [
      ['Deneb', 'Sadr'],
      ['Sadr', 'Albireo'],
      ['Sadr', 'Gienah'],
      ['Sadr', 'Delta Cygni'],
    ],
  },
];

const FADE_START_LY = 30;
const FADE_END_LY = 100;

function normalize(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

type Segment = {
  a: Float64Array;
  b: Float64Array;
};

export class StellarConstellations {
  readonly object3D = new THREE.Group();

  private segments: Segment[] = [];
  private geometry: THREE.BufferGeometry | null = null;
  private lines: THREE.LineSegments | null = null;

  private readonly material = new THREE.LineBasicMaterial({
    color: 0x84aaff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });

  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();

  constructor(private readonly camera: CosmoCamera) {
    this.object3D.name = 'stellar-constellations';
  }

  build(rows: readonly HygRow[]): void {
    this.clear();

    const byName = new Map<string, HygRow>();

    for (const row of rows) {
      for (const name of [row[7], ...row[8]]) {
        const key = normalize(name);
        if (key && !byName.has(key)) {
          byName.set(key, row);
        }
      }
    }

    const segmentKeys = new Set<string>();

    for (const pattern of PATTERNS) {
      for (const [nameA, nameB] of pattern.edges) {
        const a = byName.get(normalize(nameA));
        const b = byName.get(normalize(nameB));

        // The HYG subset may omit a constellation member.
        if (!a || !b || a[0] === b[0]) continue;

        const key = [a[0], b[0]]
          .sort((x, y) => x - y)
          .join(':');

        if (segmentKeys.has(key)) continue;
        segmentKeys.add(key);

        this.segments.push({
          a: new Float64Array([a[1], a[2], a[3]]),
          b: new Float64Array([b[1], b[2], b[3]]),
        });
      }
    }

    if (this.segments.length === 0) return;

    const positions = new Float32Array(
      this.segments.length * 6,
    );

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
        .setUsage(THREE.DynamicDrawUsage),
    );

    this.geometry.setDrawRange(
      0,
      this.segments.length * 2,
    );

    this.lines = new THREE.LineSegments(
      this.geometry,
      this.material,
    );

    // Geometry coordinates are camera-relative, so a
    // static bounding sphere would become stale.
    this.lines.frustumCulled = false;
    this.lines.name = 'HYG constellation connections';

    this.object3D.add(this.lines);
  }

  update(cameraDistanceLy: number, starFade: number): void {
    if (!this.lines || !this.geometry) return;

    const distanceFade = THREE.MathUtils.clamp(
      (FADE_END_LY - cameraDistanceLy) /
        (FADE_END_LY - FADE_START_LY),
      0,
      1,
    );

    const opacity = starFade * distanceFade * 0.35;

    if (opacity <= 0.001) {
      this.lines.visible = false;
      return;
    }

    this.lines.visible = true;
    this.material.opacity = opacity;

    const attr = this.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;

    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i];

      this.camera.toCameraRelative(
        segment.a,
        'galactic',
        this.scratchA,
      );

      this.camera.toCameraRelative(
        segment.b,
        'galactic',
        this.scratchB,
      );

      attr.setXYZ(
        i * 2,
        this.scratchA.x,
        this.scratchA.y,
        this.scratchA.z,
      );

      attr.setXYZ(
        i * 2 + 1,
        this.scratchB.x,
        this.scratchB.y,
        this.scratchB.z,
      );
    }

    attr.needsUpdate = true;
  }

  private clear(): void {
    this.lines?.removeFromParent();
    this.geometry?.dispose();

    this.lines = null;
    this.geometry = null;
    this.segments = [];
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }

  get segmentCount(): number {
    return this.segments.length;
  }
}

