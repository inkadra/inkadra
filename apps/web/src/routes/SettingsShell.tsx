import { Icon } from '@inkadra/ui';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { useSession } from '../lib/session.tsx';
import { usePendingUpdate } from '../lib/updates.ts';
import { SettingsSearch } from './SettingsSearch.tsx';
import { useServerView } from './server/ServerSettings.tsx';
import { resetSaveState, type SaveState, useSaveState } from './settings-save.ts';
import {
  CHECK_PAGES,
  GROUP_TITLES,
  SETTINGS_PAGES,
  type SettingsGroup,
  type SettingsPage,
  settingsSection,
} from './settings-sections.ts';
import './settings.css';

type Setup = { checks: Array<{ id: string; ok: boolean }> | null; error: boolean };

/** Whether a page has a failing check of the instance checklist to fix. */
export function setupAttention(setup: Setup, page: string): boolean {
  if (page === 'instance') return setup.error;
  return !!setup.checks?.some((c) => !c.ok && CHECK_PAGES[c.id] === page);
}

/**
 * The settings window's own navigation: the settings search (its results take the place of the
 * pages while it has text), then the pages the person may open, grouped. Moving between pages
 * replaces the history entry, so the browser's Back closes the window instead of walking
 * through every page visited.
 */
export function SettingsNav({
  setup,
  members,
  onClose,
}: {
  setup: Setup;
  members?: number | null;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const { user, instance, version } = useSession();
  const { pathname, search } = useLocation();
  const current = settingsSection(pathname, search).id;
  const update = usePendingUpdate();
  const pages = SETTINGS_PAGES.filter((p) => !p.admin || user?.role === 'admin');
  const groups = [...new Set(pages.map((p) => p.group))] as SettingsGroup[];
  return (
    <nav className="settings-nav" aria-label={t('nav.settings')}>
      <SettingsSearch onClose={onClose}>
        <div className="settings-nav__groups">
          {groups.map((group) => (
            <div key={group} className="settings-nav__group">
              <h3>{t(GROUP_TITLES[group])}</h3>
              <ul>
                {pages
                  .filter((p) => p.group === group)
                  .map((p) => (
                    <li key={p.id}>
                      <Link
                        to={p.href}
                        replace
                        className="settings-nav__item"
                        aria-current={p.id === current ? 'page' : undefined}
                        {...(setupAttention(setup, p.id) && {
                          'data-attention': true,
                          title: t('onboarding.settingsPending'),
                        })}
                        {...(p.id === 'updates' &&
                          update && {
                            'data-update': true,
                            title: t('updates.navAvailable', { version: update.version }),
                          })}
                      >
                        <Icon name={p.icon} size={16} />
                        <span className="settings-nav__label">{t(p.title)}</span>
                        {p.id === 'members' && members != null && (
                          <span className="settings-nav__count">{members}</span>
                        )}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </SettingsSearch>
      <footer className="settings-nav__footer">
        <span>
          Inkadra {version}
          {instance?.name && ` · ${instance.name}`}
        </span>
        {update && (
          <Link to="/settings?section=updates" replace className="settings-nav__update">
            {t('updates.navAvailable', { version: update.version })}
          </Link>
        )}
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

/**
 * Content of one settings page inside the window: the page's one-line description and its
 * actions, then a single column of setting groups. The title lives in the window header.
 */
export function SettingsShell({
  page,
  actions,
  children,
}: {
  page?: SettingsPage;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const current = page ?? settingsSection(location.pathname, location.search);
  // The server page says what its view shows: plain words, or every part.
  const serverView = useServerView();
  const lead =
    current.id === 'server' && serverView === 'simple'
      ? 'settingsUi.leads.serverSimple'
      : current.lead;
  // Each page starts from the neutral "saved automatically" message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on page change only.
  useEffect(() => resetSaveState(), [current.id]);
  return (
    <div className="settings-page">
      <div className="settings-page__intro">
        <p className="settings__lead">{t(lead)}</p>
        {actions && <div className="settings-page__actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
