import type { DiagnosticCheck, Diagnostics as DiagnosticsBody } from '@inkadra/shared';
import { Button, Logo } from '@inkadra/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import './login.css';
import './diagnostics.css';

type Status = DiagnosticCheck['status'];
interface Row {
  id: string;
  status: Status;
  expected: string | null;
  actual: string | null;
}

/** Opens the collaboration WebSocket through the proxy and waits for the upgrade. */
function probeWebSocket(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      resolve(false);
      return;
    }
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.onopen = socket.onerror = null;
      socket.close();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 5000);
    socket.onopen = () => done(true);
    socket.onerror = () => done(false);
  });
}

export function Diagnostics() {
  const { t } = useTranslation();
  const { instance, user } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [request, setRequest] = useState<DiagnosticsBody['request'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (!instance) return;
    setBusy(true);
    setError(null);
    try {
      const [body, socket] = await Promise.all([
        api.get<DiagnosticsBody>('/diagnostics'),
        probeWebSocket(instance.collabPath),
      ]);
      const origin = window.location.origin;
      const publicOrigin = new URL(instance.publicUrl).origin;
      const browser: Row[] = [
        {
          id: 'browser_origin',
          status: origin === publicOrigin ? 'ok' : 'error',
          expected: publicOrigin,
          actual: origin,
        },
        { id: 'websocket', status: socket ? 'ok' : 'error', expected: null, actual: null },
      ];
      setRows([...browser, ...body.checks]);
      setRequest(body.request);
    } catch (err) {
      if (err instanceof RequestError && (err.status === 401 || err.status === 403))
        setError(t('diagnostics.errors.admin'));
      else if (err instanceof RequestError && err.status === 429)
        setError(t('diagnostics.errors.rateLimited'));
      else setError(t('diagnostics.errors.generic'));
    } finally {
      setBusy(false);
    }
  }, [instance, t]);

  useEffect(() => {
    void run();
  }, [run]);

  const worst = rows?.some((r) => r.status === 'error')
    ? 'error'
    : rows?.some((r) => r.status === 'warning')
      ? 'warning'
      : 'ok';

  return (
    <div className="login">
      <div className="login__dots" aria-hidden="true" />
      <main className="diagnostics">
        <header className="diagnostics__header">
          <Logo size={40} />
          <div>
            <h1 className="diagnostics__title">{t('diagnostics.title')}</h1>
            <p className="ink-muted diagnostics__subtitle">{t('diagnostics.subtitle')}</p>
          </div>
        </header>

        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}

        {rows && (
          <>
            <p className={`diagnostics__summary diagnostics__summary--${worst}`} role="status">
              {t(`diagnostics.summary.${worst}`)}
            </p>
            <ul className="diagnostics__list">
              {rows.map((row) => (
                <li key={row.id} className="diagnostics__item">
                  <span
                    className={`diagnostics__dot diagnostics__dot--${row.status}`}
                    aria-hidden="true"
                  />
                  <div className="diagnostics__body">
                    <p className="diagnostics__name">
                      {t(`diagnostics.checks.${row.id}.title`)}
                      <span className="diagnostics__status">
                        {t(`diagnostics.status.${row.status}`)}
                      </span>
                    </p>
                    {row.status !== 'ok' && (
                      <p className="diagnostics__hint">{t(`diagnostics.checks.${row.id}.fix`)}</p>
                    )}
                    {(row.expected || row.actual) && (
                      <dl className="diagnostics__values">
                        {row.expected && (
                          <>
                            <dt>{t('diagnostics.expected')}</dt>
                            <dd>{row.expected}</dd>
                          </>
                        )}
                        {row.actual && (
                          <>
                            <dt>{t('diagnostics.actual')}</dt>
                            <dd>{row.actual}</dd>
                          </>
                        )}
                      </dl>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {request && (
          <section className="diagnostics__request" aria-labelledby="diagnostics-request">
            <h2 id="diagnostics-request">{t('diagnostics.request.title')}</h2>
            <dl className="diagnostics__values">
              <dt>{t('diagnostics.request.address')}</dt>
              <dd>
                {request.protocol}://{request.host}
              </dd>
              <dt>{t('diagnostics.request.clientIp')}</dt>
              <dd>{request.clientIp}</dd>
              <dt>{t('diagnostics.request.peer')}</dt>
              <dd>{request.peerAddress}</dd>
              <dt>{t('diagnostics.request.forwardedFor')}</dt>
              <dd>{request.forwardedFor ?? '—'}</dd>
            </dl>
          </section>
        )}

        <div className="diagnostics__actions">
          <Button variant="primary" onClick={() => void run()} disabled={busy || !instance}>
            {busy ? t('diagnostics.running') : t('diagnostics.run')}
          </Button>
          <Link to={user ? '/' : '/login'} className="diagnostics__back">
            {user ? t('diagnostics.backHome') : t('diagnostics.backLogin')}
          </Link>
        </div>
        <p className="login__note">
          {t('diagnostics.docs')}{' '}
          <a href="https://github.com/inkadra/inkadra/tree/main/docs/self-hosting">
            docs/self-hosting
          </a>
        </p>
      </main>
    </div>
  );
}
