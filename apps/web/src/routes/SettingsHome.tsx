import type { InstanceMember, NotificationPreferences } from '@inkadra/shared';
import { Avatar, Icon } from '@inkadra/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, authApi } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { type ThemePreference, useTheme } from '../lib/theme.ts';
import { useInstanceSettings, useStorageUsage } from './InstanceSettings.tsx';
import { setCachedProjects } from './projects.ts';
import { DiagnosticsLink, setupAttention } from './SettingsShell.tsx';
import { formatStorage } from './StorageCharts.tsx';
import { GROUP_TITLES, SETTINGS_PAGES } from './settings-sections.ts';
import { Segmented } from './settings-ui.tsx';

type Setup = { checks: Array<{ id: string; ok: boolean }> | null; error: boolean };

const href = (id: string) => SETTINGS_PAGES.find((p) => p.id === id)?.href ?? '/settings';

function Item({
  to,
  label,
  value,
  warn,
}: {
  to: string;
  label: string;
  value?: ReactNode;
  warn?: string;
}) {
  return (
    <li>
      <Link to={to} className="settings-home__item">
        <span className="settings-home__label">
          {label}
          {warn && <span className="settings-home__warn">{warn}</span>}
        </span>
        {value !== undefined && <span className="settings-home__value">{value}</span>}
        <Icon name="chevronRight" size={14} />
      </Link>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-home__group">
      <h2>{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}

function AdminGroups({ setup }: { setup: Setup }) {
  const { t, i18n } = useTranslation();
  const { version } = useSession();
  const [members, setMembers] = useState<number | null>(null);
  const { usage } = useStorageUsage();
  const { settings } = useInstanceSettings();
  useEffect(() => {
    let alive = true;
    api
      .get<{ items: InstanceMember[] }>('/instance/members')
      .then((r) => alive && setMembers(r.items.filter((m) => !m.deactivatedAt).length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const pending = t('onboarding.needsSetup');
  return (
    <>
      <Group title={t(GROUP_TITLES.workspace)}>
        <Item to={href('members')} label={t('admin.members')} value={members ?? undefined} />
        <Item
          to={href('workspace')}
          label={t('admin.storage')}
          value={usage ? formatStorage(usage.originalBytes, i18n.language) : undefined}
        />
        <Item to={href('classifications')} label={t('admin.classifications')} />
      </Group>
      <Group title={t(GROUP_TITLES.instance)}>
        <Item
          to={href('providers')}
          label={t('settingsUi.pages.access')}
          warn={setupAttention(setup, 'providers') ? pending : undefined}
        />
        <Item
          to={href('registration')}
          label={t('admin.registration')}
          value={settings ? t(`admin.registrationModes.${settings.registration}`) : undefined}
        />
        <Item to={href('backups')} label={t('backups.title')} />
        <Item
          to={href('instance')}
          label={t('settingsUi.pages.about')}
          value={version}
          warn={setupAttention(setup, 'instance') ? pending : undefined}
        />
      </Group>
    </>
  );
}

/** Phone settings: the Profile tab, as grouped rows like the native apps. */
export function SettingsHome({ setup }: { setup: Setup }) {
  const { t, i18n } = useTranslation();
  const { user, instance, refresh, version } = useSession();
  const { preference, choose } = useTheme();
  const [email, setEmail] = useState<NotificationPreferences['email'] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<NotificationPreferences>('/me/notification-preferences')
      .then((p) => alive && setEmail(p.email))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  async function signOut() {
    await authApi.signOut();
    setCachedProjects(null);
    await refresh();
  }
  const admin = user?.role === 'admin';
  return (
    <div className="settings-home">
      <Link to={href('account')} className="settings-home__me">
        <Avatar name={user?.name ?? ''} image={user?.image} size={44} />
        <span className="settings-home__label">
          <strong>{user?.name}</strong>
          <span className="settings-home__sub">
            {admin ? t('admin.roles.admin') : t('admin.roles.member')} · {user?.email}
          </span>
        </span>
        <Icon name="chevronRight" size={14} />
      </Link>
      <Group title={t('admin.personal')}>
        <Item
          to={href('notifications')}
          label={t('notifications.emailTitle')}
          value={email ? t(`settingsUi.notifications.short.${email}`) : undefined}
        />
        <li className="settings-home__inline">
          <span className="settings-home__label">{t('admin.theme')}</span>
          <Segmented
            label={t('admin.theme')}
            value={preference}
            onChange={(value: ThemePreference) => choose(value)}
            options={(['dark', 'light', 'system'] as const).map((value) => ({
              value,
              label: t(`admin.themes.${value}`),
            }))}
          />
        </li>
        <Item
          to={href('preferences')}
          label={t('settings.profile.language')}
          value={t(`settings.profile.languages.${user?.locale ?? i18n.language}`)}
        />
        <Item to={href('toolbar')} label={t('settingsUi.pages.toolbar')} />
      </Group>
      {admin && <AdminGroups setup={setup} />}
      <button type="button" className="settings-home__signout" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </button>
      <p className="settings-home__version">
        Inkadra {version} · AGPL-3.0 ·{' '}
        <DiagnosticsLink>{t('settingsUi.diagnostics')}</DiagnosticsLink>
      </p>
    </div>
  );
}
