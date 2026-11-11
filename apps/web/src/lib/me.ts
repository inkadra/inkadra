/**
 * Id of the signed-in person, kept by the session provider for code that renders outside it
 * or must not import it (the notification texts, which tests render on their own).
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export function setSignedInId(id: string | null) {
  if (id === current) return;
  current = id;
  for (const listener of listeners) listener();
}

/**
 * Calls `listener` whenever another person signs in, or nobody: caches of what a person may
 * read drop what the previous one read. Returns the unsubscribe.
 */
export function onSignedInChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function signedInId(): string | null {
  return current;
}
