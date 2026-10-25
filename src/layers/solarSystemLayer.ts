import * as THREE from 'three';
import { ScaleLayer } from '../core/layers';
import { FrameApi } from '../core/camera';
import { FrameId } from '../core/frames';
import type { CosmoCamera } from '../core/camera';
import { register, CatalogEntry } from '../catalog';

interface PlanetData {
  name: string;
  id: string;
  radius: number; // thousand km
  semiMajorAxis: number; // AU
  eccentricity: number; // orbital eccentricity
  inclination: number; // orbital inclination in degrees
  meanAnomalyJ2000: number; // mean anomaly at J2000 epoch in degrees
  meanMotion: number; // degrees per Earth day
  orbitPeriod: number; // Earth years
  color: number;
  moons?: { name: string; id: string; distance: number; radius: number; color: number; speed: number }[];
}

const PLANETS: PlanetData[] = [
  { name: 'Mercury', id: 'planet:mercury', radius: 2.4, semiMajorAxis: 0.387, eccentricity: 0.2056, inclination: 7.0, meanAnomalyJ2000: 174.79, meanMotion: 4.0923344, orbitPeriod: 0.24, color: 0x888888 },
  { name: 'Venus', id: 'planet:venus', radius: 6.05, semiMajorAxis: 0.723, eccentricity: 0.0067, inclination: 3.39, meanAnomalyJ2000: 50.115, meanMotion: 1.6021303, orbitPeriod: 0.62, color: 0xe3bb76 },
  { 
    name: 'Earth', 
    id: 'planet:earth', 
    radius: 6.37, 
    semiMajorAxis: 1.0, 
    eccentricity: 0.0167, 
    inclination: 0.0, 
    meanAnomalyJ2000: 357.517, 
    meanMotion: 0.9856091, 
    orbitPeriod: 1.0, 
    color: 0x2233ff, 
    moons: [
      { name: 'Moon', id: 'moon:earth-moon', distance: 0.02, radius: 1.73, color: 0xaaaaaa, speed: 12.0 }
    ] 
  },
  { 
    name: 'Mars', 
    id: 'planet:mars', 
    radius: 3.39, 
    semiMajorAxis: 1.524, 
    eccentricity: 0.0934, 
    inclination: 1.85, 
    meanAnomalyJ2000: 19.373, 
    meanMotion: 0.5240330, 
    orbitPeriod: 1.88, 
    color: 0xc1440e, 
    moons: [
      { name: 'Phobos', id: 'moon:phobos', distance: 0.015, radius: 0.6, color: 0x887766, speed: 20.0 },
      { name: 'Deimos', id: 'moon:deimos', distance: 0.025, radius: 0.4, color: 0x776655, speed: 15.0 }
    ] 
  },
  { name: 'Jupiter', id: 'planet:jupiter', radius: 69.9, semiMajorAxis: 5.204, eccentricity: 0.0484, inclination: 1.30, meanAnomalyJ2000: 20.020, meanMotion: 0.0830853, orbitPeriod: 11.86, color: 0xb07f35 },
  { name: 'Saturn', id: 'planet:saturn', radius: 58.2, semiMajorAxis: 9.582, eccentricity: 0.0555, inclination: 2.49, meanAnomalyJ2000: 317.020, meanMotion: 0.0334441, orbitPeriod: 29.46, color: 0xe2bf7d },
  { name: 'Uranus', id: 'planet:uranus', radius: 25.3, semiMajorAxis: 19.201, eccentricity: 0.0463, inclination: 0.77, meanAnomalyJ2000: 142.238, meanMotion: 0.0117315, orbitPeriod: 84.01, color: 0x73b7e6 },
  { name: 'Neptune', id: 'planet:neptune', radius: 24.6, semiMajorAxis: 30.047, eccentricity: 0.0095, inclination: 1.77, meanAnomalyJ2000: 256.228, meanMotion: 0.0059811, orbitPeriod: 164.8, color: 0x3d6dfd }
];

export class SolarSystemLayer implements ScaleLayer {
  public idPrefix = 'planet';
  public frames: FrameId[] = ['helio'];
  public minZoom = 1e3;
  public maxZoom = 1e12;
  public renderBudget = 10;

  private container: THREE.Group;
  private planetMeshes: { 
    mesh: THREE.Mesh; 
    pivot: THREE.Group; 
    semiMajorAxis: number; 
    eccentricity: number; 
    meanAnomalyJ2000: number; 
    meanMotion: number;
    approachRadius: number;
    moons?: { mesh: THREE.Mesh; pivot: THREE.Group; speed: number }[] 
  }[] = [];
  private sunMesh!: THREE.Mesh;
  private scene: THREE.Scene;
  private camera?: CosmoCamera;
  private static readonly ORIGIN = new Float64Array([0, 0, 0]);
  private daysSinceJ2000 = 0;
  private isInitialized = false;

  constructor(scene: THREE.Scene, camera?: CosmoCamera) {
    this.scene = scene;
    this.camera = camera;
    this.container = new THREE.Group();
    this.container.name = 'SolarSystemLayer';

    // Compute exact days elapsed from J2000.0 epoch to current date
    const j2000Epoch = Date.UTC(2000, 0, 1, 12, 0, 0);
    const now = Date.now();
    this.daysSinceJ2000 = (now - j2000Epoch) / (1000 * 60 * 60 * 24);

    this.buildSolarSystem();
  }

  private buildSolarSystem(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 1. Create Sun at origin (0,0,0) AU with minimum visible radius in AU space
    const sunRadiusAU = 0.08;
    const sunGeo = new THREE.SphereGeometry(sunRadiusAU, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.sunMesh.name = 'star:sol:sun';
    this.container.add(this.sunMesh);

    // Sun light
    const sunLight = new THREE.PointLight(0xffffff, 2, 50);
    this.container.add(sunLight);

    const catalogEntries: CatalogEntry[] = [];

    // 2. Create Planets and Moons positioned in pure AU coordinates
    PLANETS.forEach((data) => {
      const pivot = new THREE.Group();
      this.container.add(pivot);

      const auDist = data.semiMajorAxis; 
      // Ensure minimum visible on-screen size in AU coordinate space so small planets remain clear
      const auRadius = Math.max(data.radius * 0.002, 0.025);

      const planetGeo = new THREE.SphereGeometry(auRadius, 24, 24);
      const planetMat = new THREE.MeshStandardMaterial({ 
        color: data.color,
        roughness: 0.8,
        metalness: 0.1
      });
      const planetMesh = new THREE.Mesh(planetGeo, planetMat);
      planetMesh.position.x = auDist;
      planetMesh.name = data.id;
      pivot.add(planetMesh);

      catalogEntries.push({
        id: data.id,
        name: data.name,
        kind: 'planet',
        distanceM: data.semiMajorAxis * 1.496e11,
        blurb: `${data.name} is a planet in our Solar System.`
      });

      // Orbit line in AU
      const orbitGeo = new THREE.BufferGeometry();
      const points = [];
      const segments = 128;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(theta) * auDist, 0, Math.sin(theta) * auDist));
      }
      orbitGeo.setFromPoints(points);
      const orbitMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });
      const orbitLine = new THREE.Line(orbitGeo, orbitMat);
      this.container.add(orbitLine);

      // Handle Moons
      let moonEntries: { mesh: THREE.Mesh; pivot: THREE.Group; speed: number }[] = [];
      if (data.moons) {
        data.moons.forEach((moonData) => {
          const moonPivot = new THREE.Group();
          planetMesh.add(moonPivot);

          const moonAuRadius = Math.max(moonData.radius * 0.0015, 0.01);
          const moonGeo = new THREE.SphereGeometry(moonAuRadius, 16, 16);
          const moonMat = new THREE.MeshStandardMaterial({ color: moonData.color });
          const moonMesh = new THREE.Mesh(moonGeo, moonMat);
          const moonAuDist = auRadius + moonData.distance;
          moonMesh.position.x = moonAuDist;
          moonPivot.add(moonMesh);

          catalogEntries.push({
            id: moonData.id,
            name: moonData.name,
            kind: 'planet',
            distanceM: (data.semiMajorAxis * 1.496e11) + (moonData.distance * 1.496e11),
            blurb: `Natural satellite of ${data.name}.`
          });

          moonEntries.push({ mesh: moonMesh, pivot: moonPivot, speed: moonData.speed });
        });
      }

      this.planetMeshes.push({
        mesh: planetMesh,
        pivot: pivot,
        semiMajorAxis: data.semiMajorAxis,
        eccentricity: data.eccentricity,
        meanAnomalyJ2000: data.meanAnomalyJ2000,
        meanMotion: data.meanMotion,
        approachRadius: auRadius * 3.0,
        moons: moonEntries
      });
    });

    register(catalogEntries);
  }

  public enter(_api: FrameApi): void {
    if (!this.container.parent) {
      this.scene.add(this.container);
    }
  }

  public update(dt: number): void {
    this.daysSinceJ2000 += dt * 5.0;

    // Lumi: Claude's camera recipe. Meshes are authored in AU around the Sun,
    // so place the container camera-relative and scale AU to render units.
    // Without this the container sits at render origin (the camera) and
    // planets are off-screen when you arrive.
    if (this.camera) {
      this.camera.toCameraRelative(SolarSystemLayer.ORIGIN, 'helio', this.container.position);
      this.container.scale.setScalar(this.camera.layerScale('helio'));
    }

    if (this.sunMesh) {
      this.sunMesh.rotation.y += dt * 0.05;
    }

    this.planetMeshes.forEach((item) => {
      const M = (item.meanAnomalyJ2000 + item.meanMotion * this.daysSinceJ2000) * (Math.PI / 180);
      
      let E = M;
      for (let iter = 0; iter < 3; iter++) {
        E = M + item.eccentricity * Math.sin(E);
      }

      // Compute exact heliocentric positions in AU
      const xAU = item.semiMajorAxis * (Math.cos(E) - item.eccentricity);
      const zAU = item.semiMajorAxis * Math.sqrt(1 - item.eccentricity * item.eccentricity) * Math.sin(E);

      item.mesh.position.x = xAU;
      item.mesh.position.z = zAU;
      item.mesh.rotation.y += dt * 0.5;

      if (item.moons) {
        item.moons.forEach((moon) => {
          moon.pivot.rotation.y += dt * moon.speed * 0.1;
        });
      }
    });
  }

  public resolveTarget(id: string) {
    const planetIndex = PLANETS.findIndex(p => p.id === id);
    if (planetIndex !== -1) {
      const data = PLANETS[planetIndex];
      const M = (data.meanAnomalyJ2000 + data.meanMotion * this.daysSinceJ2000) * (Math.PI / 180);
      let E = M;
      for (let iter = 0; iter < 3; iter++) {
        E = M + data.eccentricity * Math.sin(E);
      }
      const xAU = data.semiMajorAxis * (Math.cos(E) - data.eccentricity);
      const zAU = data.semiMajorAxis * Math.sqrt(1 - data.eccentricity * data.eccentricity) * Math.sin(E);

      const worldPos = new Float64Array([xAU, 0, zAU]);
      const foundMesh = this.planetMeshes.find(p => p.mesh.name === id);
      const approachRadius = foundMesh ? foundMesh.approachRadius : 0.1;

      return {
        frameId: 'helio' as FrameId,
        worldPos,
        approachRadius
      };
    }

    if (id === 'star:sol:sun') {
      const worldPos = new Float64Array([0, 0, 0]);
      return {
        frameId: 'helio' as FrameId,
        worldPos,
        approachRadius: 0.2
      };
    }

    return null;
  }

  public exit(): void {
    if (this.container.parent) {
      this.container.parent.remove(this.container);
    }
  }
}