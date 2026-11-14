/**
 * What a reload for a new version must wait for: a board with changes the server does not have
 * yet, an upload that can still run. Nothing is stored locally, so reloading would lose them
 * (`setUnsaved` below asks before the person closes or reloads the tab).
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

/**
 * Work that exists only in this tab (board edits the server has not confirmed, files still
 * uploading): while any is held, the browser asks before the tab closes or reloads.
 */
const unsaved = new Set<unknown>();

function warnOnLeave(event: BeforeUnloadEvent) {
  event.preventDefault();
}

export function setUnsaved(reason: unknown, held: boolean) {
  const before = unsaved.size;
  if (held) unsaved.add(reason);
  else unsaved.delete(reason);
  // Listening only while needed keeps the page eligible for the back/forward cache.
  if (before === 0 && unsaved.size > 0) window.addEventListener('beforeunload', warnOnLeave);
  if (before > 0 && unsaved.size === 0) window.removeEventListener('beforeunload', warnOnLeave);
}

export function hasUnsaved(): boolean {
  return unsaved.size > 0;
}
