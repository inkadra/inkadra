import { Dialog } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { SignInOptions } from './SignInOptions.tsx';
import './login.css';

/** Keep only the pending input, never credentials or a returned token, across provider redirects. */
export function useFreshSignIn<T>(
  action: (input: T) => Promise<void>,
  fail: (err: unknown) => void,
) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [pending, setPending] = useState<{ input: T; userId: string } | null>(null);
  const next = window.location.pathname + window.location.search;
  const key = `inkadra:reauth:${next}`;
  const latest = useRef({ action, fail });
  latest.current = { action, fail };

  async function run(input: T) {
    try {
      await latest.current.action(input);
    } catch (err) {
      if (
        err instanceof RequestError &&
        err.status === 403 &&
        (err.details as { reason?: string } | undefined)?.reason === 'reauth_required' &&
        user
      ) {
        setPending({ input, userId: user.id });
      } else latest.current.fail(err);
    }
  }

  async function resume(saved: { input: T; userId: string }) {
    sessionStorage.removeItem(key);
    try {
      const me = await api.get<{ id: string }>('/me');
      if (me.id !== saved.userId) throw new Error('Different account');
      setPending(null);
      await run(saved.input);
    } catch (err) {
      latest.current.fail(err);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: consume the browser draft only on mount
  useEffect(() => {
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    sessionStorage.removeItem(key);
    try {
      const saved = JSON.parse(raw);
      if (saved.userId === user?.id && Date.now() - saved.at < 15 * 60_000) void resume(saved);
    } catch {
      /* Ignore an expired or malformed browser draft. */
    }
    // Consume once on return; subsequent renders must not repeat a sensitive action.
  }, []);

  useEffect(() => {
    if (pending) sessionStorage.setItem(key, JSON.stringify({ ...pending, at: Date.now() }));
  }, [key, pending]);

  return {
    run,
    challenge: (
      <Dialog
        open={!!pending}
        title={t('auth.errors.reauthRequired')}
        onClose={() => {
          sessionStorage.removeItem(key);
          setPending(null);
        }}
      >
        {pending && (
          <SignInOptions
            next={next}
            signUp={false}
            email={user?.email}
            onSignedIn={() => resume(pending)}
          />
        )}
      </Dialog>
    ),
  };
}
