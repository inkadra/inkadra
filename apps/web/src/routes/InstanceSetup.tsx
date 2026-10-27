import type { Diagnostics } from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

export function useInstanceSetup() {
  const { user, instance } = useSession();
  const [checks, setChecks] = useState<Array<{ id: string; ok: boolean }> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (user?.role !== 'admin' || !instance) return;
    let alive = true;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const websocket = new Promise<boolean>((resolve) => {
      try {
        const url = new URL(instance.collabPath, window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(url);
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          if (socket) {
            socket.onopen = socket.onerror = null;
            socket.close();
          }
          resolve(ok);
        };
        socket.onopen = () => finish(true);
        socket.onerror = () => finish(false);
        timer = setTimeout(() => finish(false), 5000);
      } catch {
        resolve(false);
      }
    });
    Promise.all([api.get<Diagnostics>('/diagnostics'), websocket])
      .then(([body, ws]) => {
        if (!alive) return;
        const healthy = (ids: string[]) =>
          ids.every((id) => body.checks.some((c) => c.id === id && c.status === 'ok'));
        setChecks([
          {
            id: 'providers',
            ok:
              instance.auth.emailPassword ||
              instance.auth.google ||
              instance.auth.oidc.length > 0 ||
              instance.auth.magicLink,
          },
          { id: 'storage', ok: healthy(['storage', 'data_dir_writable']) },
          { id: 'smtp', ok: instance.auth.email },
          {
            id: 'domain',
            ok:
              healthy(['public_url_https', 'public_url_matches_request']) &&
              new URL(instance.publicUrl).origin === window.location.origin &&
              ws,
          },
        ]);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
      socket?.close();
    };
  }, [user?.role, instance]);
  return { checks: user?.role === 'admin' ? checks : null, error: user?.role === 'admin' && error };
}

export function InstanceChecklist({ checks, error }: ReturnType<typeof useInstanceSetup>) {
  const { t } = useTranslation();
  if (!error && (!checks || checks.every((c) => c.ok))) return null;
  return (
    <section className="ink-card instance-checklist">
      <h2>{t('onboarding.instanceTitle')}</h2>
      <p className="ink-muted">{t('onboarding.adminOnly')}</p>
      {error ? (
        <p role="alert">{t('home.loadError')}</p>
      ) : (
        <>
          <p>
            {t('onboarding.checkProgress', {
              done: checks?.filter((c) => c.ok).length,
              total: checks?.length,
            })}
          </p>
          <ul>
            {checks?.map((c) => (
              <li key={c.id}>
                <span aria-hidden="true">{c.ok ? '✓' : '○'}</span> {t(`onboarding.checks.${c.id}`)}{' '}
                · {t(c.ok ? 'onboarding.ready' : 'onboarding.needsSetup')}
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to="/diagnostics">{t('auth.diagnostics')}</Link>
    </section>
  );
}
