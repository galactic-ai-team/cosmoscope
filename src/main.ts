// Cosmoscope entry point (Lumi). Owns the renderer, the render loop and the
// wiring between lanes. It only imports other lanes' public APIs:
//   Claude: FrameStack + CosmoCamera (src/core/frames.ts, camera.ts), stub layers
//   Dee:    LayerRegistry + FlyToController (src/core/layers.ts, flyTo.ts)
//   GPT-6:  StellarNeighborhood (src/layers/stars)
//   Nova:   createGalaxiesLayer + clustersRoute (src/layers/galaxies.ts)
//   Lumi:   catalog, search box, info panel, search -> flyTo bridge
// Loop clock: seconds, dt clamped to 0.1 s (Claude's spec), shared with flyTo.
import * as THREE from 'three';

import { register } from './catalog';
import { CosmoCamera, RENDERER_OPTIONS } from './core/camera';
import { FrameStack, type FrameId } from './core/frames';
import { FlyToController, type FlyToTarget } from './core/flyTo';
import { LayerRegistry, type ScaleLayer } from './core/layers';
import { createStubOrbitLayer, createStubPlanetLayer, type StubLayer } from './core/stubLayer';
import { createGalaxiesLayer, clustersRoute } from './layers/galaxies';
import { makeStarsLayer } from './layers/stars';
import { linkDeepLinks } from './ui/deepLink';
import { linkSearchToFlight, type Flyer } from './ui/flyLink';
import { formatDistance, mountSearch, showInfoById } from './ui/search';

const MAX_DT = 0.1;
const HYG_URL = '/data/hyg-v41.json';

// ---- renderer, scene, camera (Claude's core) --------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, ...RENDERER_OPTIONS });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.querySelector('#app')!.append(renderer.domElement);

const scene = new THREE.Scene();
const frames = new FrameStack();
const camera = new CosmoCamera(frames, undefined, 'galactic');
camera.three.aspect = innerWidth / innerHeight;
camera.three.updateProjectionMatrix();

// Start ~50 pc from the Sun, looking at it, ICRS north up.
const SUN: Float64Array = new Float64Array(3);
camera.setPose({
  frame: 'galactic',
  position: [0, -45, 20],
  target: { frame: 'galactic', position: SUN },
  up: [0, 0, 1],
});

// Sun entry so search works even when the HYG file is missing (stars re-register it on load).
register([
  { id: 'star:sol:sun', name: 'Sun', aliases: ['Sol'], kind: 'star', distanceM: 0, blurb: 'Our star.' },
]);

// ---- layers (Dee's registry) --------------------------------------------------
const registry = new LayerRegistry(camera);

/** Claude's stub layers are not ScaleLayers; wrap them without touching core/stubLayer.ts. */
function adaptStub(stub: StubLayer, extraFrames: FrameId[] = []): ScaleLayer {
  return {
    idPrefix: stub.id,
    frames: [stub.frame, ...extraFrames],
    renderBudget: 1,
    enter: () => { scene.add(stub.object3D); },
    exit: () => { stub.object3D.removeFromParent(); },
    update: () => stub.update(camera),
    resolveTarget: () => null,
  };
}

// Nova's galaxies layer implements ScaleLayer directly (createGalaxiesLayer + clustersRoute).
registry.register(createGalaxiesLayer(scene, camera));
registry.register(clustersRoute);
registry.register(adaptStub(createStubPlanetLayer()));
registry.register(adaptStub(createStubOrbitLayer(), ['galactic']));

// GPT-6's stars: register only after load settles, because enter() attaches the mesh
// only if it already exists. Missing HYG JSON is not fatal: the layer still resolves the Sun.
const stars = makeStarsLayer(scene, camera);
const starsReady = stars.load(HYG_URL)
  .then((n) => console.info(`stars: ${n} HYG stars loaded`))
  .catch((err) => console.warn(`stars: HYG data unavailable (${HYG_URL}), running without the star field`, err))
  .finally(() => registry.register(stars));

// ---- flyTo + search (Lumi's bridge, Dee's controller) -------------------------
const flight = new FlyToController(camera, registry);
let now = performance.now() / 1000; // loop clock, seconds

/** Point the camera at the target as the flight starts (flyTo moves position only). */
const flyer: Flyer = {
  flyTo(t: FlyToTarget, at?: number) {
    const r = registry.resolveTarget(t.id);
    if (r) {
      camera.setPose({
        frame: camera.getFrameId(),
        position: camera.getCameraWorldPosition(),
        target: { frame: r.frameId, position: r.worldPos },
      });
    }
    return flight.flyTo(t, at ?? now);
  },
};
const flyToPick = linkSearchToFlight(flyer, showInfoById, undefined, () => now);
// Deep links (#to=<id>): fly there once stars have loaded; each pick updates the URL.
const recordPick = linkDeepLinks(flyToPick, starsReady);
mountSearch((id) => { recordPick(id); flyToPick(id); }, false);

// ---- simple navigation: wheel = log zoom toward target, drag = orbit ---------
const tmpTarget = new Float64Array(3);
const tmpCam = new Float64Array(3);
function orbitBy(zoom: number, dAz: number, dEl: number): void {
  const tgt = camera.getTarget(tmpTarget);
  if (!tgt || flight.active) return;
  const f = camera.getFrameId();
  const t = frames.toFrame(tgt.position, tgt.frame, f, new Float64Array(3));
  camera.getCameraWorldPosition(f, tmpCam);
  const x = tmpCam[0] - t[0], y = tmpCam[1] - t[1], z = tmpCam[2] - t[2];
  const r = Math.hypot(x, y, z) * zoom;
  if (!(r > 0)) return;
  const az = Math.atan2(y, x) + dAz;
  const el = Math.max(-1.5, Math.min(1.5, Math.asin(z / Math.hypot(x, y, z)) + dEl));
  camera.setCameraWorldPosition([
    t[0] + r * Math.cos(el) * Math.cos(az),
    t[1] + r * Math.cos(el) * Math.sin(az),
    t[2] + r * Math.sin(el),
  ], f);
}
const canvas = renderer.domElement;
canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); orbitBy(Math.exp(ev.deltaY * 0.0015), 0, 0); }, { passive: false });
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (ev) => { drag = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  orbitBy(1, -(ev.clientX - drag.x) * 0.005, (ev.clientY - drag.y) * 0.005);
  drag = { x: ev.clientX, y: ev.clientY };
});

// ---- resize -----------------------------------------------------------------
addEventListener('resize', () => {
  camera.three.aspect = innerWidth / innerHeight;
  camera.three.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- render loop (main.ts owns it) --------------------------------------------
const scaleEl = document.querySelector<HTMLElement>('#scale');
const hudTarget = new Float64Array(3);
let last = -1;
renderer.setAnimationLoop((ms: number) => {
  now = ms / 1000;
  const dt = last < 0 ? 0 : Math.min(MAX_DT, now - last);
  last = now;

  flight.update(now);   // Dee: moves the camera along the log-space path
  camera.update();      // Claude: sync the three.js puppet before layers read it
  registry.update(dt);  // Dee: crossfades + per-layer update (camera-relative positions)

  if (scaleEl) {
    const tgt = camera.getTarget(hudTarget);
    scaleEl.textContent = tgt ? `Distance to target: ${formatDistance(camera.distanceTo(tgt))}` : '';
  }
  renderer.render(scene, camera.three);
});
