import type { InstanceSettings as Settings, StorageUsage } from '@inkadra/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { BackupSettings } from './BackupSettings.tsx';
import { DiagnosticsLink } from './SettingsShell.tsx';
import { formatStorage, StorageCharts } from './StorageCharts.tsx';
import { trackSave } from './settings-save.ts';
import { AutosaveText, Badge, Card, Row, Segmented } from './settings-ui.tsx';

type Setup = { checks: Array<{ id: string; ok: boolean }> | null; error: boolean };
type Registration = Settings['registration'];

/** Instance name and registration mode, saved as soon as they change. */
export function useInstanceSettings() {
  const { refresh } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<Settings>('/instance/settings')
      .then((data) => alive && setSettings(data))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
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

/** The setup checklist as rows of the Informazioni page, with storage use and diagnostics. */
function InstanceStatus({ setup }: { setup: Setup }) {
  const { t, i18n } = useTranslation();
  const { usage } = useStorageUsage();
  const done = setup.checks?.filter((c) => c.ok).length ?? 0;
  return (
    <Card
      title={t('settingsUi.status.title')}
      action={
        setup.checks && (
          <span className="settings-card__meta">
            {t('onboarding.checkProgress', { done, total: setup.checks.length })}
          </span>
        )
      }
    >
      <div className="settings-rows">
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
            <Row key={c.id} label={t(`onboarding.checks.${c.id}`)}>
              <Badge tone={c.ok ? 'ok' : 'warn'}>
                {t(c.ok ? 'onboarding.ready' : 'onboarding.needsSetup')}
              </Badge>
            </Row>
          ))
        )}
        {usage && (
          <Row label={t('admin.storage')}>
            <span className="settings-value">
              {formatStorage(usage.originalBytes, i18n.language)}
            </span>
          </Row>
        )}
        <Row label={t('settingsUi.diagnostics')} help={t('settingsUi.about.diagnosticsHelp')}>
          <DiagnosticsLink className="ink-btn ink-btn--secondary">
            {t('settingsUi.about.openDiagnostics')}
          </DiagnosticsLink>
        </Row>
      </div>
    </Card>
  );
}

function ProviderIcon({ id }: { id: string }) {
  return (
    <span className={`settings-provider settings-provider--${id}`} aria-hidden="true">
      {id === 'google' ? 'G' : id === 'password' ? '@' : id === 'smtp' ? '✉' : id[0]?.toUpperCase()}
    </span>
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
  if (section === 'providers') return <AccessPage />;
  if (section === 'backups') return <BackupSettings />;
  return <InstancePage section={section} setup={setup} />;
}

function StoragePage() {
  const { t } = useTranslation();
  const storage = useStorageUsage();
  return storage.error ? (
    <LoadError />
  ) : storage.usage ? (
    <StorageCharts usage={storage.usage} />
  ) : (
    <p role="status">{t('admin.loading')}</p>
  );
}

function AccessPage() {
  const { t } = useTranslation();
  const { instance } = useSession();
  return (
    <>
      <Card title={t('settings.methods.title')}>
        <div className="settings-rows">
          {providerRows(instance, t).map((p) => (
            <Row
              key={p.id + p.name}
              leading={<ProviderIcon id={p.id} />}
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
        </div>
      </Card>
      <Card title={t('settingsUi.access.email')}>
        <div className="settings-rows">
          <Row
            leading={<ProviderIcon id="smtp" />}
            label="SMTP"
            help={
              instance?.auth.email ? (
                t('settingsUi.access.smtpOn')
              ) : (
                <code className="settings-env">SMTP_URL</code>
              )
            }
          >
            <Badge tone={instance?.auth.email ? 'ok' : 'warn'}>
              {t(instance?.auth.email ? 'settingsUi.on' : 'onboarding.needsSetup')}
            </Badge>
          </Row>
        </div>
      </Card>
      <p className="settings-footnote">{t('admin.providersHelp')}</p>
    </>
  );
}

function InstancePage({ section, setup }: { section: string; setup: Setup }) {
  const { t } = useTranslation();
  const { instance, version, user } = useSession();
  const { settings, error, save } = useInstanceSettings();
  if (error) return <LoadError />;
  if (!settings) return <p role="status">{t('admin.loading')}</p>;

  if (section === 'registration')
    return (
      <Card title={t('admin.registration')}>
        <div className="settings-rows">
          <Row
            label={t('admin.requireAdminTwoFactor')}
            help={t(
              user?.twoFactorEnabled
                ? 'admin.requireAdminTwoFactorHelp'
                : 'admin.requireAdminTwoFactorEnrollFirst',
            )}
          >
            <input
              type="checkbox"
              aria-label={t('admin.requireAdminTwoFactor')}
              checked={settings.requireAdminTwoFactor ?? false}
              disabled={!user?.twoFactorEnabled}
              onChange={(event) =>
                void save({ requireAdminTwoFactor: event.target.checked }).catch(() => {})
              }
            />
          </Row>
          <Row label={t('settingsUi.registration.label')} help={t('admin.registrationHelp')}>
            <RegistrationControl
              value={settings.registration}
              onChange={(registration) => void save({ registration }).catch(() => {})}
            />
          </Row>
          <Row
            label={t(`admin.registrationModes.${settings.registration}`)}
            help={t(`settingsUi.registration.${settings.registration}`)}
          />
        </div>
      </Card>
    );

  return (
    <>
      <Card title={t('settingsUi.about.identity')}>
        <div className="settings-rows">
          <Row
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
          <Row label={t('settingsUi.about.url')}>
            <code className="settings-env">{instance?.publicUrl}</code>
          </Row>
          <Row label={t('settingsUi.about.version')}>
            <span>Inkadra {version}</span>
          </Row>
        </div>
      </Card>
      <InstanceStatus setup={setup} />
    </>
  );
}
