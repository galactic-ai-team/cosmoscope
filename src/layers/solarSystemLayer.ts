import * as THREE from 'three';

// ScaleLayer interface contract conforming to docs/CONTRACTS.md
export interface ScaleLayer {
  id: string;
  minZoom: number;
  maxZoom: number;
  init(scene: THREE.Scene): void;
  update(camera: THREE.Camera, zoomLevel: number, dt: number): void;
  dispose(scene: THREE.Scene): void;
}

interface PlanetData {
  name: string;
  id: string;
  radius: number; // in thousand km, scaled for visualization
  distance: number; // in AU, scaled
  orbitPeriod: number; // in Earth years
  color: number;
  moons?: { name: string; distance: number; radius: number; color: number; speed: number }[];
}

const PLANETS: PlanetData[] = [
  { name: 'Mercury', id: 'sol:nasa:mercury', radius: 2.4, distance: 0.39, orbitPeriod: 0.24, color: 0x888888 },
  { name: 'Venus', id: 'sol:nasa:venus', radius: 6.05, distance: 0.72, orbitPeriod: 0.62, color: 0xe3bb76 },
  { name: 'Earth', id: 'sol:nasa:earth', radius: 6.37, distance: 1.0, orbitPeriod: 1.0, color: 0x2233ff, moons: [
    { name: 'Moon', distance: 0.05, radius: 1.73, color: 0xaaaaaa, speed: 12.0 }
  ]},
  { name: 'Mars', id: 'sol:nasa:mars', radius: 3.39, distance: 1.52, orbitPeriod: 1.88, color: 0xc1440e, moons: [
    { name: 'Phobos', distance: 0.025, radius: 0.6, color: 0x887766, speed: 20.0 },
    { name: 'Deimos', distance: 0.04, radius: 0.4, color: 0x776655, speed: 15.0 }
  ]},
  { name: 'Jupiter', id: 'sol:nasa:jupiter', radius: 69.9, distance: 5.2, orbitPeriod: 11.86, color: 0xb07f35 },
  { name: 'Saturn', id: 'sol:nasa:saturn', radius: 58.2, distance: 9.58, orbitPeriod: 29.46, color: 0xe2bf7d },
  { name: 'Uranus', id: 'sol:nasa:uranus', radius: 25.3, distance: 19.22, orbitPeriod: 84.01, color: 0x73b7e6 },
  { name: 'Neptune', id: 'sol:nasa:neptune', radius: 24.6, distance: 30.05, orbitPeriod: 164.8, color: 0x3d6dfd }
];

export class SolarSystemLayer implements ScaleLayer {
  public id = 'sol:nasa:sol-system';
  public minZoom = 1e3; // Visible from inner stellar neighborhood down to planetary scale
  public maxZoom = 1e12;

  private container: THREE.Group;
  private planetMeshes: { mesh: THREE.Mesh; pivot: THREE.Group; distance: number; period: number; moons?: { mesh: THREE.Mesh; pivot: THREE.Group; speed: number }[] }[] = [];
  private sunMesh!: THREE.Mesh;

  constructor() {
    this.container = new THREE.Group();
    this.container.name = 'SolarSystemLayer';
  }

  public init(scene: THREE.Scene): void {
    // 1. Create Sun
    const sunGeo = new THREE.SphereGeometry(15, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.sunMesh.name = 'sol:nasa:sun';
    this.container.add(this.sunMesh);

    // Sun glow light
    const sunLight = new THREE.PointLight(0xffffff, 2, 1000);
    this.container.add(sunLight);

    // 2. Create Planets and Moons
    PLANETS.forEach((data) => {
      const pivot = new THREE.Group();
      this.container.add(pivot);

      // Scale distance for visual clarity (log-ish or linear adjusted AU scale)
      const scaledDist = data.distance * 25; 
      const scaledRadius = Math.max(data.radius * 0.2, 0.8); // ensure visibility

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

      // Handle Moons if present
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

          moonEntries.push({ mesh: moonMesh, pivot: moonPivot, speed: moonData.speed });
        });
      }

      this.planetMeshes.push({
        mesh: planetMesh,
        pivot: pivot,
        distance: scaledDist,
        period: data.orbitPeriod,
        moons: moonEntries
      });
    });

    scene.add(this.container);
  }

  public update(camera: THREE.Camera, zoomLevel: number, dt: number): void {
    // Rotate Sun slowly
    if (this.sunMesh) {
      this.sunMesh.rotation.y += dt * 0.05;
    }

    // Animate orbits based on orbital period & real time delta
    const timeFactor = 0.2;
    this.planetMeshes.forEach((item) => {
      const orbitSpeed = (1 / item.period) * timeFactor * dt;
      item.pivot.rotation.y += orbitSpeed;

      // Self rotation
      item.mesh.rotation.y += dt * 0.5;

      // Animate moons
      if (item.moons) {
        item.moons.forEach((moon) => {
          moon.pivot.rotation.y += dt * moon.speed * 0.1;
        });
      }
    });
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.container);
    this.planetMeshes.forEach((item) => {
      item.mesh.geometry.dispose();
      if (Array.isArray(item.mesh.material)) {
        item.mesh.material.forEach(m => m.dispose());
      } else {
        item.mesh.material.dispose();
      }
    });
    this.sunMesh.geometry.dispose();
    (this.sunMesh.material as THREE.Material).dispose();
  }
}

