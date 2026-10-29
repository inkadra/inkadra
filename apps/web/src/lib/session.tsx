import type { Instance, User } from '@inkadra/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import i18n, { LOCALES, type Locale } from '../i18n/index.ts';
import { api, RequestError } from './api.ts';

interface SessionState {
  instance: Instance | null;
  user: User | null;
  loading: boolean;
  enrollmentRequired?: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrollmentRequired, setEnrollmentRequired] = useState(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    // Only the most recent refresh applies: an older one finishing late must not bring back
    // the language (or user) it read before a newer save.
    const call = ++latest.current;
    const [inst, me] = await Promise.all([
      api.get<Instance>('/instance'),
      api.get<User>('/me').catch((err) => {
        if (err instanceof RequestError && err.status === 401) return null;
        throw err;
      }),
    ]);
    let required = false;
    if (me?.role === 'admin' && !me.twoFactorEnabled) {
      await api.get('/instance/settings').catch((err) => {
        required =
          err instanceof RequestError &&
          err.status === 403 &&
          (err.details as { reason?: string } | undefined)?.reason === 'admin_two_factor_required';
        if (!required) throw err;
      });
    }
    if (call !== latest.current) return;
    setEnrollmentRequired(required);
    setInstance(inst);
    setUser(me);
    if (me?.locale) {
      const base = me.locale.slice(0, 2) as Locale;
      if (LOCALES.includes(base) && i18n.language !== base) {
        await i18n.changeLanguage(base);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ instance, user, loading, refresh, enrollmentRequired }}>
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
