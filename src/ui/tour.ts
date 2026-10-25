// Guided "Grand Tour" (Lumi). Flies outward through the scales, one stop at a
// time: Sun -> nearest star -> bright stars -> Milky Way -> Andromeda -> Virgo
// -> Coma. Each stop waits for arrival, dwells, then moves on. Any manual pick
// (search, deep link) should call stop(). Ids follow docs/CONTRACTS.md.

export const GRAND_TOUR: readonly string[] = [
  'star:sol:sun',
  'star:hyg:71456', // Rigil Kentaurus (Alpha Centauri A)
  'star:hyg:32263', // Sirius
  'star:hyg:27919', // Betelgeuse
  'galaxy:common:milkyway',
  'galaxy:messier:M31',
  'cluster:common:virgo',
  'cluster:abell:1656', // Coma
];

export interface TourDeps {
  /** Start a flight; resolves on arrival, rejects if cancelled or unknown. */
  fly(id: string): Promise<void>;
  /** Called on each stop (e.g. show the info panel / update the URL). */
  onStop?(id: string, index: number): void;
  /** Called when the tour ends (finished or stopped). */
  onEnd?(finished: boolean): void;
  wait?(ms: number): Promise<void>;
}

export interface Tour {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createTour(deps: TourDeps, stops: readonly string[] = GRAND_TOUR, dwellMs = 4000): Tour {
  const wait = deps.wait ?? sleep;
  let run = 0; // token: bumping it ends any loop in flight
  let running = false;
  const end = (finished: boolean) => {
    running = false;
    deps.onEnd?.(finished);
  };
  return {
    get running() { return running; },
    start() {
      const mine = ++run;
      running = true;
      void (async () => {
        for (let i = 0; i < stops.length; i++) {
          try {
            await deps.fly(stops[i]);
          } catch {
            if (mine !== run) return; // stopped or restarted
            continue; // unknown target: skip it, keep touring
          }
          if (mine !== run) return;
          deps.onStop?.(stops[i], i);
          if (i < stops.length - 1) await wait(dwellMs);
          if (mine !== run) return;
        }
        end(true);
      })();
    },
    stop() {
      if (!running) return;
      run++;
      end(false);
    },
  };
}
