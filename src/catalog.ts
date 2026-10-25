// Searchable catalog contract (Lumi). Each layer lane registers its own entries;
// search/UI only needs ids, names and a few facts, never layer internals.
export type EntryKind = 'planet' | 'moon' | 'star' | 'galaxy' | 'nebula' | 'cluster' | 'structure';

export interface CatalogEntry {
  id: string;            // stable, e.g. 'planet:mars', 'star:hyg:32263', 'galaxy:messier:M31'
  name: string;          // display name
  aliases?: string[];    // e.g. ['Andromeda', 'NGC 224']
  kind: EntryKind;
  distanceM?: number;    // distance from the Sun in metres (for sorting and the info panel)
  facts?: Record<string, string>; // short label/value facts shown in the info panel
  blurb?: string;
}

const entries = new Map<string, CatalogEntry>();

export function register(list: CatalogEntry[]): void {
  for (const e of list) entries.set(e.id, e);
}

export function get(id: string): CatalogEntry | undefined {
  return entries.get(id);
}

/** Prefix-first fuzzy search over names and aliases. */
export function search(query: string, limit = 8): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: [number, CatalogEntry][] = [];
  for (const e of entries.values()) {
    let best = Infinity;
    for (const n of [e.name, ...(e.aliases ?? [])]) {
      const s = n.toLowerCase();
      const i = s.indexOf(q);
      if (i === 0) best = Math.min(best, 0);
      else if (i > 0) best = Math.min(best, 1 + i / 100);
    }
    if (best < Infinity) scored.push([best, e]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map((s) => s[1]);
}
