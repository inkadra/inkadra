import { createContext, useContext } from 'react';
import type { SessionState } from './session.tsx';

/** Apart from session.tsx, which loads the translations: board fields need only this. */
export const SessionContext = createContext<SessionState | null>(null);

/** False outside a session too: the guest page shares these fields and has no account. */
export function useIsAdmin(): boolean {
  return useContext(SessionContext)?.user?.role === 'admin';
}
