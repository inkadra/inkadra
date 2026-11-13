import type { InstanceSettings as Settings, StorageUsage } from '@inkadra/shared';
import { Switch } from '@inkadra/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { FeedbackSettings } from '../feedback/FeedbackSettings.tsx';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { usePendingUpdate } from '../lib/updates.ts';
import { BackupSettings } from './BackupSettings.tsx';
import { ProviderIcon } from './ProviderIcon.tsx';
import { StorageCharts } from './StorageCharts.tsx';
import { StorageLimitsCards } from './StorageLimitsSettings.tsx';
import { ServerSettings } from './server/ServerSettings.tsx';
import { trackSave } from './settings-save.ts';
import { CHECK_PAGES } from './settings-sections.ts';
import { AutosaveText, Badge, Card, Row, Segmented } from './settings-ui.tsx';
import { UpdateSettings } from './UpdateSettings.tsx';

type Setup = { checks: Array<{ id: string; ok: boolean }> | null; error: boolean };
type Registration = Settings['registration'];

/** Instance name and registration mode, saved as soon as they change. */
export function useInstanceSettings() {
  const { refresh } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      if (alive) setError(true);
    }, 15_000);
    api
      .get<Settings>('/instance/settings', controller.signal)
      .then((data) => alive && !controller.signal.aborted && setSettings(data))
      .catch(() => alive && setError(true))
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  const save = useCallback(
    async (patch: Partial<Settings>) => {
      const previous = settings;
      if (settings) setSettings({ ...settings, ...patch });
      try {
        const next = await trackSave(api.patch<Settings>('/instance/settings', patch));
        setSettings(next);
        await refresh();
      } catch (err) {
        setSettings(previous);
        throw err;
      }
    },
    [settings, refresh],
  );
  return { settings, error, save };
}

export function useStorageUsage() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<StorageUsage>('/instance/storage')
      .then((data) => alive && setUsage(data))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);
  return { usage, error };
}

function LoadError() {
  const { t } = useTranslation();
  return <p role="alert">{t('auth.errors.generic')}</p>;
}

/** The setup checklist of General: a failing check opens the page that fixes it. */
function SetupChecklist({ setup }: { setup: Setup }) {
  const { t } = useTranslation();
  const done = setup.checks?.filter((c) => c.ok).length ?? 0;
  return (
    <Card
      anchor="instance.setup"
      title={t('settingsUi.general.setup')}
      action={
        setup.checks && (
          <span className="settings-card__meta">
            {t('onboarding.checkProgress', { done, total: setup.checks.length })}
          </span>
        )
      }
    >
      {setup.error ? (
        <p role="alert" className="settings-card__empty">
          {t('home.loadError')}
        </p>
      ) : !setup.checks ? (
        <p role="status" className="settings-card__empty settings-muted">
          {t('admin.loading')}
        </p>
      ) : (
        setup.checks.map((c) => (
          <Row
            key={c.id}
            icon={c.ok ? 'check' : 'warning'}
            tone={c.ok ? 'ok' : 'warn'}
            label={t(`onboarding.checks.${c.id}`)}
            help={c.ok ? undefined : t(`settingsUi.general.fix.${c.id}`)}
          >
            {c.ok ? (
              <Badge tone="ok">{t('onboarding.ready')}</Badge>
            ) : (
              <Link
                className="ink-btn ink-btn--secondary"
                to={`/settings?section=${CHECK_PAGES[c.id] ?? 'server'}`}
                replace
                aria-label={`${t('settingsUi.general.configure')}: ${t(`onboarding.checks.${c.id}`)}`}
              >
                {t('settingsUi.general.configure')}
              </Link>
            )}
          </Row>
        ))
      )}
    </Card>
  );
}

/** Read-only sign-in providers: they are configured in the server environment. */
function providerRows(
  instance: ReturnType<typeof useSession>['instance'],
  t: (key: string) => string,
) {
  const auth = instance?.auth;
  const off = (vars: string) => <code className="settings-env">{vars}</code>;
  return [
    {
      id: 'password',
      name: t('admin.password'),
      on: !!auth?.emailPassword,
      help: t(auth?.emailPassword ? 'settingsUi.access.always' : 'settingsUi.access.disabled'),
    },
    {
      id: 'google',
      name: 'Google',
      on: !!auth?.google,
      help: auth?.google
        ? t('settingsUi.access.configured')
        : off('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET'),
    },
    ...(auth?.oidc.length
      ? auth.oidc.map((p) => ({
          id: 'oidc',
          name: `OIDC · ${p.name}`,
          on: true,
          help: t('settingsUi.access.configured'),
        }))
      : [
          {
            id: 'oidc',
            name: 'OIDC',
            on: false,
            help: off('OIDC_DISCOVERY_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET'),
          },
        ]),
    {
      id: 'link',
      name: t('admin.magicLink'),
      on: !!auth?.magicLink,
      warn: !auth?.email,
      help: t(auth?.email ? 'settingsUi.access.configured' : 'settingsUi.access.needsSmtp'),
    },
  ];
}

function RegistrationControl({
  value,
  onChange,
}: {
  value: Registration;
  onChange: (value: Registration) => void;
}) {
  const { t } = useTranslation();
  return (
    <Segmented
      label={t('admin.registration')}
      value={value}
      onChange={onChange}
      options={(['open', 'invite', 'closed'] as const).map((mode) => ({
        value: mode,
        label: t(`admin.registrationModes.${mode}`),
      }))}
    />
  );
}

export function InstanceSettings({ section, setup }: { section: string; setup: Setup }) {
  if (section === 'workspace') return <StoragePage />;
  if (section === 'access') return <AccessPage />;
  if (section === 'reports') return <FeedbackSettings />;
  if (section === 'backups') return <BackupSettings />;
  if (section === 'server') return <ServerSettings />;
  if (section === 'updates') return <UpdateSettings />;
  return <GeneralPage setup={setup} />;
}

function StoragePage() {
  const { t } = useTranslation();
  const storage = useStorageUsage();
  return (
    <>
      <StorageLimitsCards usage={storage.usage} />
      {storage.error ? (
        <LoadError />
      ) : storage.usage ? (
        <StorageCharts usage={storage.usage} />
      ) : (
        <p role="status">{t('admin.loading')}</p>
      )}
    </>
  );
}

/**
 * Who may come in and what members may do (decision 0124): registration, the two rights that
 * were above the list of members, two-step sign-in for administrators, then the sign-in methods
 * and the email sending, read-only because the server configures them.
 */
function AccessPage() {
  const { t } = useTranslation();
  const { instance, user } = useSession();
  const { settings, error, save } = useInstanceSettings();
  if (error) return <LoadError />;
  if (!settings) return <p role="status">{t('admin.loading')}</p>;
  const toggle = (patch: Partial<Settings>) => void save(patch).catch(() => {});
  return (
    <>
      <Card anchor="access.registration" title={t('settingsUi.registration.label')}>
        <Row
          label={t('admin.registration')}
          help={t(`settingsUi.registration.${settings.registration}`)}
        >
          <RegistrationControl
            value={settings.registration}
            onChange={(registration) => toggle({ registration })}
          />
        </Row>
      </Card>
      <Card title={t('settingsUi.accessPage.members')}>
        <Row
          anchor="access.projectCreation"
          label={t('projectCreation.settings.label')}
          help={t('settingsUi.accessPage.createHelp')}
          htmlFor="members-create-projects"
        >
          <Switch
            id="members-create-projects"
            checked={settings.membersCanCreateProjects ?? true}
            onChange={(e) => toggle({ membersCanCreateProjects: e.target.checked })}
          />
        </Row>
        <Row anchor="access.calendar" label={t('calendar.admin')} help={t('calendar.adminHelp')}>
          <Switch
            aria-label={t('calendar.admin')}
            checked={settings.calendarFeedEnabled ?? true}
            onChange={(e) => toggle({ calendarFeedEnabled: e.target.checked })}
          />
        </Row>
      </Card>
      <Card title={t('settingsUi.accessPage.security')}>
        <Row
          anchor="access.adminTwoFactor"
          icon="lock"
          label={t('admin.requireAdminTwoFactor')}
          help={t(
            user?.twoFactorEnabled
              ? 'admin.requireAdminTwoFactorHelp'
              : 'admin.requireAdminTwoFactorEnrollFirst',
          )}
        >
          <Switch
            aria-label={t('admin.requireAdminTwoFactor')}
            checked={settings.requireAdminTwoFactor ?? false}
            disabled={!user?.twoFactorEnabled}
            onChange={(e) => toggle({ requireAdminTwoFactor: e.target.checked })}
          />
        </Row>
      </Card>
      <Card
        anchor="access.methods"
        title={t('settings.methods.title')}
        action={<Badge>{t('settingsUi.accessPage.readOnly')}</Badge>}
      >
        {providerRows(instance, t).map((p) => (
          <Row
            key={p.id + p.name}
            leading={<ProviderIcon id={p.id} name={p.name} />}
            label={p.name}
            help={p.help}
          >
            <Badge tone={p.on ? 'ok' : p.warn ? 'warn' : 'neutral'}>
              {t(
                p.on
                  ? 'settingsUi.on'
                  : p.warn
                    ? 'settingsUi.access.missingSmtp'
                    : 'settingsUi.off',
              )}
            </Badge>
          </Row>
        ))}
        <Row
          anchor="access.email"
          leading={<ProviderIcon id="smtp" />}
          label={t('settingsUi.access.email')}
          help={
            instance?.auth.email ? (
              t('settingsUi.access.smtpOn')
            ) : (
              <>
                <code className="settings-env">SMTP_URL</code> · {t('settingsUi.access.smtpOff')}
              </>
            )
          }
        >
          <Badge tone={instance?.auth.email ? 'ok' : 'warn'}>
            {t(instance?.auth.email ? 'settingsUi.on' : 'onboarding.needsSetup')}
          </Badge>
        </Row>
      </Card>
      <p className="settings-footnote">{t('admin.providersHelp')}</p>
    </>
  );
}

/** Settings → General (formerly Informazioni): name, address, version, setup checklist. */
function GeneralPage({ setup }: { setup: Setup }) {
  const { t } = useTranslation();
  const { instance, version } = useSession();
  const update = usePendingUpdate();
  const { settings, error, save } = useInstanceSettings();
  if (error) return <LoadError />;
  if (!settings) return <p role="status">{t('admin.loading')}</p>;
  return (
    <>
      <Card title={t('settingsUi.about.identity')}>
        <Row
          anchor="instance.name"
          label={t('admin.instanceName')}
          help={t('settingsUi.about.nameHelp')}
          htmlFor="instance-name"
        >
          <AutosaveText
            id="instance-name"
            label={t('admin.instanceName')}
            value={settings.name}
            maxLength={120}
            save={(name) => save({ name })}
          />
        </Row>
        <Row anchor="instance.url" label={t('settingsUi.about.url')}>
          <code className="settings-env">{instance?.publicUrl}</code>
        </Row>
        <Row
          anchor="instance.version"
          label={t('settingsUi.about.version')}
          help={update ? t('updates.navAvailable', { version: update.version }) : undefined}
        >
          <span className="settings-value">Inkadra {version}</span>
          <Link className="ink-btn ink-btn--ghost" to="/settings?section=updates" replace>
            {t('settingsUi.pages.updates')}
          </Link>
        </Row>
      </Card>
      <SetupChecklist setup={setup} />
    </>
  );
}
