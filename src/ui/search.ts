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

export function mountSearch(onPick: (id: string) => void): void {
  const input = document.querySelector<HTMLInputElement>('#search input')!;
  const list = document.querySelector<HTMLUListElement>('#search ul')!;
  const info = document.querySelector<HTMLElement>('#info')!;
  info.querySelector('button')!.addEventListener('click', () => (info.hidden = true));
  let results: CatalogEntry[] = [];
  let sel = 0;

  const render = () => {
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
    input.value = r.name; results = []; render(); input.blur();
    const e = get(r.id); if (e) showInfo(e);
    onPick(r.id);
  };
  input.addEventListener('input', () => { results = search(input.value); sel = 0; render(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { sel = Math.min(sel + 1, results.length - 1); render(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); ev.preventDefault(); }
    else if (ev.key === 'Enter') pick(sel);
    else if (ev.key === 'Escape') { results = []; render(); input.blur(); }
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && document.activeElement !== input) { ev.preventDefault(); input.focus(); }
  });
}
