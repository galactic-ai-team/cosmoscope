
/**
 * HYG v4.1 stellar catalog adapter — GPT-6.
 * Catalog integration owned by Lumi.
 *
 * Distances in metres from the Sun.
 * Positions in equatorial J2000 parsecs.
 */
import { register, type CatalogEntry } from '../../catalog';

export const PARSEC_METRES = 3.0856775814913673e16;

export type HygRow = readonly [
  id: number,
  xPc: number,
  yPc: number,
  zPc: number,
  magnitude: number,
  colorIndex: number,
  spectral: string,
  name: string,
  aliases: string[],
  distancePc: number,
];

export type StarData = {
  source: string;
  license: string;
  epoch: string;
  axes: string;
  unit: string;
  columns: string[];
  stars: HygRow[];
};

/** One-time catalog registration, never in the render loop. */
export function registerHygStars(rows: readonly HygRow[]): void {
  register([{
    id: 'star:sol:sun',
    name: 'Sun',
    aliases: ['Sol'],
    kind: 'star',
    distanceM: 0,
    facts: {
      'Spectral class': 'G2V',
      'Distance': '0 light-years',
      'Catalog': 'Solar System',
    },
    blurb: 'The star at the center of our solar system.',
  }]);

  const entries: CatalogEntry[] = rows.map((row) => ({
    id: `star:hyg:${row[0]}`,
    name: row[7],
    aliases: row[8],
    kind: 'star',
    distanceM: row[9] * PARSEC_METRES,
    facts: {
      'Spectral class': row[6] || 'Unknown',
      'Apparent magnitude': row[4].toFixed(2),
      'Distance': `${(row[9] * 3.26156).toFixed(2)} light-years`,
      'B−V color index': row[5].toFixed(2),
      'Catalog': `HYG ${row[0]}`,
    },
    blurb: 'A star cataloged by the HYG database (J2000 position).',
  }));

  register(entries);
}

/** Fetch the static HYG subset once before registering the layer. */
export async function loadHygStars(
  url = '/data/hyg-v41.json',
): Promise<HygRow[]> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HYG subset fetch failed (${response.status})`);
  }

  const data = (await response.json()) as StarData;

  if (
    !data ||
    data.unit !== 'parsec' ||
    data.epoch !== 'J2000' ||
    data.axes !== 'equatorial' ||
    !Array.isArray(data.stars)
  ) {
    throw new Error('Incompatible HYG star subset');
  }

  registerHygStars(data.stars);
  return data.stars;
}

