/** What the collab server last said about our access (see BoardConnection). */
export interface AccessState {
  accessChangedAt: number | null;
  readOnly: boolean;
}

/**
 * Hands out each access change once: re-renders for other reasons (a new language, a
 * reconnection that repeats the same role) must not show the notice again.
 */
export function accessNotices() {
  let seen: number | null = null;
  return (state: AccessState): { readOnly: boolean } | null => {
    if (state.accessChangedAt === null || state.accessChangedAt === seen) return null;
    seen = state.accessChangedAt;
    return { readOnly: state.readOnly };
  };
}
