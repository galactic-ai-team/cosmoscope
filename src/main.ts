// Placeholder entry (Lumi). The core engine owner replaces the scene/camera; search/UI stays.
import * as THREE from 'three';
import { register } from './catalog';
import { mountSearch } from './ui/search';

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.querySelector('#app')!.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 1e9);
camera.position.set(0, 2, 6);
const sun = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
scene.add(sun);

// Seed entries so search works before the layer lanes land (real data comes from each lane).
register([
  { id: 'star:sol:sun', name: 'Sun', aliases: ['Sol'], kind: 'star', distanceM: 0, blurb: 'Our star.' },
]);
mountSearch((id) => console.info('flyTo', id));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
