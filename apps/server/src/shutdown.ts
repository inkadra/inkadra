import type { Logger } from 'pino';

/**
 * All of the shutdown, within the 30 s `stop_grace_period` of compose.yaml: Docker's SIGKILL
 * would otherwise end it at a random step (#796).
 */
export const SHUTDOWN_DEADLINE_MS = 25_000;
/** Running jobs (a transcode can take hours) get this long; BullMQ runs them again later. */
export const WORKER_CLOSE_MS = 10_000;

/** True once `work` settled within `ms`; false if it is still running. Never rejects. */
export async function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true,
      ),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs the closers in order, each one's error logged; false when the deadline cut it short. */
export function closeAll(
  closers: Array<() => Promise<unknown>>,
  log: Logger,
  deadlineMs = SHUTDOWN_DEADLINE_MS,
): Promise<boolean> {
  const run = (async () => {
    for (const close of closers) {
      try {
        await close();
      } catch (err) {
        log.error({ err }, 'error during shutdown');
      }
    }
  })();
  return settledWithin(run, deadlineMs);
}

/**
 * One shutdown, however often it is asked for: a second SIGTERM or a lost lease while boards are
 * being stored must not end the process early. Asked before `ready` (still starting), it runs
 * once everything to close is known.
 */
export function shutdownOnce(run: (reason: string) => Promise<void>) {
  let ready = false;
  let asked: string | undefined;
  let started = false;
  const start = (reason: string) => {
    if (started) return;
    started = true;
    void run(reason);
  };
  return {
    request(reason: string) {
      if (ready) start(reason);
      else asked ??= reason;
    },
    ready() {
      ready = true;
      if (asked) start(asked);
    },
  };
}
