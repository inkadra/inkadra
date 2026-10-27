import { Icon, NavItem } from '@inkadra/ui';
import { type MouseEvent, type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useSession } from '../lib/session.tsx';
import { resetSaveState, type SaveState, useSaveState } from './settings-save.ts';
import {
  GROUP_TITLES,
  SETTINGS_PAGES,
  type SettingsGroup,
  type SettingsPage,
  settingsSection,
} from './settings-sections.ts';
import { useIsPhone } from './settings-ui.tsx';
import './settings.css';

type Setup = { checks: Array<{ id: string; ok: boolean }> | null; error: boolean };

/** Which page the instance checklist sends an admin to when a check fails. */
export function setupAttention(setup: Setup, page: string): boolean {
  const failing = (ids: string[]) => setup.checks?.some((c) => ids.includes(c.id) && !c.ok);
  if (page === 'providers') return !!failing(['providers', 'smtp']);
  if (page === 'instance') return setup.error || !!failing(['storage', 'domain']);
  return false;
}

/** Desktop settings navigation; replaces the project sidebar while settings are open. */
export function SettingsNav({ setup, onNavigate }: { setup: Setup; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { user, instance } = useSession();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const current = settingsSection(pathname, search).id;
  const pages = SETTINGS_PAGES.filter((p) => !p.admin || user?.role === 'admin');
  const groups = [...new Set(pages.map((p) => p.group))] as SettingsGroup[];
  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    onNavigate?.();
    navigate(to);
  };
  return (
    <nav className="settings-nav" aria-label={t('nav.settings')}>
      <a className="settings-nav__back" href="/" onClick={go('/')}>
        <Icon name="chevronRight" size={14} />
        {t('settingsUi.backToProjects')}
      </a>
      <h1 className="settings-nav__title">{t('nav.settings')}</h1>
      {groups.map((group) => (
        <div key={group} className="settings-nav__group">
          <h2>{t(GROUP_TITLES[group])}</h2>
          {pages
            .filter((p) => p.group === group)
            .map((p) => (
              <NavItem
                key={p.id}
                href={p.href}
                label={t(p.title)}
                active={p.id === current}
                onClick={go(p.href)}
                leading={null}
                {...(setupAttention(setup, p.id) && {
                  'data-attention': true,
                  title: t('onboarding.settingsPending'),
                })}
              />
            ))}
        </div>
      ))}
      <footer className="settings-nav__footer">
        <span>{typeof window === 'undefined' ? '' : window.location.host}</span>
        <span>
          Inkadra {instance?.version} · AGPL-3.0 ·{' '}
          <Link to="/diagnostics">{t('settingsUi.diagnostics')}</Link>
        </span>
      </footer>
    </nav>
  );
}

const SAVE_LABELS: Record<SaveState, string> = {
  idle: 'settingsUi.autosave.idle',
  saving: 'settingsUi.autosave.saving',
  saved: 'settingsUi.autosave.saved',
  error: 'settingsUi.autosave.error',
};

export function SaveStatus() {
  const { t } = useTranslation();
  const state = useSaveState();
  return (
    <span
      className={`settings-save settings-save--${state}`}
      role={state === 'error' ? 'alert' : 'status'}
    >
      {t(SAVE_LABELS[state])}
    </span>
  );
}

/** Frame of one settings page: phone back link, heading, main column and optional aside. */
export function SettingsShell({
  page,
  actions,
  aside,
  children,
}: {
  page?: SettingsPage;
  actions?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const phone = useIsPhone();
  const current = page ?? settingsSection(location.pathname, location.search);
  // Each page starts from the neutral "saved automatically" message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on page change only.
  useEffect(() => resetSaveState(), [current.id]);
  return (
    <div className={aside ? 'settings-page settings-page--aside' : 'settings-page'}>
      {phone && (
        <Link className="settings-back" to="/settings">
          <Icon name="chevronRight" size={14} />
          {t('settingsUi.profile')}
        </Link>
      )}
      <header className="settings-page__head">
        <div>
          <h1 className="settings__title">{t(current.title)}</h1>
          <p className="settings__lead">{t(current.lead)}</p>
        </div>
        {actions && <div className="settings-page__actions">{actions}</div>}
      </header>
      <div className="settings-page__body">
        <div className="settings-page__main">{children}</div>
        {aside && <aside className="settings-page__aside">{aside}</aside>}
      </div>
    </div>
  );
}
