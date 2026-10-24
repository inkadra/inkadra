/**
 * What a reload for a new version must wait for: a board with changes the server does not have
 * yet, an upload still running. Nothing is stored locally, so reloading would lose them.
 * Each holder sets its own reason (any value) busy or idle.
 */

const reasons = new Set<unknown>();
const pending = new Set<() => void>();

export function setBusy(reason: unknown, busy: boolean) {
  if (busy) {
    reasons.add(reason);
    return;
  }
  if (!reasons.delete(reason) || reasons.size > 0) return;
  const ready = [...pending];
  pending.clear();
  for (const run of ready) run();
}

export function isBusy(): boolean {
  return reasons.size > 0;
}

/** Runs `run` now if nothing is busy, otherwise as soon as nothing is. Returns a cancel. */
export function whenIdle(run: () => void): () => void {
  if (!isBusy()) {
    run();
    return () => {};
  }
  pending.add(run);
  return () => pending.delete(run);
}
