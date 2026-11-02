import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  flightKind,
  kindFromId,
  linkSearchToFlight,
} from './flyLink';

import {
  formatDeepLink,
  parseDeepLink,
} from './deepLink';

describe('exoplanet navigation integration', () => {
  it('recognizes exoplanet host IDs', () => {
    expect(kindFromId('exo:TRAPPIST-1')).toBe('exo');
    expect(kindFromId('exo:HD%20209458')).toBe('exo');
    expect(flightKind('exo')).toBe('star');
  });

  it('routes exoplanet search to a star-kind flight', async () => {
    const onArrive = vi.fn();
    const flyTo = vi.fn(() => ({
      promise: Promise.resolve(),
      cancel: vi.fn(),
    }));

    const pick = linkSearchToFlight(
      { flyTo },
      onArrive,
      undefined,
      () => 100,
    );

    pick('exo:TRAPPIST-1');

    expect(flyTo).toHaveBeenCalledWith({
      kind: 'star',
      id: 'exo:TRAPPIST-1',
      approach: 'orbit',
    }, 100);

    await Promise.resolve();

    expect(onArrive).toHaveBeenCalledWith(
      'exo:TRAPPIST-1',
    );
  });

  it('round-trips percent-encoded host names in links', () => {
    const id = 'exo:HD%20209458';
    expect(parseDeepLink(formatDeepLink(id))).toBe(id);
  });

  it('preserves ordinary planet and galaxy deep links', () => {
    expect(
      parseDeepLink(formatDeepLink('planet:mars')),
    ).toBe('planet:mars');

    expect(
      parseDeepLink(
        formatDeepLink('galaxy:messier:M31'),
      ),
    ).toBe('galaxy:messier:M31');
  });
});
