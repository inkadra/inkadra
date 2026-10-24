/**
 * How the guest page asks the server whether the board changed, without React so it can be
 * tested with fake timers. One request at a time; after a failure the wait doubles up to a
 * cap, and a `Retry-After` of the server is honoured; nothing is asked while the page is
 * hidden.
 */

/** What one request meant: go on, try again later (after at least `after` ms), or stop. */
export type PollOutcome = { kind: 'ok' } | { kind: 'retry'; after?: number } | { kind: 'done' };

export interface PollerOptions {
  run: (signal: AbortSignal) => Promise<PollOutcome>;
  /** Wait between two requests while all is well. */
  interval: number;
  /** Longest wait after failures. */
  max: number;
  hidden?: () => boolean;
  now?: () => number;
}

export interface Poller {
  start: () => void;
  /**
   * Asks now: on focus, when the page shows again, back online, or after an action of the
   * guest (`force`, which runs once more after a request in flight instead of being dropped).
   * Never sooner than the server asked with Retry-After.
   */
  poke: (opts?: { force?: boolean }) => void;
  stop: () => void;
}

/** Wait after `failures` failures in a row. */
export function backoff(failures: number, interval: number, max: number): number {
  if (failures <= 0) return interval;
  return Math.min(max, interval * 2 ** failures);
}

export function createPoller(o: PollerOptions): Poller {
  const hidden = o.hidden ?? (() => false);
  const now = o.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let inFlight = false;
  let again = false;
  let stopped = false;
  let failures = 0;
  let notBefore = 0;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      // A hidden page asks again when it shows (poke on visibilitychange).
      if (!hidden()) void tick();
    }, ms);
  };

  async function tick() {
    if (stopped || inFlight) return;
    clearTimeout(timer);
    timer = undefined;
    inFlight = true;
    const current = new AbortController();
    controller = current;
    let out: PollOutcome;
    try {
      out = await o.run(current.signal);
    } catch {
      out = { kind: 'retry' };
    }
    inFlight = false;
    controller = null;
    if (out.kind === 'done') {
      stopped = true;
      return;
    }
    if (stopped) return;
    if (out.kind === 'ok') {
      failures = 0;
      notBefore = 0;
      if (again) {
        again = false;
        void tick();
        return;
      }
      schedule(o.interval);
      return;
    }
    again = false;
    failures += 1;
    const wait = Math.max(backoff(failures, o.interval, o.max), out.after ?? 0);
    if (out.after !== undefined) notBefore = now() + wait;
    schedule(wait);
  }

  return {
    start: () => void tick(),
    poke: ({ force = false } = {}) => {
      if (stopped || hidden()) return;
      if (inFlight) {
        if (force) again = true;
        return;
      }
      if (now() < notBefore) {
        // The timer may have fired while the page was hidden.
        if (!timer) schedule(notBefore - now());
        return;
      }
      void tick();
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    },
  };
}
