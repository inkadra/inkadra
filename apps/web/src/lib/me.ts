/**
 * Id of the signed-in person, kept by the session provider for code that renders outside it
 * or must not import it (the notification texts, which tests render on their own).
 */
let current: string | null = null;

export function setSignedInId(id: string | null) {
  current = id;
}

export function signedInId(): string | null {
  return current;
}
