import type { AppAuthorizationRedirect, AppClient } from '@inkadra/shared';
import { Avatar, Button, Logo, Wordmark } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { api, authApi, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import './login.css';

const CLIENTS: AppClient[] = ['clipper', 'mobile'];

/**
 * /authorize, opened by the browser clipper or the mobile app (OAuth 2.0 code with PKCE).
 * The person sees which app and device ask, and allows or denies it; the server checks the
 * redirect address against the official ones before answering with a code or an error.
 */
export function Authorize() {
  const { t } = useTranslation();
  const { user, instance } = useSession();
  const location = useLocation();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const client = params.get('client_id') as AppClient | null;
  const request = {
    clientId: client,
    redirectUri: params.get('redirect_uri'),
    codeChallenge: params.get('code_challenge'),
    codeChallengeMethod: params.get('code_challenge_method'),
    state: params.get('state') ?? undefined,
    deviceName: params.get('device_name')?.slice(0, 80) || undefined,
  };
  const valid =
    !!client &&
    CLIENTS.includes(client) &&
    !!request.redirectUri &&
    !!request.codeChallenge &&
    request.codeChallengeMethod === 'S256';

  if (!user)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );

  async function allow() {
    setBusy(true);
    setError(null);
    try {
      const { redirectTo } = await api.post<AppAuthorizationRedirect>(
        '/app-authorizations',
        request,
      );
      window.location.assign(redirectTo);
    } catch (err) {
      if (
        err instanceof RequestError &&
        (err.details as { reason?: string })?.reason === 'reauth_required'
      ) {
        setError(t('auth.errors.reauthRequired'));
        await authApi.signOut();
        window.location.assign(
          `/login?next=${encodeURIComponent(location.pathname + location.search)}`,
        );
        return;
      }
      setError(t('authorize.failed'));
      setBusy(false);
    }
  }

  // The server checks the address and adds `error=access_denied`; if it refuses, nobody
  // is waiting for an answer and the page only says that no access was given.
  async function deny() {
    setBusy(true);
    setError(null);
    try {
      const { redirectTo } = await api.post<AppAuthorizationRedirect>('/app-authorizations/deny', {
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        state: request.state,
      });
      setCancelled(true);
      window.location.assign(redirectTo);
    } catch {
      setCancelled(true);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login__dots" aria-hidden="true" />
      <main className="login__card">
        <div className="login__brand">
          <Logo size={48} />
          <h1 className="login__title">
            <Wordmark />
          </h1>
        </div>
        {!valid ? (
          <p className="login__error login__error--box">{t('authorize.invalid')}</p>
        ) : cancelled ? (
          <p className="login__invite">{t('authorize.cancelled')}</p>
        ) : (
          <>
            <div className="login__invite">
              <p>
                <b>{t(`authorize.clients.${client}`)}</b>
                {request.deviceName ? ` · ${request.deviceName}` : ''}
              </p>
              <p className="ink-muted">{t('authorize.asks', { instance: instance?.name ?? '' })}</p>
            </div>
            <div className="login__invite">
              <Avatar image={user.image} name={user.name} size={28} />
              <p>{t('join.signedInAs', { name: user.name, email: user.email })}</p>
            </div>
            <p className="login__note">{t('authorize.what')}</p>
            {error && (
              <p className="login__error" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" size="lg" block disabled={busy} onClick={allow}>
              {t('authorize.allow')}
            </Button>
            <Button variant="ghost" block disabled={busy} onClick={deny}>
              {t('authorize.deny')}
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
