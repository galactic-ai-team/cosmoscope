/**
 * Search -> flyTo bridge (Lumi).
 *
 * Exoplanet hosts use exo:<encoded-hostname> IDs.
 * They resolve through the exo ScaleLayer, while Dee's
 * FlyToTarget receives the existing 'star' kind.
 */

export type TargetKind = 'planet' | 'star' | 'galaxy';
export type PickKind =
  | TargetKind
  | 'cluster'
  | 'cosmicweb'
  | 'exo'
  | 'moon';

export type Approach = 'orbit' | 'surface' | 'flyby';

export interface Flyer {
  flyTo(
    t: {
      kind: TargetKind;
      id: string;
      approach: Approach;
    },
    now?: number,
  ): {
    promise: Promise<void>;
    cancel(): void;
  };
}

const KINDS: readonly PickKind[] = [
  'planet',
  'star',
  'galaxy',
  'cluster',
  'cosmicweb',
  'exo',
  'moon',
];

export function kindFromId(id: string): PickKind | null {
  const idx = id.indexOf(':');
  if (idx <= 0) return null;

  const kind = id.slice(0, idx) as PickKind;

  return KINDS.includes(kind) ? kind : null;
}

export function flightKind(kind: PickKind): TargetKind {
  if (kind === 'cluster' || kind === 'cosmicweb') {
    return 'galaxy';
  }

  if (kind === 'exo') {
    return 'star';
  }

  if (kind === 'moon') {
    return 'planet'; // moons resolve through SolarSystemLayer like planets
  }

  return kind;
}

export function linkSearchToFlight(
  flyer: Flyer,
  onArrive: (id: string) => void,
  onError: (id: string, err: unknown) => void =
    (id, err) => console.warn('flyTo failed', id, err),
  now: () => number =
    () => performance.now() / 1000,
): (id: string) => void {
  let current: { cancel(): void } | null = null;
  let seq = 0;

  return (id: string) => {
    const kind = kindFromId(id);

    if (!kind) {
      onError(id, new Error(`No layer kind for id: ${id}`));
      return;
    }

    current?.cancel();

    const mine = ++seq;

    const h = flyer.flyTo({
      kind: flightKind(kind),
      id,
      approach: 'orbit',
    }, now());

    current = h;

    h.promise.then(
      () => {
        if (mine === seq) onArrive(id);
      },
      (err) => {
        if (mine === seq) onError(id, err);
      },
    );
  };
}
