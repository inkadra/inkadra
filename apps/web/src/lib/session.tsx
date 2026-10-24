import type { Instance, User } from '@inkadra/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, RequestError } from './api.ts';

interface SessionState {
  instance: Instance | null;
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [inst, me] = await Promise.all([
      api.get<Instance>('/instance'),
      api.get<User>('/me').catch((err) => {
        if (err instanceof RequestError && err.status === 401) return null;
        throw err;
      }),
    ]);
    setInstance(inst);
    setUser(me);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ instance, user, loading, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

const NO_SESSION: SessionState = {
  instance: null,
  user: null,
  loading: false,
  refresh: async () => {},
};

/**
 * For pages used without an account, such as the guest page of a share link: components that
 * read the session see nobody signed in, and nothing asks the server for one.
 */
export function NoSessionProvider({ children }: { children: ReactNode }) {
  return <SessionContext.Provider value={NO_SESSION}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
