import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { get, search } from '../../catalog';
import { PARSEC_METRES } from '../stars/catalog';

import {
  AU_METRES,
  EXO_APPROACH_AU,
  clearExoplanetSystems,
  exoplanetCatalogEntries,
  getExoplanetSystem,
  loadExoplanetSystems,
  parseExoplanetData,
  planetParameterSummary,
  registerExoplanetSystems,
  resolveExoplanetTarget,
  type ExoplanetData,
} from './catalog';

const fixture: ExoplanetData = {
  schemaVersion: 1,
  source: 'NASA Exoplanet Archive',
  sourceUrl:
    'https://exoplanetarchive.ipac.caltech.edu/TAP/sync',
  table: 'pscomppars',
  license: 'NASA Exoplanet Archive data; cite source',
  epoch: 'J2000',
  axes: 'equatorial',
  unit: 'parsec',
  notes: 'Approximate orbital visualizations.',
  systems: [
    {
      id: 'exo:Example-1',
      hostname: 'Example-1',
      positionPc: [3, 4, 0],
      distancePc: 5,
      raDeg: 53.13010235,
      decDeg: 0,
      starCount: 1,
      planets: [
        {
          name: 'Example-1 b',
          periodDays: 12,
          semiMajorAu: 0.1,
          radiusEarth: 1.5,
          massEarth: null,
        },
        {
          name: 'Example-1 c',
          periodDays: null,
          semiMajorAu: null,
          radiusEarth: 2,
          massEarth: null,
        },
      ],
    },
  ],
};

function cloned(): ExoplanetData {
  return structuredClone(fixture);
}

afterEach(() => {
  clearExoplanetSystems();
  vi.unstubAllGlobals();
});

describe('static exoplanet catalog', () => {
  it('accepts J2000 equatorial parsec coordinates', () => {
    const result = parseExoplanetData(cloned());

    expect(result.systems).toHaveLength(1);
    expect(result.systems[0].positionPc).toEqual([3, 4, 0]);
    expect(result.systems[0].distancePc).toBe(5);
  });

  it('rejects incompatible axes or epoch', () => {
    expect(() =>
      parseExoplanetData({
        ...cloned(),
        epoch: 'J2050',
      }),
    ).toThrow();

    expect(() =>
      parseExoplanetData({
        ...cloned(),
        axes: 'ecliptic',
      }),
    ).toThrow();
  });

  it('rejects coordinates inconsistent with distance', () => {
    const data = cloned();
    data.systems[0].positionPc = [30, 40, 0];

    expect(() => parseExoplanetData(data)).toThrow(
      /coordinates disagree/,
    );
  });

  it('rejects duplicate host IDs', () => {
    const data = cloned();
    data.systems.push(structuredClone(data.systems[0]));

    expect(() => parseExoplanetData(data)).toThrow();
  });

  it('rejects invalid orbital values', () => {
    const data = cloned();
    data.systems[0].planets[0].periodDays = -12;

    expect(() => parseExoplanetData(data)).toThrow();
  });

  it('preserves missing orbital properties', () => {
    const result = parseExoplanetData(cloned());
    const planet = result.systems[0].planets[1];

    expect(planet.periodDays).toBeNull();
    expect(planet.semiMajorAu).toBeNull();

    const facts = planetParameterSummary(planet);
    expect(facts['Orbital period']).toBe('Unknown');
    expect(facts['Orbit visualization']).toBe('Approximate');
  });

  it('creates searchable host and planet aliases', () => {
    const entries = exoplanetCatalogEntries(
      cloned().systems,
    );

    expect(entries[0].id).toBe('exo:Example-1');
    expect(entries[0].kind).toBe('star');
    expect(entries[0].aliases).toContain('Example-1 b');
    expect(entries[0].distanceM).toBe(
      5 * PARSEC_METRES,
    );
  });

  it('registers host systems in the existing catalog', () => {
    const count = registerExoplanetSystems(cloned());

    expect(count).toBe(1);
    expect(get('exo:Example-1')?.name).toBe(
      'Example-1 system',
    );
    expect(
      search('Example-1 b').some(
        (entry) => entry.id === 'exo:Example-1',
      ),
    ).toBe(true);
  });

  it('resolves native galactic coordinates for future flyTo', () => {
    registerExoplanetSystems(cloned());

    const target = resolveExoplanetTarget(
      'exo:Example-1',
    );

    expect(target?.frameId).toBe('galactic');
    expect(Array.from(target!.worldPos)).toEqual([
      3, 4, 0,
    ]);
    expect(target?.approachRadius).toBeCloseTo(
      EXO_APPROACH_AU * AU_METRES / PARSEC_METRES,
      12,
    );
  });

  it('returns null for an unknown target', () => {
    expect(
      resolveExoplanetTarget('exo:unknown'),
    ).toBeNull();
    expect(
      getExoplanetSystem('exo:unknown'),
    ).toBeUndefined();
  });

  it('loads static data without contacting NASA', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe('/data/exoplanet-systems.json');

      return {
        ok: true,
        json: async () => cloned(),
      };
    });

    vi.stubGlobal('fetch', fetcher);

    await expect(
      loadExoplanetSystems(),
    ).resolves.toBe(1);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getExoplanetSystem('exo:Example-1')).toBeDefined();
  });

  it('rejects static file HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
    })));

    await expect(
      loadExoplanetSystems(),
    ).rejects.toThrow('404');
  });
});
