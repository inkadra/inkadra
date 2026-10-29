import type {
  AccountSession,
  CreatedPersonalToken,
  DeleteMeBlocked,
  PersonalToken,
} from '@inkadra/shared';
import { Avatar, Button, Dialog, DialogActions, TextField } from '@inkadra/ui';
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { encode } from 'uqr';
import { LOCALES } from '../i18n/index.ts';
import { api, authApi, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { type ThemePreference, useTheme } from '../lib/theme.ts';
import { EmailNotifications } from '../notifications/Notifications.tsx';
import { useInstanceSetupState } from './AppLayout.tsx';
import { ClassificationSettings } from './ClassificationSettings.tsx';
import { InstanceSettings } from './InstanceSettings.tsx';
import { SettingsHome } from './SettingsHome.tsx';
import { SettingsShell } from './SettingsShell.tsx';
import { trackSave } from './settings-save.ts';
import { isSettingsHome, settingsSection } from './settings-sections.ts';
import { AutosaveText, Badge, Card, Row, Segmented, useIsPhone } from './settings-ui.tsx';
import './projects.css';
import { GoogleG } from './SignInOptions.tsx';
import './settings.css';

/** Every settings page except Members; plain `/settings` is the home list on phones. */
export function Settings() {
  const setup = useInstanceSetupState();
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const phone = useIsPhone();
  const { user } = useSession();
  if (phone && isSettingsHome(pathname, search)) return <SettingsHome setup={setup} />;
  const page = settingsSection(pathname, search);
  if (page.admin && user?.role !== 'admin')
    return (
      <SettingsShell page={page}>
        <p role="alert">{t('admin.forbidden')}</p>
      </SettingsShell>
    );
  switch (page.id) {
    case 'account':
      return <Account />;
    case 'preferences':
      return (
        <SettingsShell page={page}>
          <Preferences />
        </SettingsShell>
      );
    case 'notifications':
      return (
        <SettingsShell page={page}>
          <EmailNotifications />
        </SettingsShell>
      );
    case 'classifications':
      return (
        <SettingsShell page={page}>
          <ClassificationSettings />
        </SettingsShell>
      );
    default:
      return (
        <SettingsShell page={page}>
          <InstanceSettings section={page.id} setup={setup} />
        </SettingsShell>
      );
  }
}

function useStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<
    { key: string; error: boolean } | { text: string; error: boolean } | null
  >(null);
  const show = (text: string, error = false) => setStatus({ text, error });
  const showKey = (key: string, error = false) => setStatus({ key, error });
  const fail = (err: unknown) =>
    show(
      err instanceof RequestError &&
        (err.details as { reason?: string })?.reason === 'reauth_required'
        ? t('auth.errors.reauthRequired')
        : err instanceof RequestError && (err.status === 400 || err.status === 403) && err.message
          ? err.message
          : err instanceof RequestError && err.status === 401
            ? t('settings.errors.password')
            : t('auth.errors.generic'),
      true,
    );
  const message = status ? ('key' in status ? t(status.key) : status.text) : null;
  const node = status && (
    <p
      className={status.error ? 'settings__status settings__status--error' : 'settings__status'}
      role={status.error ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
  return { show, showKey, fail, node, clear: () => setStatus(null) };
}

/** Theme applies instantly on this device; language is saved to the account. */
export function Preferences() {
  const { t, i18n } = useTranslation();
  const { user, refresh } = useSession();
  const { preference, choose } = useTheme();
  const languageId = useId();
  const [locale, setLocale] = useState(user?.locale ?? i18n.language);
  async function changeLocale(next: string) {
    const previous = locale;
    setLocale(next);
    try {
      await trackSave(api.patch('/me', { locale: next }));
      await i18n.changeLanguage(next);
      await refresh();
    } catch {
      setLocale(previous);
    }
  }
  return (
    <Card>
      <div className="settings-rows">
        <Row label={t('admin.theme')} help={t('settingsUi.preferences.themeHelp')}>
          <Segmented
            label={t('admin.theme')}
            value={preference}
            onChange={(value: ThemePreference) => choose(value)}
            options={(['dark', 'light', 'system'] as const).map((value) => ({
              value,
              label: t(`admin.themes.${value}`),
            }))}
          />
        </Row>
        <Row
          label={t('settings.profile.language')}
          help={t('settingsUi.preferences.languageHelp')}
          htmlFor={languageId}
        >
          <select
            id={languageId}
            className="ink-input settings-input"
            value={locale}
            onChange={(e) => void changeLocale(e.target.value)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(`settings.profile.languages.${l}`)}
              </option>
            ))}
          </select>
        </Row>
      </div>
    </Card>
  );
}

function Account() {
  const [accounts, setAccounts] = useState<Array<{ id: string; providerId: string }> | null>(null);
  const loadAccounts = useCallback(async () => setAccounts(await authApi.listAccounts()), []);
  useEffect(() => {
    void loadAccounts().catch(() => setAccounts([]));
  }, [loadAccounts]);
  const hasPassword = accounts?.some((a) => a.providerId === 'credential') ?? false;
  return (
    <SettingsShell>
      <Profile />
      <SignInMethods accounts={accounts} hasPassword={hasPassword} onChange={loadAccounts} />
      <Sessions />
      <Tokens />
      <DeleteAccount hasPassword={hasPassword} />
    </SettingsShell>
  );
}

function Profile() {
  const { t } = useTranslation();
  const { user, refresh } = useSession();
  const status = useStatus();
  const nameId = useId();
  const [avatarBusy, setAvatarBusy] = useState(false);
  async function changeAvatar(file?: File) {
    status.clear();
    if (
      file &&
      (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1024 * 1024)
    ) {
      status.show(t('settings.profile.avatarInvalid'), true);
      return;
    }
    setAvatarBusy(true);
    try {
      await trackSave(
        (async () => {
          if (file) {
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = reject;
              reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
              reader.readAsDataURL(file);
            });
            await api.put('/me/avatar', { data });
          } else await api.delete('/me/avatar');
          await refresh();
        })(),
      );
    } catch {
      status.show(t('settings.profile.avatarError'), true);
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <Card title={t('settings.profile.title')}>
      <div className="settings-rows">
        <Row
          leading={<Avatar name={user?.name ?? ''} image={user?.image} size={48} />}
          label={t('settingsUi.account.photo')}
          help={t('settings.profile.avatarHelp')}
        >
          <label
            className={`ink-btn ink-btn--secondary settings-file${avatarBusy ? ' is-busy' : ''}`}
          >
            {t('settingsUi.account.upload')}
            <input
              type="file"
              className="ink-sr-only"
              aria-label={t('settings.profile.avatarUpload')}
              accept="image/jpeg,image/png,image/webp"
              disabled={avatarBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void changeAvatar(file);
              }}
            />
          </label>
          {user?.image && (
            <Button variant="ghost" disabled={avatarBusy} onClick={() => void changeAvatar()}>
              {t('settingsUi.account.remove')}
            </Button>
          )}
        </Row>
        <Row label={t('auth.name')} help={t('settingsUi.account.nameHelp')} htmlFor={nameId}>
          <AutosaveText
            id={nameId}
            label={t('auth.name')}
            value={user?.name ?? ''}
            maxLength={120}
            save={async (name) => {
              await api.patch('/me', { name });
              await refresh();
            }}
          />
        </Row>
        <Row label={t('auth.email')} help={t('settingsUi.account.emailHelp')}>
          <span className="settings-value">{user?.email}</span>
        </Row>
      </div>
      {status.node && <div className="settings-card__pad">{status.node}</div>}
    </Card>
  );
}

function SignInMethods({
  accounts,
  hasPassword,
  onChange,
}: {
  accounts: Array<{ id: string; providerId: string }> | null;
  hasPassword: boolean;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { instance, user } = useSession();
  const status = useStatus();
  const [dialog, setDialog] = useState<'password' | 'twoFactor' | null>(null);
  const providers = [
    ...(instance?.auth.google ? [{ id: 'google', name: 'Google' }] : []),
    ...(instance?.auth.oidc ?? []),
  ];
  const linked = (id: string) => accounts?.some((a) => a.providerId === id) ?? false;
  const methods = accounts?.length ?? 0;
  const twoFactor = user?.twoFactorEnabled ?? false;

  return (
    <Card title={t('settings.methods.title')}>
      <div className="settings-rows">
        {hasPassword && (
          <Row
            leading={<span className="settings-provider">@</span>}
            label={t('admin.password')}
            help={t('settings.password.body')}
          >
            <Button onClick={() => setDialog('password')}>{t('settings.password.change')}</Button>
          </Row>
        )}
        {providers.map((p) => (
          <Row
            key={p.id}
            leading={
              <span className="settings-provider">
                {p.id === 'google' ? <GoogleG /> : p.name[0]}
              </span>
            }
            label={p.name}
            help={linked(p.id) ? t('settings.methods.linked') : t('settings.methods.notLinked')}
          >
            {linked(p.id) ? (
              <Button
                variant="ghost"
                disabled={methods < 2}
                title={methods < 2 ? t('settings.methods.last') : undefined}
                onClick={async () => {
                  try {
                    await trackSave(authApi.unlinkAccount(p.id));
                    await onChange();
                  } catch (err) {
                    status.fail(err);
                  }
                }}
              >
                {t('settings.methods.unlink')}
              </Button>
            ) : (
              <Button
                onClick={() =>
                  authApi.linkSocial(p.id, '/settings?section=account').catch(status.fail)
                }
              >
                {t('settings.methods.link')}
              </Button>
            )}
          </Row>
        ))}
        <Row
          leading={<span className="settings-provider">2FA</span>}
          label={t('settings.twoFactor.title')}
          help={
            !hasPassword
              ? t('settings.twoFactor.needsPassword')
              : twoFactor
                ? t('settings.twoFactor.on')
                : t('settings.twoFactor.off')
          }
        >
          <Badge tone={twoFactor ? 'ok' : 'neutral'}>
            {t(twoFactor ? 'settingsUi.on' : 'settingsUi.off')}
          </Badge>
          {hasPassword && (
            <Button
              variant={twoFactor ? 'ghost' : 'secondary'}
              onClick={() => setDialog('twoFactor')}
            >
              {t(twoFactor ? 'settings.twoFactor.disable' : 'settings.twoFactor.enable')}
            </Button>
          )}
        </Row>
      </div>
      {status.node && <div className="settings-card__pad">{status.node}</div>}
      <Dialog
        open={dialog === 'password'}
        title={t('settings.password.change')}
        onClose={() => setDialog(null)}
      >
        {dialog === 'password' && <ChangePassword onDone={() => setDialog(null)} />}
      </Dialog>
      <Dialog
        open={dialog === 'twoFactor'}
        title={t('settings.twoFactor.title')}
        onClose={() => setDialog(null)}
      >
        {dialog === 'twoFactor' && <TwoFactor onDone={() => setDialog(null)} />}
      </Dialog>
    </Card>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [changed, setChanged] = useState(false);
  const status = useStatus();

  async function save(e: FormEvent) {
    e.preventDefault();
    status.clear();
    if (next.length < 10) return status.show(t('auth.errors.password'), true);
    try {
      await authApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setChanged(true);
      status.show(t('settings.password.changed'));
    } catch (err) {
      status.fail(err);
    }
  }

  return (
    <form className="settings-form" onSubmit={save}>
      <p className="settings-muted">{t('settings.password.body')}</p>
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
      {status.node}
      <DialogActions>
        <Button variant="ghost" onClick={onDone}>
          {t(changed ? 'settings.tokens.done' : 'project.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={!current || !next}>
          {t('settings.password.change')}
        </Button>
      </DialogActions>
    </form>
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

export function TwoFactor({ onDone }: { onDone: () => void }) {
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
      onDone();
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
      onDone();
    } catch (err) {
      status.fail(err);
    }
  }

  return setup ? (
    <form className="settings-form" onSubmit={confirm}>
      <p>{t('settings.twoFactor.scan')}</p>
      <div className="settings__qr-row">
        <QrCode text={setup.totpURI} />
        <div className="settings__secret">
          <span className="settings-muted">{t('settings.twoFactor.manual')}</span>
          <code>{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
        </div>
      </div>
      <p>{t('settings.twoFactor.backup')}</p>
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
      {status.node}
      <DialogActions>
        <Button variant="ghost" onClick={onDone}>
          {t('project.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={code.trim().length < 6}>
          {t('settings.twoFactor.confirm')}
        </Button>
      </DialogActions>
    </form>
  ) : (
    <form className="settings-form" onSubmit={enabled ? disable : start}>
      <p className="settings-muted">
        {enabled ? t('settings.twoFactor.on') : t('settings.twoFactor.off')}
      </p>
      <TextField
        label={t('settings.password.current')}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {status.node}
      <DialogActions>
        <Button variant="ghost" onClick={onDone}>
          {t('project.cancel')}
        </Button>
        <Button type="submit" variant={enabled ? 'danger' : 'primary'} disabled={!password}>
          {enabled ? t('settings.twoFactor.disable') : t('settings.twoFactor.enable')}
        </Button>
      </DialogActions>
    </form>
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

/** The current session sorts first; older ones stay one click away. */
const SESSIONS_SHOWN = 4;

function Sessions() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<AccountSession[] | null>(null);
  const [all, setAll] = useState(false);
  const status = useStatus();
  const load = useCallback(async () => {
    const { items } = await api.get<{ items: AccountSession[] }>('/me/sessions');
    setItems([...items].sort((a, b) => Number(b.current) - Number(a.current)));
  }, []);
  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [load]);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Card
      title={t('settings.sessions.title')}
      body={t('settings.sessions.body')}
      action={
        (items?.length ?? 0) > 1 && (
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await trackSave(authApi.revokeOtherSessions());
                await load();
              } catch (err) {
                status.fail(err);
              }
            }}
          >
            {t('settingsUi.account.endOthers')}
          </Button>
        )
      }
    >
      <ul className="settings-list">
        {(all ? items : items?.slice(0, SESSIONS_SHOWN))?.map((s) => (
          <li key={s.id}>
            <span className="settings-list__text">
              <span className="settings-row__label">{deviceName(s.userAgent, t)}</span>
              <span className="settings-row__help">
                {[
                  !s.current && t('settings.sessions.since', { when: when(s.updatedAt) }),
                  s.ipAddress,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {s.current ? (
              <Badge tone="accent">{t('settingsUi.account.here')}</Badge>
            ) : (
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await trackSave(api.delete(`/me/sessions/${s.id}`));
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
      {!all && (items?.length ?? 0) > SESSIONS_SHOWN && (
        <button type="button" className="settings-list__more" onClick={() => setAll(true)}>
          {t('settingsUi.account.allSessions', { count: items?.length })}
        </button>
      )}
      {status.node && <div className="settings-card__pad">{status.node}</div>}
    </Card>
  );
}

function Tokens() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<PersonalToken[] | null>(null);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
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
  const close = () => {
    setOpen(false);
    setCreated(null);
    setName('');
    status.clear();
  };

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
    <Card
      title={t('settings.tokens.title')}
      body={t('settings.tokens.body')}
      action={
        <Button variant="ghost" icon="plus" onClick={() => setOpen(true)}>
          {t('settingsUi.account.newToken')}
        </Button>
      }
    >
      <ul className="settings-list">
        {items?.length === 0 && <li className="settings-muted">{t('settings.tokens.none')}</li>}
        {items?.map((tk) => (
          <li key={tk.id}>
            <span className="settings-list__text">
              <span className="settings-row__label">{tk.name}</span>
              <span className="settings-row__help">
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
                  await trackSave(api.delete(`/me/tokens/${tk.id}`));
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
      {!open && status.node && <div className="settings-card__pad">{status.node}</div>}
      <Dialog open={open} title={t('settings.tokens.create')} onClose={close}>
        {created ? (
          <div className="settings-form" role="status">
            <p>{t('settings.tokens.copyNow', { name: created.name })}</p>
            <code className="settings__token">{created.token}</code>
            <DialogActions>
              <Button
                onClick={() => navigator.clipboard?.writeText(created.token).catch(() => {})}
                icon="copy"
              >
                {t('share.copy')}
              </Button>
              <Button variant="primary" onClick={close}>
                {t('settings.tokens.done')}
              </Button>
            </DialogActions>
          </div>
        ) : (
          <form className="settings-form" onSubmit={create}>
            <p className="settings-muted">{t('settings.tokens.body')}</p>
            <TextField
              label={t('settings.tokens.name')}
              placeholder={t('settings.tokens.namePlaceholder')}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {status.node}
            <DialogActions>
              <Button variant="ghost" onClick={close}>
                {t('project.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={!name.trim()}>
                {t('settings.tokens.create')}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>
    </Card>
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
        const projects = (err.details as DeleteMeBlocked | undefined)?.soleOwnerOf;
        if (projects) setBlocked(projects);
        else status.show(t('admin.lastAdmin'), true);
      } else status.fail(err);
    }
  }

  return (
    <Card danger title={t('settingsUi.dangerZone')}>
      <div className="settings-rows">
        <Row label={t('settings.delete.title')} help={t('settings.delete.body')}>
          <Button variant="danger" onClick={() => setOpen(true)}>
            {t('settings.delete.open')}
          </Button>
        </Row>
      </div>
      <Dialog open={open} title={t('settings.delete.confirmTitle')} onClose={() => setOpen(false)}>
        <form className="settings-form" onSubmit={remove}>
          <p>{t('settings.delete.confirmBody')}</p>
          {hasPassword ? (
            <TextField
              label={t('settings.password.current')}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          ) : (
            <p className="settings-muted">{t('settings.delete.fresh')}</p>
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
    </Card>
  );
}
