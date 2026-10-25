// "Where am I?" HUD (Lumi): names the scale of the universe the camera is in,
// from its distance to the Sun in metres. Pure function + tiny DOM helper.
const AU = 1.495978707e11;
const LY = 9.4607304725808e15;

export interface Zone { name: string; /** upper bound, metres (exclusive) */ maxM: number }

export const ZONES: readonly Zone[] = [
  { name: 'Inner Solar System', maxM: 5 * AU },
  { name: 'Outer Solar System', maxM: 120 * AU },     // ~heliopause
  { name: 'Oort Cloud', maxM: 1.5 * LY },
  { name: 'Solar Neighborhood', maxM: 1_000 * LY },
  { name: 'Milky Way', maxM: 100_000 * LY },          // stars-to-galaxies handoff
  { name: 'Local Group', maxM: 5e6 * LY },
  { name: 'Local Supercluster', maxM: 2e8 * LY },
  { name: 'Cosmic Web', maxM: Infinity },
];

/** Zone for a distance from the Sun (metres). Negative/NaN counts as 0. */
export function zoneFor(distanceM: number): Zone {
  const d = Number.isFinite(distanceM) && distanceM > 0 ? distanceM : distanceM === Infinity ? Infinity : 0;
  return ZONES.find((z) => d < z.maxM) ?? ZONES[ZONES.length - 1];
}

/** Writes the zone name into el only when it changes (avoids DOM churn every frame). */
export function makeZoneHud(el: HTMLElement | null): (distanceM: number) => string {
  let current = '';
  return (distanceM) => {
    const name = zoneFor(distanceM).name;
    if (el && name !== current) el.textContent = name;
    current = name;
    return name;
  };
}
