// Shareable deep links (Lumi). The URL hash names the current target, so a
// link like https://cosmoscope-chi.vercel.app/#to=galaxy:messier:M31 opens
// Cosmoscope and flies straight there. Ids follow docs/CONTRACTS.md.

const KEY = 'to';
const ID_RE = /^[a-z]+:[a-z0-9_-]+:[^\s#&]+$/i;

/** Read a target id from a location hash ("#to=<id>"), or null if absent/invalid. */
export function parseDeepLink(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const id = params.get(KEY);
  if (!id) return null;
  return ID_RE.test(id) ? id : null;
}

/** Build the hash for a target id ("#to=<id>"), keeping colons readable. */
export function formatDeepLink(id: string): string {
  return `#${KEY}=${encodeURIComponent(id).replace(/%3A/gi, ':')}`;
}

/**
 * Wire deep links: fly to the hash target once ready() resolves (e.g. after
 * catalogs load), fly again when the hash changes (back/forward, pasted link),
 * and return a function that records a new pick in the URL without a reload.
 */
export function linkDeepLinks(
  pick: (id: string) => void,
  ready: Promise<unknown> = Promise.resolve(),
  loc: Pick<Location, 'hash'> = location,
  hist: Pick<History, 'replaceState'> = history,
  win: Pick<Window, 'addEventListener'> = window,
): (id: string) => void {
  let lastWritten: string | null = null;
  const go = () => {
    const id = parseDeepLink(loc.hash);
    if (id && id !== lastWritten) pick(id);
  };
  ready.then(go, go);
  win.addEventListener('hashchange', () => { lastWritten = null; go(); });
  return (id: string) => {
    lastWritten = id;
    hist.replaceState(null, '', formatDeepLink(id));
  };
}
