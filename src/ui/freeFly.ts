// Free-fly UI glue (Lumi). Claude's CosmoFlyControls (src/core/flyControls.ts)
// does the flying; this file is the toggle button, the on-screen controls for
// phones, the nearest-body pick for speed scaling, and the "fly into Earth"
// trigger for the earth-walker handoff.
//
// - Toggle: "Free-fly" button (bottom right) or the F key.
// - Desktop: WASD / arrows, mouse look (click to lock the pointer, Esc to
//   release), E/Space up, Q down, Z/X roll, Shift boost, wheel = speed.
// - Touch (iPhone): left half of the screen is the move stick and the right
//   half drags to look (Claude's attach()); the pad adds Up / Down buttons
//   (held = E / Q) and Faster / Slower (fly.adjustSpeed(+2 / -2)).
// - Fly into Earth: within FLY_INTO_EARTH.fireAtR rendered radii the handoff
//   fires once; it re-arms after flying back out past rearmAtR (so cancelling
//   the fade with Esc doesn't immediately fire again).

import type { FramedPoint } from '../core/camera';
import { FLY_TOGGLE_CODE, type NearestBody } from '../core/flyControls';

/** Bodies with a surface that free-fly speed-scales against and can't enter. */
export const FLY_BODY_IDS: readonly string[] = [
  'star:sol:sun',
  'planet:mercury', 'planet:venus', 'planet:earth', 'planet:mars',
  'planet:jupiter', 'planet:saturn', 'planet:uranus', 'planet:neptune',
  // Moons (resolvable since SolarSystemLayer registers them). The Moon's
  // enlarged sphere sits right on the free-fly path into Earth.
  'moon:earth-moon', 'moon:phobos', 'moon:deimos',
];

export interface BodyCandidate {
  point: FramedPoint;
  /** Surface radius in metres (rendered size); 0 for points. */
  radius: number;
}

/** The candidate whose SURFACE is nearest (distance to centre minus radius). */
export function pickNearestBody(cands: readonly BodyCandidate[], distanceTo: (p: FramedPoint) => number): NearestBody | null {
  let best: BodyCandidate | null = null;
  let bestGap = Infinity;
  for (const c of cands) {
    const gap = distanceTo(c.point) - c.radius;
    if (Number.isFinite(gap) && gap < bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  return best ? { point: best.point, radius: best.radius } : null;
}

export const FLY_INTO_EARTH = {
  /**
   * Fire when free-flying closer than this many rendered Earth radii (fly
   * clearance is 1.002). 1.05 per Claude's #64 review: the last stretch is the
   * slowest, and at 1.05 R Earth already fills the screen.
   */
  fireAtR: 1.05,
  /** Re-arm only after getting this far out again. */
  rearmAtR: 1.2,
};

/**
 * Free-fly cruise speed: the FULL gap to the nearest surface per second (at
 * least 2 m/s), twice Claude's default of half the gap, so 9 R -> Earth holding
 * W takes about 5-6 s instead of ~11 s (Claude's #64 answer 4). Passed as
 * CosmoFlyControls' speedForDistance option; Dee's curve replaces it once #57 lands.
 */
export const FREE_FLY_GAP_PER_S = 1;
export function freeFlySpeedForDistance(metres: number): number {
  return Math.max(2, FREE_FLY_GAP_PER_S * metres);
}

export interface FlyIntoEarthTrigger {
  /** Call every frame; true on the frame the handoff should fire. */
  update(distanceR: number, flying: boolean): boolean;
  readonly armed: boolean;
}

export function createFlyIntoEarthTrigger(opts: Partial<typeof FLY_INTO_EARTH> = {}): FlyIntoEarthTrigger {
  const { fireAtR, rearmAtR } = { ...FLY_INTO_EARTH, ...opts };
  let armed = true;
  return {
    update(distanceR: number, flying: boolean): boolean {
      if (!Number.isFinite(distanceR)) return false;
      if (distanceR > rearmAtR) armed = true;
      if (!flying || !armed || distanceR > fireAtR) return false;
      armed = false;
      return true;
    },
    get armed() {
      return armed;
    },
  };
}

/** The slice of CosmoFlyControls the UI drives. */
export interface FlyUiTarget {
  readonly enabled: boolean;
  setKey(code: string, down: boolean): boolean;
  adjustSpeed(steps: number): void;
}

export interface FreeFlyUiDeps {
  fly: FlyUiTarget;
  /** Start or stop free-fly (main.ts also cancels flights / the tour). */
  toggle(): void;
  doc?: Document;
}

/** True when a key event comes from a text field or editable element. */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el !== 'object') return false;
  if (el.isContentEditable) return true;
  return typeof el.tagName === 'string' && /^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName);
}

export function mountFreeFlyUi(deps: FreeFlyUiDeps): { sync(): void } {
  const doc = deps.doc ?? document;
  const { fly } = deps;

  const style = doc.createElement('style');
  style.textContent = `
#free-fly{position:fixed;right:16px;bottom:16px;z-index:5;min-height:36px;padding:8px 14px;border-radius:999px;border:1px solid #fff4;background:#0008;color:inherit;font:inherit;font-size:13px;cursor:pointer;touch-action:manipulation}
#free-fly[aria-pressed="true"]{background:#3a7bff55;border-color:#7fb2ff}
#fly-hint{position:fixed;left:50%;transform:translateX(-50%);bottom:56px;z-index:4;font-size:12px;opacity:.8;pointer-events:none;white-space:nowrap;text-shadow:0 0 4px #000}
#fly-hint[hidden],#fly-pad[hidden]{display:none}
#fly-pad{position:fixed;right:12px;bottom:64px;z-index:5;display:grid;grid-template-columns:repeat(2,64px);gap:8px;touch-action:none;user-select:none;-webkit-user-select:none}
#fly-pad button{min-height:48px;white-space:nowrap;border-radius:12px;border:1px solid #fff4;background:#000a;color:inherit;font:inherit;font-size:13px;touch-action:none}
#fly-pad button:active{background:#3a7bff66}
@media (pointer:fine){#fly-pad{display:none}}
@media (pointer:coarse){#fly-hint .desk{display:none}}
@media (pointer:fine){#fly-hint .touch{display:none}}`;
  doc.head.append(style);

  const btn = doc.createElement('button');
  btn.id = 'free-fly';
  btn.type = 'button';
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('data-label-exclude', '');
  btn.title = 'Free-fly: travel anywhere (F)';
  btn.textContent = 'Free-fly';
  doc.body.append(btn);

  const hint = doc.createElement('div');
  hint.id = 'fly-hint';
  hint.hidden = true;
  hint.setAttribute('data-label-exclude', '');
  hint.innerHTML =
    '<span class="desk">WASD move · mouse look · E/Q up/down · Shift boost · wheel speed · F exit</span>' +
    '<span class="touch">Left side: move · right side: look</span>';
  doc.body.append(hint);

  const pad = doc.createElement('div');
  pad.id = 'fly-pad';
  pad.hidden = true;
  pad.setAttribute('data-label-exclude', '');
  doc.body.append(pad);
  const hold = (label: string, code: string, aria: string): void => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    const release = (): void => { fly.setKey(code, false); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); fly.setKey(code, true); });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('pointerleave', release);
    pad.append(b);
  };
  const tap = (label: string, steps: number, aria: string): void => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', () => fly.adjustSpeed(steps));
    pad.append(b);
  };
  hold('▲ Up', 'KeyE', 'Move up');
  tap('Faster', 2, 'Faster');
  hold('▼ Down', 'KeyQ', 'Move down');
  tap('Slower', -2, 'Slower');

  const sync = (): void => {
    const on = fly.enabled;
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Exit free-fly' : 'Free-fly';
    hint.hidden = !on;
    pad.hidden = !on;
  };

  btn.addEventListener('click', (e) => { e.stopPropagation(); deps.toggle(); sync(); });
  doc.addEventListener('keydown', (e) => {
    if (e.code !== FLY_TOGGLE_CODE || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    deps.toggle();
    sync();
  });
  sync();
  return { sync };
}
