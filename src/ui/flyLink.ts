// Search -> flyTo bridge (Lumi). Wires a search pick to Dee's FlyToController
// using only the shape of its API, so this file builds before core/ lands.
// Contract: ids are <kind>:<catalog>:<id> (e.g. galaxy:messier:M31), see docs/CONTRACTS.md.

export type TargetKind = 'planet' | 'star' | 'galaxy';
/** Id prefixes search can route. 'cluster' = galaxy clusters (Virgo, Coma, Fornax) from Nova's galaxies data. */
export type PickKind = TargetKind | 'cluster';
export type Approach = 'orbit' | 'surface' | 'flyby';

/** Structural match for Dee's FlyToController.flyTo (src/core/flyTo.ts). */
export interface Flyer {
  flyTo(t: { kind: TargetKind; id: string; approach: Approach }, now?: number): { promise: Promise<void>; cancel(): void };
}

const KINDS: readonly PickKind[] = ['planet', 'star', 'galaxy', 'cluster'];

/** Infer the pick kind from an id prefix, or null if the prefix is unknown. */
export function kindFromId(id: string): PickKind | null {
  const idx = id.indexOf(':');
  if (idx <= 0) return null;
  const k = id.slice(0, idx) as PickKind;
  return KINDS.includes(k) ? k : null;
}

/**
 * Map a pick kind to a kind Dee's FlyToTarget accepts. Dee's flyTo resolves
 * targets by id via registry.resolveTarget, so kind is informational only;
 * a galaxy cluster flies like a galaxy (same extragalactic scale/frames).
 * TODO(Dee): if FlyToTarget.kind gains 'cluster', drop this mapping.
 */
export function flightKind(k: PickKind): TargetKind {
  return k === 'cluster' ? 'galaxy' : k;
}

/**
 * Returns an onPick handler for mountSearch. Each pick cancels the flight in
 * progress, then calls onArrive(id) once the new flight resolves (used to show
 * the info panel only after arrival). Errors (unknown target) go to onError.
 */
export function linkSearchToFlight(
  flyer: Flyer,
  onArrive: (id: string) => void,
  onError: (id: string, err: unknown) => void = (id, err) => console.warn('flyTo failed', id, err),
  /** Loop clock in seconds (main.ts owns the loop); keeps flights on the same time base as update(dt). */
  now: () => number = () => performance.now() / 1000,
): (id: string) => void {
  let current: { cancel(): void } | null = null;
  let seq = 0;
  return (id: string) => {
    const kind = kindFromId(id);
    if (!kind) { onError(id, new Error(`No layer kind for id: ${id}`)); return; }
    current?.cancel();
    // Tag this pick; only the latest pick's handlers fire.
    const mine = ++seq;
    const h = flyer.flyTo({ kind: flightKind(kind), id, approach: 'orbit' }, now());
    current = h;
    h.promise.then(
      () => { if (mine === seq) onArrive(id); },
      (err) => { if (mine === seq) onError(id, err); },
    );
  };
}
