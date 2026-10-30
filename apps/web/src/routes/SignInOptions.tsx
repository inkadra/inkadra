import { Button, TextField } from '@inkadra/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

/** Google's "G" in its own colours, as Google's sign-in branding guidelines ask. */
export function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function errorText(t: (k: string) => string, err: unknown): string {
  if (err instanceof RequestError) {
    if (err.status === 401) return t('auth.errors.invalid');
    if (err.code === 'REGISTRATION_CLOSED') return t('auth.errors.closed');
    if (err.code === 'DOMAIN_NOT_ALLOWED') return t('auth.errors.domain');
    if (err.code === 'INVITATION_EMAIL_MISMATCH') return t('auth.errors.inviteEmail');
    if (err.status === 429) return t('auth.errors.rateLimited');
  }
  return t('auth.errors.generic');
}

/**
 * The ways to sign in this instance offers: Google, an OIDC provider, a link by email and
 * email with password. `next` is where to land afterwards. With `signUp`, the password form
 * creates an account (first administrator, open registration or a claimed invitation).
 */
export function SignInOptions({
  next,
  signUp,
  email: fixedEmail,
  onSignedIn,
}: {
  next: string;
  signUp: boolean;
  email?: string | null;
  onSignedIn: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { instance } = useSession();
  const canonical = !instance || new URL(instance.publicUrl).origin === window.location.origin;
  const auth = instance?.auth;
  const externalAuth = canonical ? auth : undefined;
  const [name, setName] = useState('');
  const [email, setEmail] = useState(fixedEmail ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [twoFactor, setTwoFactor] = useState(
    () => new URLSearchParams(window.location.search).get('twoFactor') === 'true',
  );
  const [withPassword, setWithPassword] = useState(!auth?.magicLink || signUp);
  const providers = (externalAuth?.google ? 1 : 0) + (externalAuth?.oidc.length ?? 0);

  async function attempt(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (signUp && password.length < 10) {
      setError(t('auth.errors.password'));
      return;
    }
    void attempt(async () => {
      if (signUp) {
        await authApi.signUp(name.trim(), email.trim(), password);
      } else {
        const res = await authApi.signIn(email.trim(), password);
        if (res?.twoFactorRedirect) {
          setTwoFactor(true);
          return;
        }
      }
      await onSignedIn();
    });
  }

  function submitLink(e: FormEvent) {
    e.preventDefault();
    void attempt(async () => {
      await authApi.magicLink(email.trim(), next);
      setSent(true);
    });
  }

  if (twoFactor) return <TwoFactorStep onSignedIn={onSignedIn} />;

  if (sent) {
    return (
      <div className="login__sent" role="status">
        <p className="login__sent-title">{t('auth.link.sentTitle')}</p>
        <p className="ink-muted">{t('auth.link.sentBody', { email: email.trim() })}</p>
        <Button variant="ghost" onClick={() => setSent(false)}>
          {t('auth.link.again')}
        </Button>
      </div>
    );
  }

  return (
    <>
      {!canonical && (auth?.google || (auth?.oidc.length ?? 0) > 0) && (
        <p>
          {t('auth.canonicalProviders')}{' '}
          <a href={`${instance?.publicUrl}/login`}>{instance?.publicUrl}</a>
        </p>
      )}
      {providers > 0 && (
        <div className="login__providers">
          {externalAuth?.google && (
            <button
              type="button"
              className="login__provider"
              disabled={busy}
              onClick={() => attempt(() => authApi.social('google', next))}
            >
              <GoogleG />
              {t('auth.google')}
            </button>
          )}
          {externalAuth?.oidc.map((p) => (
            <button
              key={p.id}
              type="button"
              className="login__provider"
              disabled={busy}
              onClick={() => attempt(() => authApi.social(p.id, next))}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                aria-hidden="true"
                className="login__shield"
              >
                <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
              </svg>
              {t('auth.oidc', { name: p.name })}
            </button>
          ))}
        </div>
      )}
      {providers > 0 && auth?.emailPassword && (
        <div className="login__or" aria-hidden="true">
          <span />
          {t('auth.or')}
          <span />
        </div>
      )}

      {auth?.emailPassword && !withPassword && (
        <form className="login__form" onSubmit={submitLink} noValidate>
          <TextField
            label={t('auth.email')}
            name="email"
            type="email"
            autoComplete="username"
            placeholder={t('auth.emailPlaceholder')}
            required
            readOnly={!!fixedEmail}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && (
            <p className="login__error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" block disabled={busy || !email.trim()}>
            {t('auth.link.send')}
          </Button>
          <button type="button" className="login__switch" onClick={() => setWithPassword(true)}>
            {t('auth.usePassword')}
          </button>
        </form>
      )}

      {auth?.emailPassword && withPassword && (
        <form className="login__form" onSubmit={submitPassword} noValidate>
          {signUp && (
            <TextField
              label={t('auth.name')}
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <TextField
            label={t('auth.email')}
            name="email"
            type="email"
            autoComplete={signUp ? 'email' : 'username'}
            placeholder={t('auth.emailPlaceholder')}
            required
            readOnly={!!fixedEmail}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label={t('auth.password')}
            name="password"
            type="password"
            autoComplete={signUp ? 'new-password' : 'current-password'}
            placeholder={signUp ? t('auth.passwordHint') : undefined}
            required
            minLength={signUp ? 10 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="login__error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy
              ? t('auth.signingIn')
              : instance?.setupRequired
                ? t('auth.createAdmin')
                : signUp
                  ? t('auth.signUp')
                  : t('auth.signIn')}
          </Button>
          {!signUp && auth.magicLink && (
            <button type="button" className="login__switch" onClick={() => setWithPassword(false)}>
              {t('auth.useLink')}
            </button>
          )}
          {!signUp && auth.email && <ForgotPassword email={email} />}
        </form>
      )}
      {!auth?.emailPassword && error && (
        <p className="login__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function ForgotPassword({ email }: { email: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  if (state === 'sent')
    return (
      <p className="login__note login__note--center" role="status">
        {t('auth.reset.sent')}
      </p>
    );
  return (
    <button
      type="button"
      className="login__switch"
      disabled={!email.trim()}
      title={email.trim() ? undefined : t('auth.reset.needEmail')}
      onClick={async () => {
        try {
          await authApi.requestPasswordReset(email.trim());
          setState('sent');
        } catch {
          setState('error');
        }
      }}
    >
      {state === 'error' ? t('auth.errors.generic') : t('auth.reset.ask')}
    </button>
  );
}

/** Second step for accounts with two-factor authentication: app code or a backup code. */
function TwoFactorStep({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (backup) await authApi.verifyBackupCode(code.trim());
      else await authApi.verifyTotp(code.replace(/\s/g, ''), trust);
      await onSignedIn();
    } catch (err) {
      setError(
        err instanceof RequestError && err.status === 401
          ? t('auth.twoFactor.invalid')
          : errorText(t, err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login__form" onSubmit={submit} noValidate>
      <p className="login__note">
        {backup ? t('auth.twoFactor.backupBody') : t('auth.twoFactor.body')}
      </p>
      <TextField
        label={backup ? t('auth.twoFactor.backupCode') : t('auth.twoFactor.code')}
        name="code"
        inputMode={backup ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoFocus
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      {!backup && (
        <label className="login__check">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
          {t('auth.twoFactor.trust')}
        </label>
      )}
      {error && (
        <p className="login__error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" block disabled={busy || !code.trim()}>
        {t('auth.twoFactor.verify')}
      </Button>
      <button
        type="button"
        className="login__switch"
        onClick={() => {
          setBackup(!backup);
          setCode('');
        }}
      >
        {backup ? t('auth.twoFactor.useApp') : t('auth.twoFactor.useBackup')}
      </button>
    </form>
  );
}
