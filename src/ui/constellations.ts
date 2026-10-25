// Constellation toggle (Lumi, handed off by GPT-6): press "c" (or click the
// button) to cycle Auto -> On -> Off. Auto keeps GPT-6's 30-100 ly fade.

import type { ConstellationMode } from '../layers/stars/constellations';

export const CONSTELLATION_MODES: readonly ConstellationMode[] = ['auto', 'on', 'off'];

const LABELS: Record<ConstellationMode, string> = { auto: 'Auto', on: 'On', off: 'Off' };

export function nextConstellationMode(mode: ConstellationMode): ConstellationMode {
  const i = CONSTELLATION_MODES.indexOf(mode);
  return CONSTELLATION_MODES[(i + 1) % CONSTELLATION_MODES.length];
}

export function constellationLabel(mode: ConstellationMode): string {
  return `Constellations: ${LABELS[mode]}`;
}

/** True when a keydown should cycle the mode (ignores typing and Ctrl/Cmd/Alt combos). */
export function isConstellationKey(
  key: string,
  targetTag?: string,
  editable = false,
  modified = false,
): boolean {
  if (editable || modified) return false;
  if (targetTag && /^(INPUT|TEXTAREA|SELECT)$/i.test(targetTag)) return false;
  return key === 'c' || key === 'C';
}

/** Mounts a small cycle button. Calls setMode on every change (and once with the initial mode). */
export function mountConstellationToggle(
  setMode: (mode: ConstellationMode) => void,
  doc: Document = document,
  initial: ConstellationMode = 'auto',
): { cycle(): ConstellationMode; readonly mode: ConstellationMode } {
  let mode = initial;
  const btn = doc.createElement('button');
  btn.id = 'constellations-btn';
  btn.type = 'button';
  btn.title = 'Constellation lines (C)';
  btn.style.cssText = 'position:fixed;z-index:6;top:16px;right:58px;height:34px;padding:0 12px;border-radius:999px;'
    + 'background:#0b1024cc;color:#dfe8ff;border:1px solid #3a4a7a;font-size:13px;cursor:pointer';
  const render = (): void => {
    btn.textContent = constellationLabel(mode);
    btn.setAttribute('aria-label', constellationLabel(mode));
    btn.dataset.mode = mode;
  };
  const apply = (): void => { render(); setMode(mode); };
  const cycle = (): ConstellationMode => { mode = nextConstellationMode(mode); apply(); return mode; };
  btn.addEventListener('click', () => cycle());
  doc.addEventListener('keydown', (ev) => {
    const el = ev.target as HTMLElement | null;
    const modified = ev.ctrlKey || ev.metaKey || ev.altKey;
    if (isConstellationKey(ev.key, el?.tagName, el?.isContentEditable === true, modified)) {
      ev.preventDefault();
      cycle();
    }
  });
  doc.body.append(btn);
  apply();
  return { cycle, get mode() { return mode; } };
}
