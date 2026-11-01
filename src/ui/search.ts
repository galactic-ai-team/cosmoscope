// Search box + info panel (Lumi). Calls onPick(id) so the camera/flyTo owner can fly there.
import { search, get, type CatalogEntry } from '../catalog';

export function formatDistance(m?: number): string {
  if (m === undefined) return 'unknown';
  const AU = 1.495978707e11, LY = 9.4607304725808e15;
  if (m < 1e9) return `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
  if (m < 0.1 * LY) return `${(m / AU).toFixed(2)} AU`;
  if (m < 1e6 * LY) return `${(m / LY).toLocaleString(undefined, { maximumFractionDigits: 1 })} light-years`;
  return `${(m / LY / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} million light-years`;
}

export function showInfo(e: CatalogEntry): void {
  const box = document.querySelector<HTMLElement>('#info')!;
  box.querySelector('h2')!.textContent = e.name;
  box.querySelector('p')!.textContent = e.blurb ?? '';
  const dl = box.querySelector('dl')!;
  dl.replaceChildren();
  const facts: Record<string, string> = { Type: e.kind, Distance: formatDistance(e.distanceM), ...e.facts };
  for (const [k, v] of Object.entries(facts)) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v; dd.style.margin = '0';
    dl.append(dt, dd);
  }
  box.hidden = false;
}

export const NO_RESULTS = 'No results';
/** v1.1: show the non-clickable 'No results' row for a typed, focused query with no matches. */
export function showNoResults(query: string, resultCount: number, focused: boolean): boolean {
  return focused && resultCount === 0 && query.trim() !== '';
}

/** showInfoOnPick=false lets the flight bridge open the panel on arrival instead. */
export function mountSearch(onPick: (id: string) => void, showInfoOnPick = true): void {
  const input = document.querySelector<HTMLInputElement>('#search input')!;
  const list = document.querySelector<HTMLUListElement>('#search ul')!;
  const info = document.querySelector<HTMLElement>('#info')!;
  info.querySelector('button')!.addEventListener('click', () => (info.hidden = true));
  let results: CatalogEntry[] = [];
  let sel = 0;

  const render = () => {
    // v1.1: a typed query with no matches shows a non-clickable 'No results' row.
    if (showNoResults(input.value, results.length, document.activeElement === input)) {
      const li = document.createElement('li');
      li.className = 'no-results';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-disabled', 'true');
      li.textContent = NO_RESULTS;
      li.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep focus, pick nothing
      list.replaceChildren(li);
      list.hidden = false;
      return;
    }
    list.replaceChildren(...results.map((r, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === sel));
      li.textContent = `${r.name} · ${r.kind}`;
      li.addEventListener('mousedown', (ev) => { ev.preventDefault(); pick(i); });
      return li;
    }));
    list.hidden = results.length === 0;
  };
  const pick = (i: number) => {
    const r = results[i];
    if (!r) return;
    input.value = r.name; results = []; input.blur(); render();
    if (showInfoOnPick) { const e = get(r.id); if (e) showInfo(e); }
    onPick(r.id);
  };
  input.addEventListener('input', () => { results = search(input.value); sel = 0; render(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { sel = Math.max(0, Math.min(sel + 1, results.length - 1)); render(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); ev.preventDefault(); }
    else if (ev.key === 'Enter') pick(sel);
    else if (ev.key === 'Escape') { results = []; input.blur(); render(); }
  });
  input.addEventListener('blur', () => { if (results.length === 0) list.hidden = true; });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && document.activeElement !== input) { ev.preventDefault(); input.focus(); }
  });
}

/** Show the info panel for a catalog id (no-op if unknown). */
export function showInfoById(id: string): void { const e = get(id); if (e) showInfo(e); }
