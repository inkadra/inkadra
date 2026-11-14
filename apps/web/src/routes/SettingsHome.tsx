import type { InstanceMember, NotificationPreferences } from '@inkadra/shared';
import { Avatar, Icon, type IconName } from '@inkadra/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { useSignOut } from '../lib/SignOut.tsx';
import { useSession } from '../lib/session.tsx';
import { type ThemePreference, useTheme } from '../lib/theme.ts';
import { usePendingUpdate } from '../lib/updates.ts';
import { useInstanceSettings, useStorageUsage } from './InstanceSettings.tsx';
import { SettingsSearch } from './SettingsSearch.tsx';
import { setupAttention } from './SettingsShell.tsx';
import { formatStorage } from './StorageCharts.tsx';
import { GROUP_TITLES, SETTINGS_PAGES, type SettingsGroup } from './settings-sections.ts';
import { Segmented } from './settings-ui.tsx';

type Setup = { checks: Array<{ id: string; ok: boolean }> | null; error: boolean };

const href = (id: string) => SETTINGS_PAGES.find((p) => p.id === id)?.href ?? '/settings';

function Item({
  to,
  icon,
  label,
  value,
  warn,
}: {
  to: string;
  icon: IconName;
  label: string;
  value?: ReactNode;
  warn?: string;
}) {
  return (
    <li>
      <Link to={to} className="settings-home__item">
        <Icon name={icon} size={16} />
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

/** The pages of one group, with the value or warning each shows on its row. */
function PageItems({
  group,
  values,
  setup,
}: {
  group: SettingsGroup;
  values: Partial<Record<string, ReactNode>>;
  setup: Setup;
}) {
  const { t } = useTranslation();
  const pending = t('onboarding.needsSetup');
  return SETTINGS_PAGES.filter((p) => p.group === group && p.id !== 'account').map((p) => (
    <Item
      key={p.id}
      to={p.href}
      icon={p.icon}
      label={t(p.title)}
      value={values[p.id]}
      warn={setupAttention(setup, p.id) ? pending : undefined}
    />
  ));
}

function AdminGroups({ setup }: { setup: Setup }) {
  const { t, i18n } = useTranslation();
  const { version } = useSession();
  const update = usePendingUpdate();
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
  return (
    <>
      <Group title={t(GROUP_TITLES.workspace)}>
        <PageItems
          group="workspace"
          setup={setup}
          values={{
            members: members ?? undefined,
            access: settings ? t(`admin.registrationModes.${settings.registration}`) : undefined,
          }}
        />
      </Group>
      <Group title={t(GROUP_TITLES.server)}>
        <PageItems
          group="server"
          setup={setup}
          values={{
            instance: version,
            workspace: usage
              ? formatStorage(usage.originalBytes + (usage.derivedBytes ?? 0), i18n.language)
              : undefined,
            updates: update ? t('updates.navAvailable', { version: update.version }) : undefined,
          }}
        />
      </Group>
    </>
  );
}

/**
 * Phone settings: the Profile tab, as grouped rows like the native apps, under the same search
 * as the window's navigation; its results take the whole width in place of the rows.
 */
export function SettingsHome({ setup }: { setup: Setup }) {
  const { t, i18n } = useTranslation();
  const { user, version } = useSession();
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
  const [signOutFailed, setSignOutFailed] = useState(false);
  const leave = useSignOut(user?.id, () => setSignOutFailed(true));
  const admin = user?.role === 'admin';
  return (
    <div className="settings-home">
      <SettingsSearch replace={false}>
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
        <Group title={t(GROUP_TITLES.personal)}>
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
          <PageItems
            group="personal"
            setup={setup}
            values={{
              preferences: t(`settings.profile.languages.${user?.locale ?? i18n.language}`),
              notifications: email
                ? t(`settingsUi.notifications.short.${email === 'off' ? 'immediate' : email}`)
                : undefined,
            }}
          />
        </Group>
        {admin && <AdminGroups setup={setup} />}
        <button type="button" className="settings-home__signout" onClick={leave.start}>
          {t('auth.signOut')}
        </button>
        {leave.dialog}
        {signOutFailed && (
          <p role="alert" className="settings-home__signout-error">
            {t('auth.signOutFailed')}
          </p>
        )}
        <p className="settings-home__version">Inkadra {version} · AGPL-3.0</p>
      </SettingsSearch>
    </div>
  );
}
