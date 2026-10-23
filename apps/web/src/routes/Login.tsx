import { Button, Logo, TextField, Wordmark } from '@inkadra/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { authApi, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import './login.css';

export function Login() {
  const { t } = useTranslation();
  const { instance, user, refresh } = useSession();
  const setup = instance?.setupRequired ?? false;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (setup && password.length < 10) {
      setError(t('auth.errors.password'));
      return;
    }
    setBusy(true);
    try {
      if (setup) await authApi.signUp(name.trim(), email.trim(), password);
      else await authApi.signIn(email.trim(), password);
      await refresh();
    } catch (err) {
      if (err instanceof RequestError && err.status === 401) setError(t('auth.errors.invalid'));
      else if (err instanceof RequestError && err.code === 'REGISTRATION_CLOSED')
        setError(t('auth.errors.closed'));
      else setError(t('auth.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login__dots" aria-hidden="true" />
      <form className="login__card" onSubmit={submit} noValidate>
        <div className="login__brand">
          <Logo size={56} />
          <h1 className="login__title">
            <Wordmark />
          </h1>
          <p className="ink-muted login__subtitle">
            {setup ? t('auth.setupTitle') : t('auth.subtitle')}
          </p>
          {setup && <p className="login__note">{t('auth.setupSubtitle')}</p>}
        </div>

        {setup && (
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
          autoComplete={setup ? 'email' : 'username'}
          placeholder={t('auth.emailPlaceholder')}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete={setup ? 'new-password' : 'current-password'}
          placeholder={setup ? t('auth.passwordHint') : undefined}
          required
          minLength={setup ? 10 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block disabled={busy}>
          {busy ? t('auth.signingIn') : setup ? t('auth.createAdmin') : t('auth.signIn')}
        </Button>
        {!setup && instance?.registration === 'invite' && (
          <p className="login__note login__note--center">{t('auth.inviteOnly')}</p>
        )}
        {setup && (
          <p className="login__note login__note--center">
            <Link to="/diagnostics">{t('auth.diagnostics')}</Link>
          </p>
        )}
      </form>
      <p className="login__footer">{t('app.footer', { version: instance?.version ?? '' })}</p>
    </div>
  );
}
