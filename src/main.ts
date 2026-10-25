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
import { FlyToController, type FlyToTarget, type FlyToHandle } from './core/flyTo';
import { CosmoControls } from './core/controls';
import { LayerRegistry, type ScaleLayer } from './core/layers';
import { createStubOrbitLayer, type StubLayer } from './core/stubLayer';
import { createGalaxiesLayer, clustersRoute } from './layers/galaxies';
import { SolarSystemLayer } from './layers/solarSystemLayer';
import { makeStarsLayer } from './layers/stars';
import { linkDeepLinks } from './ui/deepLink';
import { makeZoneHud } from './ui/zone';
import { linkSearchToFlight, kindFromId, flightKind, type Flyer } from './ui/flyLink';
import { createTour } from './ui/tour';
import { mountHelp } from './ui/help';
import { mountConstellationToggle } from './ui/constellations';
import { mountHomeKey } from './ui/home';
import { orbitUpFor } from './ui/orbitUp';
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
registry.register(new SolarSystemLayer(scene, camera));
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

let currentFlight: FlyToHandle | null = null;
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
      // Solar-system arrivals orbit around ecliptic north (Claude's idea, Lumi).
      controls.setUp(orbitUpFor(r.frameId));
    }
    currentFlight = flight.flyTo(t, at ?? now);
    return currentFlight;
  },
};
const flyToPick = linkSearchToFlight(flyer, showInfoById, undefined, () => now);
// Deep links (#to=<id>): fly there once stars have loaded; each pick updates the URL.
const recordPick = linkDeepLinks(flyToPick, starsReady);
// Grand Tour (Lumi): button flies outward through the scales; any manual pick stops it.
const tourBtn = document.querySelector<HTMLButtonElement>('#tour');
const tour = createTour({
  fly(id) {
    const k = kindFromId(id);
    if (!k) return Promise.reject(new Error(`No layer kind for id: ${id}`));
    return flyer.flyTo({ kind: flightKind(k), id, approach: 'orbit' }, now).promise;
  },
  onStop(id) { recordPick(id); showInfoById(id); },
  onEnd() { tourBtn?.setAttribute('aria-pressed', 'false'); if (tourBtn) tourBtn.textContent = 'Grand Tour'; },
});
tourBtn?.addEventListener('click', () => {
  if (tour.running) { tour.stop(); return; }
  tourBtn.setAttribute('aria-pressed', 'true');
  tourBtn.textContent = 'Stop tour';
  tour.start();
});
const pickTarget = (id: string): void => { tour.stop(); recordPick(id); flyToPick(id); };
mountSearch(pickTarget, false);
// Home key (Lumi): H flies back to the Sun, same path as a search pick.
mountHomeKey(pickTarget);

// ---- navigation: Claude's CosmoControls (drag orbit, wheel/pinch log zoom, keys) ----
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const controls = new CosmoControls(camera, { reducedMotion });
controls.attach(renderer.domElement);
// Grabbing the view cancels a running flight and the Grand Tour.
// Claude's CosmoControls calls onUserInput even while disabled (PR #18), so no
// extra canvas listeners are needed (snippet from Claude, Dee's cancelFlight()).
controls.onUserInput(() => {
  tour.stop();
  if (flight.flying) {
    currentFlight?.cancel(); // harmless if it is the same flight (Claude's review)
    flight.cancelFlight();
    controls.enabled = true; // so this same input applies
  }
  currentFlight = null;
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
const zoneHud = makeZoneHud(document.querySelector<HTMLElement>('#zone'));
const SUN_POINT = { frame: 'galactic' as FrameId, position: SUN };
let last = -1;
renderer.setAnimationLoop((ms: number) => {
  now = ms / 1000;
  const dt = last < 0 ? 0 : Math.min(MAX_DT, now - last);
  last = now;

  flight.update(now);   // Dee: moves the camera along the log-space path
  controls.enabled = !flight.active; // Claude: controls stand down mid-flight
  controls.update(dt);  // Claude: eased orbit/zoom around the target
  camera.update();      // Claude: sync the three.js puppet before layers read it
  registry.update(dt);  // Dee: crossfades + per-layer update (camera-relative positions)

  if (scaleEl) {
    const tgt = camera.getTarget(hudTarget);
    scaleEl.textContent = tgt ? `Distance to target: ${formatDistance(camera.distanceTo(tgt))}` : '';
  }
  zoneHud(camera.distanceTo(SUN_POINT)); // Lumi: 'where am I' label
  renderer.render(scene, camera.three);
});

// Help overlay (Lumi): ? key or top-right button.
mountHelp();
// Constellation toggle (Lumi, GPT-6's handoff): C key or top-right button.
mountConstellationToggle((mode) => stars.setConstellationMode(mode));
