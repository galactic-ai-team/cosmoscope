import * as THREE from 'three';
import { ScaleLayer, LayerApi } from '../core/layers';

interface PlanetData {
  name: string;
  id: string;
  radius: number; // thousand km
  semiMajorAxis: number; // AU (Keplerian element a)
  eccentricity: number; // orbital eccentricity (e)
  inclination: number; // orbital inclination in degrees (i)
  meanAnomaly0: number; // mean anomaly at epoch in degrees (M0)
  meanMotion: number; // degrees per Earth day (n)
  orbitPeriod: number; // Earth years
  color: number;
  moons?: { name: string; id: string; distance: number; radius: number; color: number; speed: number }[];
}

const PLANETS: PlanetData[] = [
  { name: 'Mercury', id: 'planet:mercury', radius: 2.4, semiMajorAxis: 0.387, eccentricity: 0.2056, inclination: 7.0, meanAnomaly0: 174.79, meanMotion: 4.0923344, orbitPeriod: 0.24, color: 0x888888 },
  { name: 'Venus', id: 'planet:venus', radius: 6.05, semiMajorAxis: 0.723, eccentricity: 0.0067, inclination: 3.39, meanAnomaly0: 50.115, meanMotion: 1.6021303, orbitPeriod: 0.62, color: 0xe3bb76 },
  { 
    name: 'Earth', 
    id: 'planet:earth', 
    radius: 6.37, 
    semiMajorAxis: 1.0, 
    eccentricity: 0.0167, 
    inclination: 0.0, 
    meanAnomaly0: 357.517, 
    meanMotion: 0.9856091, 
    orbitPeriod: 1.0, 
    color: 0x2233ff, 
    moons: [
      { name: 'Moon', id: 'moon:earth-moon', distance: 0.05, radius: 1.73, color: 0xaaaaaa, speed: 12.0 }
    ] 
  },
  { 
    name: 'Mars', 
    id: 'planet:mars', 
    radius: 3.39, 
    semiMajorAxis: 1.524, 
    eccentricity: 0.0934, 
    inclination: 1.85, 
    meanAnomaly0: 19.373, 
    meanMotion: 0.5240330, 
    orbitPeriod: 1.88, 
    color: 0xc1440e, 
    moons: [
      { name: 'Phobos', id: 'moon:phobos', distance: 0.025, radius: 0.6, color: 0x887766, speed: 20.0 },
      { name: 'Deimos', id: 'moon:deimos', distance: 0.04, radius: 0.4, color: 0x776655, speed: 15.0 }
    ] 
  },
  { name: 'Jupiter', id: 'planet:jupiter', radius: 69.9, semiMajorAxis: 5.204, eccentricity: 0.0484, inclination: 1.30, meanAnomaly0: 20.020, meanMotion: 0.0830853, orbitPeriod: 11.86, color: 0xb07f35 },
  { name: 'Saturn', id: 'planet:saturn', radius: 58.2, semiMajorAxis: 9.582, eccentricity: 0.0555, inclination: 2.49, meanAnomaly0: 317.020, meanMotion: 0.0334441, orbitPeriod: 29.46, color: 0xe2bf7d },
  { name: 'Uranus', id: 'planet:uranus', radius: 25.3, semiMajorAxis: 19.201, eccentricity: 0.0463, inclination: 0.77, meanAnomaly0: 142.238, meanMotion: 0.0117315, orbitPeriod: 84.01, color: 0x73b7e6 },
  { name: 'Neptune', id: 'planet:neptune', radius: 24.6, semiMajorAxis: 30.047, eccentricity: 0.0095, inclination: 1.77, meanAnomaly0: 256.228, meanMotion: 0.0059811, orbitPeriod: 164.8, color: 0x3d6dfd }
];

export class SolarSystemLayer implements ScaleLayer {
  public idPrefix = 'planet:';
  public frames = ['heliocentric'];
  public minZoom = 1e3;
  public maxZoom = 1e12;
  public renderBudget = 'low' as const;

  private container: THREE.Group;
  private planetMeshes: { 
    mesh: THREE.Mesh; 
    pivot: THREE.Group; 
    semiMajorAxis: number; 
    eccentricity: number; 
    meanAnomaly0: number; 
    meanMotion: number;
    moons?: { mesh: THREE.Mesh; pivot: THREE.Group; speed: number }[] 
  }[] = [];
  private sunMesh!: THREE.Mesh;
  private api: LayerApi | null = null;
  private simTimeDays = 0;

  constructor() {
    this.container = new THREE.Group();
    this.container.name = 'SolarSystemLayer';
  }

  public enter(api: LayerApi): void {
    this.api = api;
    const scene = api.scene;

    // 1. Create Sun
    const sunGeo = new THREE.SphereGeometry(15, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.sunMesh.name = 'star:sol:sun';
    this.container.add(this.sunMesh);

    // Register Sun in catalog for search/fly-to
    this.api.register({
      id: 'star:sol:sun',
      kind: 'star',
      name: 'Sun',
      position: new THREE.Vector3(0, 0, 0),
      radius: 15
    });

    // Sun light
    const sunLight = new THREE.PointLight(0xffffff, 2, 1000);
    this.container.add(sunLight);

    // 2. Create Planets and Moons
    PLANETS.forEach((data) => {
      const pivot = new THREE.Group();
      this.container.add(pivot);

      const scaledDist = data.semiMajorAxis * 25; 
      const scaledRadius = Math.max(data.radius * 0.2, 0.8);

      const planetGeo = new THREE.SphereGeometry(scaledRadius, 24, 24);
      const planetMat = new THREE.MeshStandardMaterial({ 
        color: data.color,
        roughness: 0.8,
        metalness: 0.1
      });
      const planetMesh = new THREE.Mesh(planetGeo, planetMat);
      planetMesh.position.x = scaledDist;
      planetMesh.name = data.id;
      pivot.add(planetMesh);

      // Register planet in catalog for search/fly-to
      const initialPos = new THREE.Vector3(scaledDist, 0, 0);
      this.api?.register({
        id: data.id,
        kind: 'planet',
        name: data.name,
        position: initialPos,
        radius: scaledRadius
      });

      // Orbit line visualization
      const orbitGeo = new THREE.BufferGeometry();
      const points = [];
      const segments = 128;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(theta) * scaledDist, 0, Math.sin(theta) * scaledDist));
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

          const moonGeo = new THREE.SphereGeometry(Math.max(moonData.radius * 0.3, 0.4), 16, 16);
          const moonMat = new THREE.MeshStandardMaterial({ color: moonData.color });
          const moonMesh = new THREE.Mesh(moonGeo, moonMat);
          const moonDist = scaledRadius + moonData.distance * 4;
          moonMesh.position.x = moonDist;
          moonPivot.add(moonMesh);

          this.api?.register({
            id: moonData.id,
            kind: 'moon',
            name: moonData.name,
            position: initialPos.clone().add(new THREE.Vector3(moonDist, 0, 0)),
            radius: moonData.radius * 0.3
          });

          moonEntries.push({ mesh: moonMesh, pivot: moonPivot, speed: moonData.speed });
        });
      }

      this.planetMeshes.push({
        mesh: planetMesh,
        pivot: pivot,
        semiMajorAxis: scaledDist,
        eccentricity: data.eccentricity,
        meanAnomaly0: data.meanAnomaly0,
        meanMotion: data.meanMotion,
        moons: moonEntries
      });
    });

    scene.add(this.container);
  }

  public update(dt: number, _distance: number, _api: LayerApi): void {
    // Advance simulation time (accelerated seconds to days)
    this.simTimeDays += dt * 5.0;

    if (this.sunMesh) {
      this.sunMesh.rotation.y += dt * 0.05;
    }

    this.planetMeshes.forEach((item) => {
      // Keplerian mean anomaly propagation: M = M0 + n * t
      const M = (item.meanAnomaly0 + item.meanMotion * this.simTimeDays) * (Math.PI / 180);
      
      // Kepler's Equation approximation for eccentric anomaly E (E - e*sin(E) = M)
      let E = M;
      for (let iter = 0; iter < 3; iter++) {
        E = M + item.eccentricity * Math.sin(E);
      }

      // True anomaly v and heliocentric distance r
      const xv = item.semiMajorAxis * (Math.cos(E) - item.eccentricity);
      const zv = item.semiMajorAxis * Math.sqrt(1 - item.eccentricity * item.eccentricity) * Math.sin(E);

      item.mesh.position.x = xv;
      item.mesh.position.z = zv;
      item.mesh.rotation.y += dt * 0.5;

      if (item.moons) {
        item.moons.forEach((moon) => {
          moon.pivot.rotation.y += dt * moon.speed * 0.1;
        });
      }
    });
  }

  public resolveTarget(id: string): THREE.Vector3 | null {
    const found = this.planetMeshes.find(p => p.mesh.name === id);
    if (found) {
      return found.mesh.position;
    }
    if (id === 'star:sol:sun' && this.sunMesh) {
      return this.sunMesh.position;
    }
    return null;
  }

  public exit(_scene: THREE.Scene): void {
    if (this.container.parent) {
      this.container.parent.remove(this.container);
    }
    this.planetMeshes.forEach((item) => {
      item.mesh.geometry.dispose();
      if (Array.isArray(item.mesh.material)) {
        item.mesh.material.forEach(m => m.dispose());
      } else {
        item.mesh.material.dispose();
      }
    });
    if (this.sunMesh) {
      this.sunMesh.geometry.dispose();
      (this.sunMesh.material as THREE.Material).dispose();
    }
  }
}

