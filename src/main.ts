// Cosmoscope entry point (Lumi). Owns the renderer, the render loop and the
// wiring between lanes. It only imports other lanes' public APIs:
//   Claude: FrameStack + CosmoCamera (src/core/frames.ts, camera.ts), stub layers
//   Dee:    LayerRegistry + FlyToController (src/core/layers.ts, flyTo.ts)
//   GPT-6:  StellarNeighborhood (src/layers/stars)
//   Nova:   createGalaxiesLayer + clustersRoute (src/layers/galaxies.ts)
//   Lumi:   catalog, search box, info panel, search -> flyTo bridge
// Loop clock: seconds, dt clamped to 0.1 s (Claude's spec), shared with flyTo.
import * as THREE from 'three';

import { get as getCatalogEntry, register } from './catalog';
import { CosmoCamera, RENDERER_OPTIONS } from './core/camera';
import { FrameStack, type FrameId } from './core/frames';
import { FlyToController, type FlyToTarget, type FlyToHandle } from './core/flyTo';
import { CosmoControls } from './core/controls';
import { LayerRegistry, type ScaleLayer } from './core/layers';
import { createStubOrbitLayer, type StubLayer } from './core/stubLayer';
import { createGalaxiesLayer, clustersRoute, nearestGalaxy } from './layers/galaxies';
import { createCosmicWebLayer } from './layers/cosmicWebLayer';
import { MILKY_WAY_ID, createProceduralGalaxiesLayer, milkyWayViewDir, ngpUnit } from './ui/proceduralGalaxies';
import { SolarSystemLayer } from './layers/solarSystemLayer';
import { makeStarsLayer } from './layers/stars';
import { linkDeepLinks } from './ui/deepLink';
import {
  loadExoplanetSystems,
} from './layers/exoplanets/catalog';

import {
  makeExoplanetSystemsLayer,
} from './layers/exoplanets';
import { makeZoneHud } from './ui/zone';
import { linkSearchToFlight, kindFromId, flightKind, type Flyer } from './ui/flyLink';
import { createTour } from './ui/tour';
import { mountHelp } from './ui/help';
import { mountConstellationToggle } from './ui/constellations';
import { mountHomeKey } from './ui/home';
import { orbitUpFor } from './ui/orbitUp';
import { chooseFrame } from './core/frameSwitch';
import { formatDistance, mountSearch, showInfoById } from './ui/search';
import { targetReadout, type ReadoutDeps } from './ui/targetReadout';
import { MAX_VIEW_DISTANCE_M } from './ui/viewLimits';
import { createStarGlow } from './ui/starGlow';
import { EARTH_ID, spotUnderCamera } from './ui/earthHandoff';
import { mountWalkOnEarth, type EarthSample } from './ui/walkOnEarth';
import { CosmoFlyControls } from './core/flyControls';
import { EXIT_TURN_S, chooseOrbitTarget, easeInOut, slerpDir, type OrbitCandidate } from './ui/flyExit';
import { FLY_BODY_IDS, createFlyIntoEarthTrigger, freeFlySpeedForDistance, mountFreeFlyUi, pickNearestBody, type BodyCandidate } from './ui/freeFly';

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
const galaxiesLayer = createGalaxiesLayer(scene, camera);
registry.register(galaxiesLayer);
// Lumi glue: Gemini's procedural galaxies for Nova's profiled galaxies.
registry.register(createProceduralGalaxiesLayer(scene, camera, (id) => galaxiesLayer.resolveTarget(id)));
registry.register(clustersRoute);
registry.register(new SolarSystemLayer(scene, camera));
registry.register(adaptStub(createStubOrbitLayer(), ['galactic']));

// Register Cosmic Web layer
const cosmicWebLayer = createCosmicWebLayer(scene, camera);
registry.register(cosmicWebLayer);

void cosmicWebLayer.load()
  .then((n) => console.info(`cosmic-web: ${n} 2MRS galaxies loaded`))
  .catch((err) => console.warn(`cosmic-web: data unavailable`, err));

// GPT-6's stars: register only after load settles, because enter() attaches the mesh
// only if it already exists. Missing HYG JSON is not fatal: the layer still resolves the Sun.
const stars = makeStarsLayer(
  scene,
  camera,
  renderer.domElement,
);
const starsReady = stars.load(HYG_URL)
  .then((n) => console.info(`stars: ${n} HYG stars loaded`))
  .catch((err) => console.warn(`stars: HYG data unavailable (${HYG_URL}), running without the star field`, err))
  .finally(() => registry.register(stars));

// GPT-6 — static NASA exoplanet systems.
// The deployed app loads only its own checked-in JSON.
// Register the ScaleLayer after catalog validation succeeds.
const exoplanets = makeExoplanetSystemsLayer(
  scene,
  camera,
);

const exoplanetsReady = loadExoplanetSystems()
  .then((count) => {
    registry.register(exoplanets);
    console.info(
      `exoplanets: ${count} confirmed host systems loaded`,
    );
  })
  .catch((error: unknown) => {
    console.warn(
      'exoplanets: static catalog unavailable',
      error,
    );
  });

// ---- flyTo + search (Lumi's bridge, Dee's controller) -------------------------
const flight = new FlyToController(camera, registry);
let now = performance.now() / 1000; // loop clock, seconds

let currentFlight: FlyToHandle | null = null;
/** Last flyTo target id; free-fly speed also scales against it (a star or galaxy). */
let lastPickId: string | null = null;
// v1.1 (Lumi): star targets get a visible disc + glow (the point field has no Sun and fixed-size points).
const starGlow = createStarGlow(scene, camera);
/** Point the camera at the target as the flight starts (flyTo moves position only). */
const flyer: Flyer = {
  flyTo(t: FlyToTarget, at?: number) {
    // A flight always ends free-fly (Claude's checklist).
    if (fly.enabled) { fly.stop(); freeFlyUi.sync(); }
    lastPickId = t.id;
    const r = registry.resolveTarget(t.id);
    if (r) {
      camera.setPose({
        frame: camera.getFrameId(),
        position: camera.getCameraWorldPosition(),
        target: { frame: r.frameId, position: r.worldPos },
      });
      // Solar-system arrivals orbit around ecliptic north (Claude's idea, Lumi).
      controls.setUp(orbitUpFor(r.frameId));
      controls.setMinDistance(r.radius ? 1.05 * r.radius * camera.unitsPerFrame(r.frameId) : 0);
    }
    starGlow.setFocus(
      r && (
        t.id.startsWith('star:') ||
        t.id.startsWith('exo:')
      )
        ? { frame: r.frameId, position: r.worldPos }
        : null,
    );
    // The exoplanet layer renders only the currently selected host.
    exoplanets.setFocus(
      t.id.startsWith('exo:') ? t.id : null,
    );
    currentFlight = flight.flyTo(t, at ?? now);
    if (t.id === MILKY_WAY_ID && r) {
      // P0 b (Lumi): the arrival is along the Sun's line, i.e. edge-on. Orbit
      // the galactic pole instead, and once there swing up above the disk so
      // the barred spiral shows (any input or new flight cancels the swing).
      controls.setUp(ngpUnit());
      const h = currentFlight;
      void h.promise.then(() => {
        if (currentFlight === h && !fly.enabled && !flight.active) startMwSwing(r.worldPos);
      });
    }
    return currentFlight;
  },
};
const flyToPick = linkSearchToFlight(flyer, showInfoById, undefined, () => now);
// Deep links (#to=<id>): fly there once stars have loaded; each pick updates the URL.
const recordPick = linkDeepLinks(
  flyToPick,
  Promise.all([starsReady, exoplanetsReady]),
);
// Grand Tour (Lumi): button flies outward through the scales; any manual pick stops it.
const tourBtn = document.querySelector<HTMLButtonElement>('#tour');
const tour = createTour({
  fly(id) {
    const k = kindFromId(id);
    if (!k) return Promise.reject(new Error(`No layer kind for id: ${id}`));
    return flyer.flyTo({ kind: flightKind(k), id, approach: 'orbit' }, now).promise;
  },
  onStop(id) { recordPick(id); showInfoById(id); },
  cancel() {
    // Stop Tour mid-leg: cancel the pending flight so it can't land on the next stop.
    currentFlight?.cancel();
    flight.cancelFlight();
    currentFlight = null;
  },
  onEnd() { tourBtn?.setAttribute('aria-pressed', 'false'); if (tourBtn) tourBtn.textContent = 'Grand Tour'; },
});
tourBtn?.addEventListener('click', () => {
  if (tour.running) { tour.stop({ returnToStop: true }); return; }
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
// v1.1 (Lumi): zoom-out capped at ~2x the 2MRS web extent via the existing maxDistance option (no controls.ts change).
const controls = new CosmoControls(camera, { reducedMotion, maxDistance: MAX_VIEW_DISTANCE_M });
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

// ---- Earth handoff (Lumi): near Earth, "Walk on Earth" fades into earth-walker ----
// Distances are in Earth's rendered radius; geography maths in src/ui/earthHandoff.ts.
const earthCam = new Float64Array(3);
const earthRel = new Float64Array(3);
const earthSun = new Float64Array(3);
const earthUp = new Float64Array(3);
function earthSample(): EarthSample | null {
  const r = registry.resolveTarget(EARTH_ID);
  if (!r || !r.radius) return null;
  camera.getCameraWorldPosition(r.frameId, earthCam);
  for (let i = 0; i < 3; i++) {
    earthRel[i] = earthCam[i] - r.worldPos[i];
    earthSun[i] = -r.worldPos[i]; // Sun = helio origin
  }
  const distanceR = Math.hypot(earthRel[0], earthRel[1], earthRel[2]) / r.radius;
  return {
    distanceR,
    spot: () => spotUnderCamera(earthRel, camera.getCameraUp(earthUp), r.frameId === 'helio' ? earthSun : null, Date.now()),
  };
}
const walkOnEarth = mountWalkOnEarth({
  canvas: renderer.domElement,
  reducedMotion,
  flightActive: () => flight.active, // hide/disarm while a flyTo passes Earth
  autoTriggerDisabled: () => fly.enabled, // free-fly: wheel = speed, not zoom
  sample: earthSample,
});

// ---- free-fly (Claude's CosmoFlyControls; Lumi's wiring + UI in src/ui/freeFly.ts) ----
// Speed scales with the distance to the nearest SURFACE among the Sun, the
// planets (their rendered, enlarged spheres), the last picked target and the
// nearest catalog galaxy. Galaxies go in with radius 0: speed follows the
// distance to the centre, so you ease in instead of overshooting, and a
// galaxy is never a wall (radius 0 skips free-fly's no-fly-into clearance).
const flyCands: BodyCandidate[] = [];
const flyGalPos = new Float64Array(3);
const fly = new CosmoFlyControls(camera, {
  reducedMotion,
  speedForDistance: freeFlySpeedForDistance, // full gap per second (Claude's default is half)
  nearestBody() {
    flyCands.length = 0;
    const ids = lastPickId && !FLY_BODY_IDS.includes(lastPickId) ? [...FLY_BODY_IDS, lastPickId] : FLY_BODY_IDS;
    for (const id of ids) {
      const r = registry.resolveTarget(id);
      if (!r) continue;
      flyCands.push({
        point: { frame: r.frameId, position: r.worldPos },
        radius: r.radius ? r.radius * camera.unitsPerFrame(r.frameId) : 0,
      });
    }
    const g = nearestGalaxy(camera.getCameraWorldPosition('galactic', flyGalPos));
    if (g) flyCands.push({ point: { frame: 'galactic', position: g.position }, radius: 0 });
    return pickNearestBody(flyCands, (p) => camera.distanceTo(p));
  },
});
fly.attach(renderer.domElement);
fly.onUserInput(() => tour.stop());
const freeFlyUi = mountFreeFlyUi({
  fly,
  toggle() {
    if (fly.enabled) {
      fly.stop();
      orbitAfterFly(); // P0 (c): orbit + zoom around a real body again
      return;
    }
    // Free-fly cancels any flight and the tour, then keeps the current view.
    tour.stop();
    currentFlight?.cancel();
    flight.cancelFlight();
    currentFlight = null;
    starGlow.setFocus(null);
    fly.start();
  },
});
const flyIntoEarth = createFlyIntoEarthTrigger();

// ---- Milky Way arrival swing (Lumi, P0 b) ---------------------------------------
const MW_SWING_S = 1.6;
const mwSwing = { active: false, t: 0, from: new Float64Array(3), to: new Float64Array(3), dist: 0, centre: new Float64Array(3) };
const mwCam = new Float64Array(3);
const mwDir = new Float64Array(3);
const mwPos = new Float64Array(3);
function startMwSwing(centre: ArrayLike<number>): void {
  camera.getCameraWorldPosition('galactic', mwCam);
  for (let i = 0; i < 3; i++) mwSwing.from[i] = mwCam[i] - centre[i];
  mwSwing.dist = Math.hypot(mwSwing.from[0], mwSwing.from[1], mwSwing.from[2]);
  if (!(mwSwing.dist > 0)) return;
  for (let i = 0; i < 3; i++) { mwSwing.from[i] /= mwSwing.dist; mwSwing.centre[i] = centre[i]; }
  milkyWayViewDir(mwSwing.from, mwSwing.to);
  mwSwing.t = 0;
  mwSwing.active = true;
  if (reducedMotion) stepMwSwing(MW_SWING_S);
}
function stepMwSwing(dt: number): void {
  if (!mwSwing.active) return;
  mwSwing.t = Math.min(1, mwSwing.t + dt / MW_SWING_S);
  slerpDir(mwSwing.from, mwSwing.to, easeInOut(mwSwing.t), mwDir);
  for (let i = 0; i < 3; i++) mwPos[i] = mwSwing.centre[i] + mwDir[i] * mwSwing.dist;
  camera.setPose({ frame: 'galactic', position: mwPos, target: { frame: 'galactic', position: mwSwing.centre }, up: ngpUnit() });
  if (mwSwing.t >= 1) mwSwing.active = false;
}
controls.onUserInput(() => {
  if (!mwSwing.active) return;
  mwSwing.active = false;
  if (!flight.active && !fly.enabled) controls.enabled = true; // so this same input applies
});

// ---- leaving free-fly (Lumi, P0 c): orbit a real body again -------------------
// Free-fly's look-at point is an empty spot ahead, and its up is whatever roll
// you flew with. On exit: pick the nearest body (or the last pick if it's
// close enough, src/ui/flyExit.ts), turn to face it over EXIT_TURN_S, and put
// the orbit axis back (CosmoControls eases the camera's up onto it).
const exitTurn = {
  active: false,
  t: 0,
  dir0: new Float64Array(3),
  target: null as OrbitCandidate | null,
};
const exitCam = new Float64Array(3);
const exitDir = new Float64Array(3);
const exitPos = new Float64Array(3);
const exitTgt = new Float64Array(3);
function orbitCandidates(): OrbitCandidate[] {
  const out: OrbitCandidate[] = [];
  const ids = lastPickId && !FLY_BODY_IDS.includes(lastPickId) ? [...FLY_BODY_IDS, lastPickId] : FLY_BODY_IDS;
  for (const id of ids) {
    const r = registry.resolveTarget(id);
    if (!r) continue;
    out.push({ id, point: { frame: r.frameId, position: r.worldPos }, radius: r.radius ? r.radius * camera.unitsPerFrame(r.frameId) : 0 });
  }
  const g = nearestGalaxy(camera.getCameraWorldPosition('galactic', flyGalPos));
  if (g) out.push({ id: g.id, point: { frame: 'galactic', position: Float64Array.from(g.position) }, radius: 0 });
  return out;
}
/** Aim the camera at the exit target, fraction `t` of the way from dir0. */
function applyExitTurn(t: number): void {
  const tg = exitTurn.target!;
  const f = tg.point.frame;
  camera.getCameraWorldPosition(f, exitCam);
  for (let i = 0; i < 3; i++) exitDir[i] = tg.point.position[i] - exitCam[i];
  const d = Math.hypot(exitDir[0], exitDir[1], exitDir[2]);
  if (!(d > 0)) return;
  for (let i = 0; i < 3; i++) exitDir[i] /= d;
  slerpDir(exitTurn.dir0, exitDir, easeInOut(t), exitDir);
  for (let i = 0; i < 3; i++) exitTgt[i] = exitCam[i] + exitDir[i] * d;
  const camFrame = camera.getFrameId();
  camera.getCameraWorldPosition(camFrame, exitPos);
  camera.setPose({ frame: camFrame, position: exitPos, target: { frame: f, position: t >= 1 ? tg.point.position : exitTgt } });
}
function orbitAfterFly(): void {
  controls.stop();
  const tg = chooseOrbitTarget(orbitCandidates(), (p) => camera.distanceTo(p), lastPickId);
  if (!tg) { controls.setMinDistance(0); return; }
  lastPickId = tg.id; // the readout and the orbit agree on the object
  controls.setUp(orbitUpFor(tg.point.frame));
  controls.setMinDistance(tg.radius ? 1.05 * tg.radius : 0);
  exitTurn.target = tg;
  camera.getCameraForward(exitTurn.dir0);
  exitTurn.t = 0;
  exitTurn.active = !reducedMotion;
  if (reducedMotion) applyExitTurn(1);
}
function stepExitTurn(dt: number): void {
  if (!exitTurn.active) return;
  exitTurn.t = Math.min(1, exitTurn.t + dt / EXIT_TURN_S);
  applyExitTurn(exitTurn.t);
  if (exitTurn.t >= 1) exitTurn.active = false;
}
// Any orbit input during the turn finishes it at once (so the input applies).
controls.onUserInput(() => {
  if (!exitTurn.active) return;
  exitTurn.active = false;
  applyExitTurn(1);
  if (!flight.active && !fly.enabled) controls.enabled = true; // so this same input applies
});

// ---- resize -----------------------------------------------------------------
addEventListener('resize', () => {
  camera.three.aspect = innerWidth / innerHeight;
  camera.three.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- render loop (main.ts owns it) --------------------------------------------
const scaleEl = document.querySelector<HTMLElement>('#scale');
const readoutDeps: ReadoutDeps = {
  resolve: (id) => registry.resolveTarget(id),
  distanceTo: (p) => camera.distanceTo(p),
  nameOf: (id) => getCatalogEntry(id)?.name,
  format: formatDistance,
};
const hudTarget = new Float64Array(3);
const zoneHud = makeZoneHud(document.querySelector<HTMLElement>('#zone'));
const SUN_POINT = { frame: 'galactic' as FrameId, position: SUN };
let last = -1;
renderer.setAnimationLoop((ms: number) => {
  now = ms / 1000;
  const dt = last < 0 ? 0 : Math.min(MAX_DT, now - last);
  last = now;

  flight.update(now);   // Dee: moves the camera along the log-space path
  if (fly.enabled || flight.active) { exitTurn.active = false; mwSwing.active = false; }
  stepExitTurn(dt);
  stepMwSwing(dt);      // Lumi: Milky Way arrival swings above the disk     // Lumi: turn onto the orbit target after free-fly
  controls.enabled = !flight.active && !fly.enabled && !exitTurn.active && !mwSwing.active; // Claude: controls stand down mid-flight and in free-fly
  controls.update(dt);  // Claude: eased orbit/zoom around the target
  fly.update(dt);       // Claude: free-fly (no-op unless enabled)
  if (!flight.active) {  // Lumi: helio <-> galactic <-> cosmic by distance from the Sun (exact rebase)
    const hint = fly.enabled ? fly.frameHint() : camera.getTarget(hudTarget)?.frame ?? null;
    const want = chooseFrame(camera.getFrameId(), camera.distanceTo(SUN_POINT), hint);
    if (want !== camera.getFrameId()) camera.rebaseTo(want); // orbit axis stays the target's
  }
  camera.update();      // Claude: sync the three.js puppet before layers read it
  starGlow.update();    // Lumi: focus-star disc (camera-relative, after the puppet sync)
  registry.update(dt);  // Dee: crossfades + per-layer update (camera-relative positions)

  if (scaleEl) {
    // Claude: always the distance to the object you picked last, named. The
    // camera's look-at point is only the picked object in orbit mode; in
    // free-fly it's a point ahead at the nearest body's distance.
    const text = targetReadout(lastPickId, readoutDeps);
    if (scaleEl.textContent !== text) scaleEl.textContent = text;
  }
  zoneHud(camera.distanceTo(SUN_POINT)); // Lumi: 'where am I' label
  walkOnEarth.update(); // Lumi: Earth handoff button / auto-trigger
  if (fly.enabled && flyIntoEarth.update(earthSample()?.distanceR ?? Infinity, true)) walkOnEarth.go(); // Lumi: free-fly into Earth
  renderer.render(scene, camera.three);
});

// Help overlay (Lumi): ? key or top-right button.
mountHelp();
// Constellation toggle (Lumi, GPT-6's handoff): C key or top-right button.
mountConstellationToggle((mode) => stars.setConstellationMode(mode));
stars.startLabelExclusionCache(document);
