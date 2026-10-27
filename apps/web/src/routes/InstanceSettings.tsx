import type { InstanceSettings as Settings } from '@inkadra/shared';
import { Button, TextField } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

export function InstanceSettings({ section }: { section: string }) {
  const { t, i18n } = useTranslation();
  const { instance, refresh } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [storage, setStorage] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<Settings>('/instance/settings'),
      api.get<{ originalBytes: number }>('/instance/storage'),
    ])
      .then(([data, usage]) => {
        if (active) {
          setSettings(data);
          setStorage(usage.originalBytes);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const state = (enabled: boolean | undefined) => t(enabled ? 'admin.enabled' : 'admin.disabled');
  return (
    <>
      {error && <p role="alert">{t('auth.errors.generic')}</p>}
      {section === 'instance' && settings && (
        <form
          className="settings__form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(false);
            setSaved(false);
            try {
              setSettings(await api.patch<Settings>('/instance/settings', settings));
              await refresh();
              setSaved(true);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>{t('admin.branding')}</h2>
          <TextField
            label={t('admin.instanceName')}
            value={settings.name}
            required
            maxLength={120}
            onChange={(e) => setSettings({ ...settings, name: e.target.value })}
          />
          <label className="settings__label">
            {t('admin.registration')}
            <select
              className="ink-input"
              value={settings.registration}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  registration: e.target.value as Settings['registration'],
                })
              }
            >
              {(['open', 'invite', 'closed'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(`admin.registrationModes.${mode}`)}
                </option>
              ))}
            </select>
          </label>
          <p className="ink-muted">{t('admin.registrationHelp')}</p>
          <Button type="submit" variant="primary" disabled={busy || !settings.name.trim()}>
            {t('settings.save')}
          </Button>
          {saved && <p role="status">{t('settings.saved')}</p>}
        </form>
      )}
      {section === 'workspace' && (
        <section>
          <h2>{t('admin.storage')}</h2>
          <p>
            {storage === null
              ? t('admin.loading')
              : t('admin.storageBytes', { bytes: storage.toLocaleString(i18n.language) })}
          </p>
          <p className="ink-muted">{t('admin.storageHelp')}</p>
          {storage === 0 && <p>{t('admin.storageEmpty')}</p>}
        </section>
      )}
      {section === 'providers' && (
        <section>
          <h2>{t('admin.providers')}</h2>
          <p className="ink-muted">{t('admin.providersHelp')}</p>
          <dl className="settings-facts">
            <dt>{t('admin.password')}</dt>
            <dd>{state(instance?.auth.emailPassword)}</dd>
            <dt>Google</dt>
            <dd>{state(instance?.auth.google)}</dd>
            <dt>OIDC</dt>
            <dd>
              {instance?.auth.oidc.length
                ? instance.auth.oidc.map((p) => p.name).join(', ')
                : state(false)}
            </dd>
            <dt>{t('admin.magicLink')}</dt>
            <dd>{state(instance?.auth.magicLink)}</dd>
            <dt>SMTP</dt>
            <dd>{state(instance?.auth.email)}</dd>
          </dl>
        </section>
      )}
      <p className="ink-muted">
        {instance?.name} · {instance?.version}
      </p>
      <Link to="/diagnostics">{t('auth.diagnostics')}</Link>
    </>
  );
}
