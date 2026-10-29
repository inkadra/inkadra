import { Logo, Wordmark } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useSession } from '../lib/session.tsx';
import { SignInOptions } from './SignInOptions.tsx';
import './login.css';

/** Only paths inside the app, so a crafted link cannot send people elsewhere after sign-in. */
export function safeNext(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/';
  // Backslashes and control characters can turn a path into another site in some browsers.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  return /[\\\u0000-\u001f\u007f]/.test(value) ? '/' : value;
}

/**
 * Server error codes (?error=…) mapped to i18n keys. The codes come from Better Auth:
 * APIError codes are upper-case, but the OAuth callback code arrives lower-cased
 * ("account not linked"), and the lookup is case-sensitive, so each key is kept as sent.
 */
export const PROVIDER_ERRORS: Record<string, string> = {
  REGISTRATION_CLOSED: 'auth.errors.closed',
  DOMAIN_NOT_ALLOWED: 'auth.errors.domain',
  INVITATION_EMAIL_MISMATCH: 'auth.errors.inviteEmail',
  account_not_linked: 'auth.errors.accountNotLinked',
};

export function Login() {
  const { t } = useTranslation();
  const { instance, user, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const providerError = params.get('error');
  const setup = instance?.setupRequired ?? false;
  const open = instance?.registration === 'open';
  const [creating, setCreating] = useState(false);
  const signUp = setup || (open && creating);

  if (user) return <Navigate to={next} replace />;

  return (
    <div className="login">
      <div className="login__dots" aria-hidden="true" />
      <main className="login__card">
        <div className="login__brand">
          <Logo size={56} />
          <h1 className="login__title">
            <Wordmark />
          </h1>
          <p className="ink-muted login__subtitle">
            {setup ? t('auth.setupTitle') : signUp ? t('auth.signUpTitle') : t('auth.subtitle')}
          </p>
          {setup && <p className="login__note">{t('auth.setupSubtitle')}</p>}
        </div>

        {providerError && (
          <p className="login__error login__error--box" role="alert">
            {t(
              Object.hasOwn(PROVIDER_ERRORS, providerError)
                ? (PROVIDER_ERRORS[providerError] as string)
                : 'auth.errors.provider',
            )}
          </p>
        )}

        <SignInOptions
          key={signUp ? 'up' : 'in'}
          next={next}
          signUp={signUp}
          onSignedIn={async () => {
            await refresh();
            navigate(next, { replace: true });
          }}
        />

        {!setup && open && (
          <p className="login__note login__note--center">
            <button type="button" className="login__switch" onClick={() => setCreating(!creating)}>
              {creating ? t('auth.haveAccount') : t('auth.createAccount')}
            </button>
          </p>
        )}
        {!setup && instance?.registration === 'invite' && (
          <p className="login__note login__note--center">{t('auth.inviteOnly')}</p>
        )}
        {!setup && instance?.registration === 'closed' && (
          <p className="login__note login__note--center">{t('auth.errors.closed')}</p>
        )}
        {setup && (
          <p className="login__note login__note--center">
            <Link to="/diagnostics">{t('auth.diagnostics')}</Link>
          </p>
        )}
      </main>
      <p className="login__footer">{t('app.publicFooter')}</p>
    </div>
  );
}
