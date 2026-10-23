import { Button, Logo, TextField, Wordmark } from '@inkadra/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { authApi } from '../lib/api.ts';
import './login.css';

/** Where the password reset email leads: Better Auth adds `token` (or `error`) to the address. */
export function ResetPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [token] = useState(() => params.get('token'));
  // Out of the address bar and the history once read.
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [token]);
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      setError(t('auth.errors.password'));
      return;
    }
    setError(null);
    setState('busy');
    try {
      await authApi.resetPassword(token ?? '', password);
      setState('done');
    } catch {
      setState('error');
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
          <p className="ink-muted login__subtitle">{t('auth.reset.title')}</p>
        </div>
        {!token || state === 'error' ? (
          <p className="login__error login__error--box">{t('auth.reset.invalid')}</p>
        ) : state === 'done' ? (
          <p className="login__invite" role="status">
            {t('auth.reset.done')}
          </p>
        ) : (
          <form className="login__form" onSubmit={submit} noValidate>
            <TextField
              label={t('settings.password.new')}
              type="password"
              autoComplete="new-password"
              placeholder={t('auth.passwordHint')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p className="login__error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" block disabled={state === 'busy'}>
              {t('auth.reset.save')}
            </Button>
          </form>
        )}
        <p className="login__note login__note--center">
          <Link to="/login">{t('diagnostics.backLogin')}</Link>
        </p>
      </main>
    </div>
  );
}
