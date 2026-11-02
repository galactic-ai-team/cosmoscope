/**
 * Cosmoscope — static confirmed-exoplanet catalog
 * GPT-6 / Exoplanet lane, stage 1
 *
 * Host positions are Sun-centered ICRS/J2000 equatorial XYZ,
 * in parsecs, compatible with the existing HYG stars layer.
 *
 * The static JSON is fetched from our own Vite public/data.
 * NASA's API is never called by the running application.
 */

import {
  register,
  type CatalogEntry,
} from '../../catalog';

import type { ResolvedTarget } from '../../core/layers';

import { PARSEC_METRES } from '../stars/catalog';

export const EXOPLANET_DATA_URL =
  '/data/exoplanet-systems.json';

export const AU_METRES = 1.495978707e11;
export const EXO_APPROACH_AU = 100;

export interface ExoplanetRecord {
  name: string;
  periodDays: number | null;
  semiMajorAu: number | null;
  radiusEarth: number | null;
  massEarth: number | null;
}

export interface ExoplanetSystem {
  id: string;
  hostname: string;
  positionPc: [number, number, number];
  distancePc: number;
  raDeg: number;
  decDeg: number;
  starCount: number;
  planets: ExoplanetRecord[];
}

export interface ExoplanetData {
  schemaVersion: 1;
  source: string;
  sourceUrl: string;
  table: 'pscomppars';
  license: string;
  epoch: 'J2000';
  axes: 'equatorial';
  unit: 'parsec';
  notes: string;
  systems: ExoplanetSystem[];
}

const registry = new Map<string, ExoplanetSystem>();

function record(value: unknown): Record<string, unknown> | null {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optionalPositive(
  value: unknown,
): value is number | null {
  return value === null ||
    (finite(value) && value > 0);
}

/**
 * Decode and validate the complete static data file.
 * Reject partially corrupt catalogs rather than registering
 * broken coordinates and making flyTo unreliable.
 */
export function parseExoplanetData(
  input: unknown,
): ExoplanetData {
  const data = record(input);

  if (
    !data ||
    data.schemaVersion !== 1 ||
    data.table !== 'pscomppars' ||
    data.epoch !== 'J2000' ||
    data.axes !== 'equatorial' ||
    data.unit !== 'parsec' ||
    !nonempty(data.source) ||
    !nonempty(data.sourceUrl) ||
    !nonempty(data.license) ||
    typeof data.notes !== 'string' ||
    !Array.isArray(data.systems)
  ) {
    throw new Error('Invalid exoplanet catalog metadata');
  }

  const systems: ExoplanetSystem[] = [];
  const ids = new Set<string>();

  for (const raw of data.systems) {
    const s = record(raw);

    if (
      !s ||
      !nonempty(s.hostname) ||
      !nonempty(s.id) ||
      s.id !== `exo:${encodeURIComponent(s.hostname)}` ||
      ids.has(s.id) ||
      !Array.isArray(s.positionPc) ||
      s.positionPc.length !== 3 ||
      !s.positionPc.every(finite) ||
      !finite(s.distancePc) ||
      s.distancePc <= 0 ||
      !finite(s.raDeg) ||
      s.raDeg < 0 ||
      s.raDeg >= 360 ||
      !finite(s.decDeg) ||
      Math.abs(s.decDeg) > 90 ||
      !Number.isSafeInteger(s.starCount) ||
      (s.starCount as number) < 1 ||
      !Array.isArray(s.planets) ||
      s.planets.length === 0
    ) {
      throw new Error('Invalid exoplanet system record');
    }

    const norm = Math.hypot(
      s.positionPc[0],
      s.positionPc[1],
      s.positionPc[2],
    );

    // XYZ must agree with the catalog distance.
    if (
      Math.abs(norm - s.distancePc) >
      Math.max(0.000001, s.distancePc * 0.000001)
    ) {
      throw new Error(`Exoplanet coordinates disagree: ${s.id}`);
    }

    const planets: ExoplanetRecord[] = [];
    const planetNames = new Set<string>();

    for (const rawPlanet of s.planets) {
      const p = record(rawPlanet);

      if (
        !p ||
        !nonempty(p.name) ||
        planetNames.has(p.name.toLowerCase()) ||
        !optionalPositive(p.periodDays) ||
        !optionalPositive(p.semiMajorAu) ||
        !optionalPositive(p.radiusEarth) ||
        !optionalPositive(p.massEarth)
      ) {
        throw new Error(`Invalid planet in ${s.id}`);
      }

      planetNames.add(p.name.toLowerCase());

      planets.push({
        name: p.name,
        periodDays: p.periodDays,
        semiMajorAu: p.semiMajorAu,
        radiusEarth: p.radiusEarth,
        massEarth: p.massEarth,
      });
    }

    const system: ExoplanetSystem = {
      id: s.id,
      hostname: s.hostname,
      positionPc: [
        s.positionPc[0],
        s.positionPc[1],
        s.positionPc[2],
      ],
      distancePc: s.distancePc,
      raDeg: s.raDeg,
      decDeg: s.decDeg,
      starCount: s.starCount,
      planets,
    };

    ids.add(system.id);
    systems.push(system);
  }

  return {
    schemaVersion: 1,
    source: data.source,
    sourceUrl: data.sourceUrl,
    table: 'pscomppars',
    license: data.license,
    epoch: 'J2000',
    axes: 'equatorial',
    unit: 'parsec',
    notes: data.notes,
    systems,
  };
}

function formatOptional(
  value: number | null,
  unit: string,
): string {
  return value === null
    ? 'Unknown'
    : `${value.toLocaleString(undefined, {
        maximumFractionDigits: 3,
      })} ${unit}`;
}

/**
 * Build search entries without mutating the global catalog.
 *
 * Existing EntryKind has no "exoplanet" value, so systems
 * use "star" until Lumi extends the shared search contract.
 * An exo:* ID still requires a matching layer resolver
 * before it can be passed to FlyToController.
 */
export function exoplanetCatalogEntries(
  systems: readonly ExoplanetSystem[],
): CatalogEntry[] {
  return systems.map((system) => {
    const aliases = system.planets
      .map((p) => p.name)
      .filter((name) => name !== system.hostname);

    return {
      id: system.id,
      name: `${system.hostname} system`,
      aliases: [system.hostname, ...aliases],
      kind: 'star',
      distanceM: system.distancePc * PARSEC_METRES,
      facts: {
        'Confirmed planets': String(system.planets.length),
        'Host stars': String(system.starCount),
        'Distance': `${(
          system.distancePc * 3.26156
        ).toFixed(2)} light-years`,
        'Coordinate epoch': 'ICRS / J2000',
        'Orbit visualization': 'Approximate, not ephemeris',
      },
      blurb:
        `Confirmed exoplanet system from the NASA ` +
        `Exoplanet Archive. Planet sizes and orbital ` +
        `parameters may be incomplete; future orbit ` +
        `visualizations will be schematic.`,
    };
  });
}

/**
 * Commit the validated data to the local registry and
 * register its entries for Lumi's search UI.
 */
export function registerExoplanetSystems(
  data: ExoplanetData,
): number {
  const validated = parseExoplanetData(data);

  registry.clear();

  for (const system of validated.systems) {
    registry.set(system.id, system);
  }

  register(exoplanetCatalogEntries(validated.systems));

  return validated.systems.length;
}

/** Look up an already registered exoplanet host system. */
export function getExoplanetSystem(
  id: string,
): ExoplanetSystem | undefined {
  return registry.get(id);
}

/**
 * Resolve an exoplanet host into the same native galactic
 * frame as the existing HYG star targets.
 *
 * Stage 2 will expose this through an exo ScaleLayer.
 */
export function resolveExoplanetTarget(
  id: string,
): ResolvedTarget | null {
  const system = registry.get(id);
  if (!system) return null;

  return {
    frameId: 'galactic',
    worldPos: new Float64Array(system.positionPc),
    approachRadius:
      EXO_APPROACH_AU * AU_METRES / PARSEC_METRES,
  };
}

/** Clear only this adapter's local lookup, useful for tests. */
export function clearExoplanetSystems(): void {
  registry.clear();
}

/**
 * Load the checked-in static JSON from this deployment.
 * No NASA Archive runtime fetch is performed.
 */
export async function loadExoplanetSystems(
  url = EXOPLANET_DATA_URL,
): Promise<number> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Exoplanet static catalog failed (${response.status})`,
    );
  }

  const data = parseExoplanetData(
    await response.json() as unknown,
  );

  return registerExoplanetSystems(data);
}

/** Display-only orbital parameters for the future renderer. */
export function planetParameterSummary(
  planet: ExoplanetRecord,
): Record<string, string> {
  return {
    'Orbital period': formatOptional(
      planet.periodDays,
      'days',
    ),
    'Semi-major axis': formatOptional(
      planet.semiMajorAu,
      'AU',
    ),
    'Radius': formatOptional(
      planet.radiusEarth,
      'Earth radii',
    ),
    'Mass': formatOptional(
      planet.massEarth,
      'Earth masses',
    ),
    'Orbit visualization': 'Approximate',
  };
}
