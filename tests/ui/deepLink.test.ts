import { describe, expect, it } from 'vitest';
import { formatDeepLink, linkDeepLinks, parseDeepLink } from '../../src/ui/deepLink';

describe('deep links', () => {
  it('round-trips contract ids', () => {
    for (const id of ['galaxy:messier:M31', 'star:hyg:32263', 'star:sol:sun', 'galaxy:pgc:3085']) {
      expect(parseDeepLink(formatDeepLink(id))).toBe(id);
    }
  });
  it('rejects missing or malformed ids', () => {
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink('#foo=bar')).toBeNull();
    expect(parseDeepLink('#to=M31')).toBeNull();
    expect(parseDeepLink('#to=<script>')).toBeNull();
  });
  it('flies to the hash target when ready and records picks', async () => {
    const picks: string[] = [];
    const loc = { hash: '#to=galaxy:messier:M31' };
    const hist = { replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { loc.hash = String(url); } };
    let onHash = () => {};
    const win = { addEventListener: (_t: string, f: () => void) => { onHash = f; } } as unknown as Window;
    const record = linkDeepLinks((id) => picks.push(id), Promise.resolve(), loc, hist, win);
    await Promise.resolve(); await Promise.resolve();
    expect(picks).toEqual(['galaxy:messier:M31']);
    record('star:hyg:32263');
    expect(loc.hash).toBe('#to=star:hyg:32263');
    loc.hash = '#to=star:sol:sun';
    onHash();
    expect(picks).toEqual(['galaxy:messier:M31', 'star:sol:sun']);
  });
  it('accepts the two-part planet:<name> ids from CONTRACTS', () => {
    expect(parseDeepLink('#to=planet:mars')).toBe('planet:mars');
    expect(parseDeepLink('#to=planet')).toBeNull();
    expect(parseDeepLink('#to=planet:')).toBeNull();
  });
});
