import type { Instance, User } from '@inkadra/shared';
import { type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import i18n, { LOCALES, type Locale } from '../i18n/index.ts';
import { api, RequestError } from './api.ts';
import { setSignedInId } from './me.ts';
import { loadPreferences } from './preferences.ts';
import { SessionContext } from './session-context.ts';

export interface SessionState {
  instance: Instance | null;
  user: User | null;
  loading: boolean;
  version?: string;
  enrollmentRequired?: boolean;
  /** The first load could not reach the server (#821); it tries again by itself. */
  unreachable?: boolean;
  /** Tries the first load again now. */
  retry?: () => void;
  refresh: () => Promise<void>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrollmentRequired, setEnrollmentRequired] = useState(false);
  const [version, setVersion] = useState<string>();
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
    // One authenticated probe supplies the version and the enrollment decision. Missing
    // metadata must not prevent startup; only the explicit policy denial gates the workspace.
    let required = false;
    const identity = me
      ? await api.get<{ version: string }>('/instance/version').catch((err) => {
          required =
            err instanceof RequestError &&
            err.status === 403 &&
            (err.details as { reason?: string } | undefined)?.reason ===
              'admin_two_factor_required';
          return null;
        })
      : null;
    if (call !== latest.current) return;
    setEnrollmentRequired(required);
    setVersion(identity?.version);
    setInstance(inst);
    setUser(me);
    setSignedInId(me?.id ?? null);
    // The cached preferences stay in use if the server cannot be reached.
    if (me) void loadPreferences().catch(() => {});
    if (me?.locale) {
      const base = me.locale.slice(0, 2) as Locale;
      if (LOCALES.includes(base) && i18n.language !== base) {
        await i18n.changeLanguage(base);
      }
    } else if (me) {
      // Sign-up sets no language, and emails need one. A failed save retries on the next load.
      void api.patch('/me', { locale: i18n.language }).catch(() => {});
    }
    setLoading(false);
  }, []);

  // A failed first load (server restarting, network down, proxy error) is counted, so the
  // page can say so and try again on its own instead of staying blank (#821).
  const [failures, setFailures] = useState(0);
  const retry = useCallback(() => {
    refresh().then(
      () => setFailures(0),
      () => setFailures((n) => n + 1),
    );
  }, [refresh]);
  useEffect(retry, [retry]);
  useEffect(() => {
    if (!failures || !loading) return;
    // 2 s, 4 s, 8 s… up to 30 s; at once when the network comes back.
    const timer = setTimeout(retry, Math.min(30_000, 1000 * 2 ** failures));
    window.addEventListener('online', retry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [failures, loading, retry]);

  return (
    <SessionContext.Provider
      value={{
        instance,
        user,
        loading,
        refresh,
        enrollmentRequired,
        version,
        unreachable: loading && failures > 0,
        retry,
      }}
    >
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
