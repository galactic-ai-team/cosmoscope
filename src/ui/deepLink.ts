/**
 * Shareable Cosmoscope deep links.
 *
 * Supports existing catalog IDs and exo:<encoded-hostname>
 * with percent-encoded spaces.
 */

const KEY = 'to';

const ID_RE =
  /^[a-z]+:[^\s#&:]+(?::[^\s#&]+)?$/i;

export function parseDeepLink(
  hash: string,
): string | null {
  const raw = hash.startsWith('#')
    ? hash.slice(1)
    : hash;

  const params = new URLSearchParams(raw);
  const id = params.get(KEY);

  if (!id) return null;

  return ID_RE.test(id) ? id : null;
}

export function formatDeepLink(id: string): string {
  return `#${KEY}=${encodeURIComponent(id).replace(/%3A/gi, ':')}`;
}

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

  win.addEventListener('hashchange', () => {
    lastWritten = null;
    go();
  });

  return (id: string) => {
    lastWritten = id;
    hist.replaceState(null, '', formatDeepLink(id));
  };
}
