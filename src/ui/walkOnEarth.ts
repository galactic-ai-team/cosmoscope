// "Walk on Earth" button + fade-to-black handoff (Lumi). Math, URL and the
// auto-trigger rules are in ./earthHandoff.ts; this file is only DOM glue.
//
// - Button: shown while the camera is within 12 rendered Earth radii of
//   Earth's centre (the 'orbit' fly-to framing is 9 R). It names the landing
//   spot ("40.7°N 74.0°W") and is a 44 px+ tap target for phones (on narrow screens it sits under the search box, clear of the info panel).
// - Auto: at the zoom floor (<= 1.25 R; controls stop at 1.05 R), keep
//   zooming in (3 wheel notches, a pinch-out of similar size, or + three
//   times) and it fades into earth-walker by itself.
// - Fade: ~0.9 s to black (0.15 s with reduced motion), then navigate. Esc or a
//   tap cancels while fading. Coming back with the browser Back button (bfcache)
//   clears the overlay and re-arms the trigger.
//
// Zoom intent is observed with passive listeners on the canvas, so
// CosmoControls (Claude's lane) is untouched.

import { createHandoffTrigger, earthWalkerUrl, type EarthSpot } from './earthHandoff';

/** Natural-log zoom per wheel notch in CosmoControls (its default zoomStep). */
const CONTROLS_ZOOM_STEP = 0.15;
const WHEEL_NOTCH_PX = 100;

export interface EarthSample {
  /** Camera distance to Earth's centre, in rendered Earth radii. */
  distanceR: number;
  /** Lazily computed spot under the camera (only when needed). */
  spot(): EarthSpot;
}

export interface WalkOnEarthDeps {
  canvas: HTMLElement;
  /** Null when Earth can't be resolved. */
  sample(): EarthSample | null;
  reducedMotion?: boolean;
  navigate?: (url: string) => void;
  doc?: Document;
  win?: Window;
}

export function formatSpot(s: Pick<EarthSpot, 'lat' | 'lon'>): string {
  const lat = `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

export function mountWalkOnEarth(deps: WalkOnEarthDeps): { update(): void; go(): void } {
  const doc = deps.doc ?? document;
  const win = deps.win ?? window;
  const navigate = deps.navigate ?? ((url: string) => win.location.assign(url));
  const fadeMs = deps.reducedMotion ? 150 : 900;
  const trigger = createHandoffTrigger();

  const style = doc.createElement('style');
  style.textContent = `
#walk-earth{position:fixed;left:50%;transform:translateX(-50%);bottom:64px;z-index:6;min-height:44px;padding:10px 18px;border-radius:999px;border:1px solid #7fb2ff88;background:#0b2a5ccc;color:#fff;font:inherit;font-size:15px;cursor:pointer;white-space:nowrap;box-shadow:0 0 18px #3a7bff55;touch-action:manipulation}
#walk-earth:hover,#walk-earth:focus-visible{background:#1a4a96}
#walk-earth small{opacity:.75;font-size:12px;margin-left:6px}
#walk-earth[hidden]{display:none}
#earth-fade{position:fixed;inset:0;z-index:50;background:#000;opacity:0;pointer-events:none;transition:opacity ${fadeMs}ms ease-in;display:flex;align-items:center;justify-content:center;color:#cfe0ff;font-size:14px;letter-spacing:.08em}
#earth-fade.on{opacity:1;pointer-events:auto}
@media (max-width:480px){#walk-earth{bottom:auto;top:72px;font-size:14px;padding:10px 14px}}`;
  doc.head.append(style);

  const btn = doc.createElement('button');
  btn.id = 'walk-earth';
  btn.type = 'button';
  btn.hidden = true;
  btn.setAttribute('data-label-exclude', '');
  btn.title = 'Open earth-walker at the spot under you (or keep zooming in)';
  btn.innerHTML = '🚶 Walk on Earth<small></small>';
  const where = btn.querySelector('small')!;
  doc.body.append(btn);

  const fade = doc.createElement('div');
  fade.id = 'earth-fade';
  fade.setAttribute('aria-live', 'polite');
  doc.body.append(fade);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSpotText = '';

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    fade.classList.remove('on');
    fade.textContent = '';
    trigger.reset();
  };

  const go = (): void => {
    if (timer !== null) return;
    const s = deps.sample();
    if (!s) return;
    const url = earthWalkerUrl(s.spot());
    fade.textContent = 'Descending to Earth… (tap or Esc to cancel)';
    fade.classList.add('on');
    timer = setTimeout(() => { timer = null; navigate(url); }, fadeMs);
  };

  btn.addEventListener('click', (e) => { e.stopPropagation(); go(); });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && timer !== null) cancel(); });
  fade.addEventListener('click', () => { if (timer !== null) cancel(); });
  win.addEventListener('pageshow', () => cancel());

  // ---- zoom intent (passive; CosmoControls does the actual zooming) ----
  deps.canvas.addEventListener('wheel', (e) => {
    const scale = e.deltaMode === 1 ? 1 / 3 : e.deltaMode === 2 ? 1 : 1 / WHEEL_NOTCH_PX;
    trigger.zoomInput(-e.deltaY * scale);
  }, { passive: true });
  doc.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === '+' || e.key === '=' || e.key === 'PageUp') trigger.zoomInput(1);
    else if (e.key === '-' || e.key === '_' || e.key === 'PageDown') trigger.zoomInput(-1);
  });
  const pointers = new Map<number, { x: number; y: number }>();
  let lastSpread = 0;
  const spread = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  deps.canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastSpread = pointers.size === 2 ? spread() : 0;
  }, { passive: true });
  deps.canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size !== 2) return;
    const now = spread();
    // Fingers apart (now > last) = zoom in.
    if (lastSpread > 0 && now > 0) trigger.zoomInput(Math.log(now / lastSpread) / CONTROLS_ZOOM_STEP);
    lastSpread = now;
  }, { passive: true });
  const up = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    lastSpread = pointers.size === 2 ? spread() : 0;
  };
  deps.canvas.addEventListener('pointerup', up, { passive: true });
  deps.canvas.addEventListener('pointercancel', up, { passive: true });

  return {
    go,
    update() {
      const s = deps.sample();
      const r = trigger.update(s ? s.distanceR : Infinity);
      const show = r.showButton && timer === null;
      if (btn.hidden === show) btn.hidden = !show;
      if (show && s) {
        const text = formatSpot(s.spot());
        if (text !== lastSpotText) { lastSpotText = text; where.textContent = text; }
      }
      if (r.fire) go();
    },
  };
}
