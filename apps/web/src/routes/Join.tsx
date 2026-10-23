import type { AcceptedInvitation, InvitationPreview } from '@inkadra/shared';
import { Avatar, Button, Logo, Wordmark } from '@inkadra/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api, authApi, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { SignInOptions } from './SignInOptions.tsx';
import './login.css';

const targetPath = (a: AcceptedInvitation) =>
  a.boardId && a.projectId
    ? `/p/${a.projectId}/b/${a.boardId}`
    : a.projectId
      ? `/p/${a.projectId}`
      : '/';

/**
 * /join/:token, the page an invitation email or link opens. Signed out: the invitation is
 * claimed, so signing up works even when registration is by invitation only, and the
 * account gets the role as soon as it exists. Signed in: one click accepts it.
 */
export function Join() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const { user, instance, refresh } = useSession();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(true);
  const signedInHere = useRef(false);

  useEffect(() => {
    api
      .get<InvitationPreview>(`/invitations/by-token/${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch(() => setMissing(true));
  }, [token]);

  // Signed out and still valid: claim it, so a sign-up with any method may go through.
  useEffect(() => {
    if (!user && preview?.status === 'valid')
      void api.post(`/invitations/by-token/${encodeURIComponent(token)}/claim`, {}).catch(() => {});
  }, [user, preview, token]);

  const accept = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const done = await api.post<AcceptedInvitation>(
        `/invitations/by-token/${encodeURIComponent(token)}/accept`,
        {},
      );
      // A full load, so the sidebar lists the new project.
      window.location.assign(targetPath(done));
    } catch (err) {
      if (err instanceof RequestError && err.status === 404 && signedInHere.current) {
        // A new account took the invitation when it was created.
        window.location.assign('/');
        return;
      }
      setError(
        err instanceof RequestError && err.status === 403
          ? err.message
          : err instanceof RequestError && err.status === 404
            ? t('join.used')
            : t('auth.errors.generic'),
      );
      setBusy(false);
    }
  }, [token, t]);

  // Back from Google, OIDC or an email link: the new account already used the invitation,
  // and accepting it again leads to the board (the server answers 404 otherwise).
  const [checkingUsed, setCheckingUsed] = useState(false);
  useEffect(() => {
    if (!user || preview?.status !== 'used' || !preview.email) return;
    setCheckingUsed(true);
    api
      .post<AcceptedInvitation>(`/invitations/by-token/${encodeURIComponent(token)}/accept`, {})
      .then((done) => window.location.assign(targetPath(done)))
      .catch(() => setCheckingUsed(false));
  }, [user, preview, token]);

  const what = preview
    ? preview.boardTitle && preview.projectName
      ? t('join.board', { board: preview.boardTitle, project: preview.projectName })
      : preview.projectName
        ? t('join.project', { project: preview.projectName })
        : t('join.instance', { instance: preview.instanceName })
    : '';

  let body: React.ReactNode;
  if (missing) {
    body = <p className="login__error login__error--box">{t('join.missing')}</p>;
  } else if (!preview || checkingUsed) {
    body = null;
  } else if (preview.status !== 'valid') {
    body = <p className="login__error login__error--box">{t(`join.status.${preview.status}`)}</p>;
  } else if (user) {
    body = (
      <>
        <div className="login__invite">
          <Avatar name={user.name} size={32} />
          <p>{t('join.signedInAs', { name: user.name, email: user.email })}</p>
        </div>
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
        <Button variant="primary" size="lg" block disabled={busy} onClick={accept}>
          {t('join.accept')}
        </Button>
        <button
          type="button"
          className="login__switch"
          onClick={async () => {
            await authApi.signOut();
            await refresh();
          }}
        >
          {t('join.otherAccount')}
        </button>
      </>
    );
  } else {
    const canSignUp = instance?.auth.emailPassword ?? false;
    body = (
      <>
        <SignInOptions
          key={creating ? 'up' : 'in'}
          next={`/join/${token}`}
          signUp={creating && canSignUp}
          email={preview.email}
          onSignedIn={async () => {
            signedInHere.current = true;
            await refresh();
            await accept();
          }}
        />
        {canSignUp && (
          <p className="login__note login__note--center">
            <button type="button" className="login__switch" onClick={() => setCreating(!creating)}>
              {creating ? t('auth.haveAccount') : t('auth.createAccount')}
            </button>
          </p>
        )}
      </>
    );
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
          {preview && (
            <div className="login__invite">
              <p>
                {preview.invitedBy
                  ? t('join.invitedBy', { name: preview.invitedBy, what })
                  : t('join.invited', { what })}
              </p>
              {preview.role && (
                <p className="ink-muted">
                  {t('join.as', { role: t(`roles.${preview.role}`) })}
                  {preview.email ? ` · ${preview.email}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
        {body}
        <p className="login__note login__note--center">
          <Link to="/">{t('join.home')}</Link>
        </p>
      </main>
    </div>
  );
}
