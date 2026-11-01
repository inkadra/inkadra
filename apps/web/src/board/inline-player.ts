import { useSyncExternalStore } from 'react';

/** The link card whose video plays in place. Only one at a time: starting another stops it. */
let active: string | null = null;
const listeners = new Set<() => void>();

export function playInline(id: string | null): void {
  if (active === id) return;
  active = id;
  for (const listener of listeners) listener();
}

/** Stops the player of this card, if it is the one playing. */
export function stopInline(id: string): void {
  if (active === id) playInline(null);
}

export const isPlayingInline = (id: string) => active === id;

export function subscribeInline(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInlinePlaying(id: string): boolean {
  return useSyncExternalStore(
    subscribeInline,
    () => isPlayingInline(id),
    () => false,
  );
}
