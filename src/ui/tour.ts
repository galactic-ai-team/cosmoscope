// Guided "Grand Tour" (Lumi). Flies outward through the scales, one stop at a
// time: Sun -> nearest star -> bright stars -> Milky Way -> Andromeda -> Virgo
// -> Coma. Each stop waits for arrival, dwells, then moves on. Any manual pick
// (search, deep link) should call stop(). Ids follow docs/CONTRACTS.md.
//
// v1.1: stop() freezes the tour on the current stop. The pending dwell timer
// is cleared, and if the camera was already flying to the next stop, that
// flight is cancelled (deps.cancel) and the camera flies back to the stop the
// tour was showing (Stop Tour button), so Stop never lands on the next stop
// (Nova's 15:55 test).

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
  /** Cancel the flight fly() started (called by stop() mid-leg). */
  cancel?(): void;
  /** Called on each stop (e.g. show the info panel / update the URL). */
  onStop?(id: string, index: number): void;
  /** Called when the tour ends (finished or stopped). */
  onEnd?(finished: boolean): void;
  wait?(ms: number, signal: AbortSignal): Promise<void>;
}

export interface Tour {
  start(): void;
  /**
   * End the tour. Clears the dwell timer and cancels a leg in flight.
   * returnToStop (the Stop Tour button): fly back to the stop on screen, whose
   * panel/URL are still showing. Off for a user grab or manual pick, which
   * take the camera elsewhere themselves.
   */
  stop(opts?: { returnToStop?: boolean }): void;
  readonly running: boolean;
  /** Last stop the tour arrived at (null before the first arrival). */
  readonly currentStop: string | null;
}

/** setTimeout sleep that clears its timer when signal aborts (and then never resolves). */
export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((r) => {
    if (signal?.aborted) return;
    const h = setTimeout(r, ms);
    signal?.addEventListener('abort', () => clearTimeout(h), { once: true });
  });

export function createTour(deps: TourDeps, stops: readonly string[] = GRAND_TOUR, dwellMs = 4000): Tour {
  const wait = deps.wait ?? sleep;
  let run = 0; // token: bumping it ends any loop in flight
  let running = false;
  let flying = false; // a leg's flight is in progress
  let current: string | null = null;
  let abort: AbortController | null = null;
  const end = (finished: boolean) => {
    running = false;
    deps.onEnd?.(finished);
  };
  return {
    get running() { return running; },
    get currentStop() { return current; },
    start() {
      abort?.abort();
      const mine = ++run;
      const ac = (abort = new AbortController());
      running = true;
      current = null;
      void (async () => {
        for (let i = 0; i < stops.length; i++) {
          flying = true;
          try {
            await deps.fly(stops[i]);
          } catch {
            if (mine !== run) return; // stopped or restarted
            flying = false;
            continue; // unknown target: skip it, keep touring
          }
          if (mine !== run) return;
          flying = false;
          current = stops[i];
          deps.onStop?.(stops[i], i);
          if (i < stops.length - 1) await wait(dwellMs, ac.signal);
          if (mine !== run) return;
        }
        end(true);
      })();
    },
    stop(opts) {
      if (!running) return;
      run++;
      abort?.abort();
      abort = null;
      if (flying) {
        flying = false;
        deps.cancel?.();
        if (opts?.returnToStop && current) deps.fly(current).catch(() => {});
      }
      end(false);
    },
  };
}
