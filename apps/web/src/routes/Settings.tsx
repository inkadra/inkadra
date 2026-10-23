import type { CreatedPersonalToken, DeleteMeBlocked, PersonalToken, User } from '@inkadra/shared';
import { Button, Dialog, DialogActions, TextField } from '@inkadra/ui';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { encode } from 'uqr';
import { LOCALES } from '../i18n/index.ts';
import { type AuthSession, api, authApi, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { GoogleG } from './SignInOptions.tsx';
import './settings.css';

/** Settings → Account: profile, sign-in methods, two-factor, sessions, apps and deletion. */
export function Settings() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Array<{ id: string; providerId: string }> | null>(null);
  const loadAccounts = useCallback(async () => setAccounts(await authApi.listAccounts()), []);
  useEffect(() => {
    void loadAccounts().catch(() => setAccounts([]));
  }, [loadAccounts]);
  const hasPassword = accounts?.some((a) => a.providerId === 'credential') ?? false;

  return (
    <div className="settings">
      <h1 className="settings__title">{t('settings.title')}</h1>
      <p className="ink-muted settings__lead">{t('settings.lead')}</p>
      <Profile />
      <SignInMethods accounts={accounts} onChange={loadAccounts} />
      {hasPassword && <ChangePassword />}
      <TwoFactor hasPassword={hasPassword} />
      <Sessions />
      <Tokens />
      <DeleteAccount hasPassword={hasPassword} />
    </div>
  );
}

function Section({
  title,
  body,
  children,
  danger,
}: {
  title: string;
  body?: ReactNode;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={danger ? 'settings__section settings__section--danger' : 'settings__section'}
    >
      <div className="settings__head">
        <h2>{title}</h2>
        {body && <p className="ink-muted">{body}</p>}
      </div>
      <div className="settings__body">{children}</div>
    </section>
  );
}

function useStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const show = (text: string, error = false) => setStatus({ text, error });
  const fail = (err: unknown) =>
    show(
      err instanceof RequestError && (err.status === 400 || err.status === 403) && err.message
        ? err.message
        : err instanceof RequestError && err.status === 401
          ? t('settings.errors.password')
          : t('auth.errors.generic'),
      true,
    );
  const node = status && (
    <p
      className={status.error ? 'settings__status settings__status--error' : 'settings__status'}
      role={status.error ? 'alert' : 'status'}
    >
      {status.text}
    </p>
  );
  return { show, fail, node, clear: () => setStatus(null) };
}

function Profile() {
  const { t, i18n } = useTranslation();
  const { user, refresh } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [locale, setLocale] = useState(user?.locale ?? i18n.language);
  const status = useStatus();

  async function save(e: FormEvent) {
    e.preventDefault();
    status.clear();
    try {
      await api.patch<User>('/me', { name: name.trim(), locale });
      await i18n.changeLanguage(locale);
      await refresh();
      status.show(t('settings.saved'));
    } catch (err) {
      status.fail(err);
    }
  }

  return (
    <Section title={t('settings.profile.title')}>
      <form className="settings__form" onSubmit={save}>
        <TextField
          label={t('auth.name')}
          value={name}
          required
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField label={t('auth.email')} value={user?.email ?? ''} readOnly />
        <label className="settings__label">
          {t('settings.profile.language')}
          <select className="ink-input" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(`settings.profile.languages.${l}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="settings__actions">
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {t('settings.save')}
          </Button>
        </div>
        {status.node}
      </form>
    </Section>
  );
}

function SignInMethods({
  accounts,
  onChange,
}: {
  accounts: Array<{ id: string; providerId: string }> | null;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { instance } = useSession();
  const status = useStatus();
  const providers = [
    ...(instance?.auth.google ? [{ id: 'google', name: 'Google' }] : []),
    ...(instance?.auth.oidc ?? []),
  ];
  if (providers.length === 0) return null;
  const linked = (id: string) => accounts?.some((a) => a.providerId === id) ?? false;
  const methods = accounts?.length ?? 0;

  return (
    <Section title={t('settings.methods.title')} body={t('settings.methods.body')}>
      <ul className="settings__list">
        {providers.map((p) => (
          <li key={p.id} className="settings__row">
            <span className="settings__icon">{p.id === 'google' ? <GoogleG /> : p.name[0]}</span>
            <span className="settings__grow">
              {p.name}
              <span className="settings__sub">
                {linked(p.id) ? t('settings.methods.linked') : t('settings.methods.notLinked')}
              </span>
            </span>
            {linked(p.id) ? (
              <Button
                variant="ghost"
                disabled={methods < 2}
                title={methods < 2 ? t('settings.methods.last') : undefined}
                onClick={async () => {
                  try {
                    await authApi.unlinkAccount(p.id);
                    await onChange();
                  } catch (err) {
                    status.fail(err);
                  }
                }}
              >
                {t('settings.methods.unlink')}
              </Button>
            ) : (
              <Button onClick={() => authApi.linkSocial(p.id, '/settings').catch(status.fail)}>
                {t('settings.methods.link')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {status.node}
    </Section>
  );
}

function ChangePassword() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const status = useStatus();

  async function save(e: FormEvent) {
    e.preventDefault();
    status.clear();
    if (next.length < 10) return status.show(t('auth.errors.password'), true);
    try {
      await authApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      status.show(t('settings.password.changed'));
    } catch (err) {
      status.fail(err);
    }
  }

  return (
    <Section title={t('settings.password.title')} body={t('settings.password.body')}>
      <form className="settings__form" onSubmit={save}>
        <TextField
          label={t('settings.password.current')}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <TextField
          label={t('settings.password.new')}
          type="password"
          autoComplete="new-password"
          placeholder={t('auth.passwordHint')}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <div className="settings__actions">
          <Button type="submit" disabled={!current || !next}>
            {t('settings.password.change')}
          </Button>
        </div>
        {status.node}
      </form>
    </Section>
  );
}

/** An otpauth:// address as a QR code, drawn from the module matrix. */
function QrCode({ text }: { text: string }) {
  const { data, size } = encode(text, { border: 2 });
  const cells: string[] = [];
  data.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) cells.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return (
    <svg className="settings__qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR">
      <rect width={size} height={size} fill="#fff" />
      <path d={cells.join('')} fill="#000" />
    </svg>
  );
}

function TwoFactor({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useTranslation();
  const { user, refresh } = useSession();
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState('');
  const status = useStatus();
  const enabled = user?.twoFactorEnabled ?? false;
  const secret = setup ? (new URL(setup.totpURI).searchParams.get('secret') ?? '') : '';

  async function start(e: FormEvent) {
    e.preventDefault();
    status.clear();
    try {
      setSetup(await authApi.enableTwoFactor(password));
      setPassword('');
    } catch (err) {
      status.fail(err);
    }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault();
    status.clear();
    try {
      await authApi.verifyTotp(code.replace(/\s/g, ''), false);
      await refresh();
      setSetup(null);
      setCode('');
      status.show(t('settings.twoFactor.enabled'));
    } catch (err) {
      status.show(
        err instanceof RequestError && err.status === 401
          ? t('auth.twoFactor.invalid')
          : t('auth.errors.generic'),
        true,
      );
    }
  }
  async function disable(e: FormEvent) {
    e.preventDefault();
    status.clear();
    try {
      await authApi.disableTwoFactor(password);
      setPassword('');
      await refresh();
      status.show(t('settings.twoFactor.disabled'));
    } catch (err) {
      status.fail(err);
    }
  }

  return (
    <Section
      title={t('settings.twoFactor.title')}
      body={enabled ? t('settings.twoFactor.on') : t('settings.twoFactor.off')}
    >
      {!hasPassword ? (
        <p className="ink-muted settings__note">{t('settings.twoFactor.needsPassword')}</p>
      ) : setup ? (
        <form className="settings__form" onSubmit={confirm}>
          <p className="settings__note">{t('settings.twoFactor.scan')}</p>
          <div className="settings__qr-row">
            <QrCode text={setup.totpURI} />
            <div className="settings__secret">
              <span className="ink-muted">{t('settings.twoFactor.manual')}</span>
              <code>{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </div>
          </div>
          <p className="settings__note">{t('settings.twoFactor.backup')}</p>
          <ul className="settings__codes">
            {setup.backupCodes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <TextField
            label={t('auth.twoFactor.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="settings__actions">
            <Button variant="ghost" onClick={() => setSetup(null)}>
              {t('project.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={code.trim().length < 6}>
              {t('settings.twoFactor.confirm')}
            </Button>
          </div>
          {status.node}
        </form>
      ) : (
        <form className="settings__form" onSubmit={enabled ? disable : start}>
          <TextField
            label={t('settings.password.current')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="settings__actions">
            <Button type="submit" variant={enabled ? 'danger' : 'primary'} disabled={!password}>
              {enabled ? t('settings.twoFactor.disable') : t('settings.twoFactor.enable')}
            </Button>
          </div>
          {status.node}
        </form>
      )}
    </Section>
  );
}

function deviceName(ua: string | null, t: (k: string) => string): string {
  if (!ua) return t('settings.sessions.unknown');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : t('settings.sessions.browser');
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

function Sessions() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<AuthSession[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const status = useStatus();
  const load = useCallback(async () => {
    const [list, me] = await Promise.all([authApi.listSessions(), authApi.currentSession()]);
    setItems(list);
    setCurrent(me?.session.id ?? null);
  }, []);
  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [load]);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Section title={t('settings.sessions.title')} body={t('settings.sessions.body')}>
      <ul className="settings__list">
        {items?.map((s) => (
          <li key={s.id} className="settings__row">
            <span className="settings__grow">
              {deviceName(s.userAgent, t)}
              <span className="settings__sub">
                {s.id === current
                  ? t('settings.sessions.this')
                  : t('settings.sessions.since', { when: when(s.updatedAt) })}
                {s.ipAddress ? ` · ${s.ipAddress}` : ''}
              </span>
            </span>
            {s.id !== current && (
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await authApi.revokeSession(s.token);
                    await load();
                  } catch (err) {
                    status.fail(err);
                  }
                }}
              >
                {t('settings.sessions.end')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {(items?.length ?? 0) > 1 && (
        <div className="settings__actions">
          <Button
            onClick={async () => {
              try {
                await authApi.revokeOtherSessions();
                await load();
              } catch (err) {
                status.fail(err);
              }
            }}
          >
            {t('settings.sessions.endOthers')}
          </Button>
        </div>
      )}
      {status.node}
    </Section>
  );
}

function Tokens() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<PersonalToken[] | null>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedPersonalToken | null>(null);
  const status = useStatus();
  const load = useCallback(async () => {
    setItems((await api.get<{ items: PersonalToken[] }>('/me/tokens')).items);
  }, []);
  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [load]);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  async function create(e: FormEvent) {
    e.preventDefault();
    status.clear();
    try {
      setCreated(await api.post<CreatedPersonalToken>('/me/tokens', { name: name.trim() }));
      setName('');
      await load();
    } catch (err) {
      status.fail(err);
    }
  }

  return (
    <Section title={t('settings.tokens.title')} body={t('settings.tokens.body')}>
      <ul className="settings__list">
        {items?.length === 0 && (
          <li className="ink-muted settings__note">{t('settings.tokens.none')}</li>
        )}
        {items?.map((tk) => (
          <li key={tk.id} className="settings__row">
            <span className="settings__grow">
              {tk.name}
              <span className="settings__sub">
                <code>{tk.prefix}…</code> ·{' '}
                {tk.client
                  ? t(`settings.tokens.clients.${tk.client}`)
                  : t('settings.tokens.manual')}{' '}
                ·{' '}
                {tk.lastUsedAt
                  ? t('settings.tokens.used', { when: date(tk.lastUsedAt) })
                  : t('settings.tokens.unused')}
              </span>
            </span>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await api.delete(`/me/tokens/${tk.id}`);
                  await load();
                } catch (err) {
                  status.fail(err);
                }
              }}
            >
              {t('settings.tokens.revoke')}
            </Button>
          </li>
        ))}
      </ul>
      {created ? (
        <div className="settings__created" role="status">
          <p>{t('settings.tokens.copyNow', { name: created.name })}</p>
          <code className="settings__token">{created.token}</code>
          <div className="settings__actions">
            <Button
              onClick={() => navigator.clipboard?.writeText(created.token).catch(() => {})}
              icon="copy"
            >
              {t('share.copy')}
            </Button>
            <Button variant="ghost" onClick={() => setCreated(null)}>
              {t('settings.tokens.done')}
            </Button>
          </div>
        </div>
      ) : (
        <form className="settings__inline" onSubmit={create}>
          <TextField
            label={t('settings.tokens.name')}
            placeholder={t('settings.tokens.namePlaceholder')}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim()}>
            {t('settings.tokens.create')}
          </Button>
        </form>
      )}
      {status.node}
    </Section>
  );
}

function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useTranslation();
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [blocked, setBlocked] = useState<DeleteMeBlocked['soleOwnerOf'] | null>(null);
  const status = useStatus();

  async function remove(e: FormEvent) {
    e.preventDefault();
    status.clear();
    setBlocked(null);
    try {
      await api.delete('/me', hasPassword ? { password } : {});
      await refresh();
    } catch (err) {
      if (err instanceof RequestError && err.status === 409) {
        setBlocked((err.details as DeleteMeBlocked | undefined)?.soleOwnerOf ?? []);
      } else status.fail(err);
    }
  }

  return (
    <Section title={t('settings.delete.title')} body={t('settings.delete.body')} danger>
      <div className="settings__actions settings__actions--start">
        <Button variant="danger" onClick={() => setOpen(true)}>
          {t('settings.delete.open')}
        </Button>
      </div>
      <Dialog open={open} title={t('settings.delete.confirmTitle')} onClose={() => setOpen(false)}>
        <form className="settings__form" onSubmit={remove}>
          <p className="settings__note">{t('settings.delete.confirmBody')}</p>
          {hasPassword ? (
            <TextField
              label={t('settings.password.current')}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          ) : (
            <p className="ink-muted settings__note">{t('settings.delete.fresh')}</p>
          )}
          {blocked && (
            <div className="settings__status settings__status--error" role="alert">
              {t('settings.delete.blocked')}
              <ul>
                {blocked.map((p) => (
                  <li key={p.id}>
                    <a href={`/p/${p.id}`}>{p.name}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {status.node}
          <DialogActions>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('project.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={hasPassword && !password}>
              {t('settings.delete.confirm')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Section>
  );
}
