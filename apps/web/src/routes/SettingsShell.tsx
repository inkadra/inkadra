import { Icon, type IconName } from '@inkadra/ui';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { useSession } from '../lib/session.tsx';
import { resetSaveState, type SaveState, useSaveState } from './settings-save.ts';
import {
  GROUP_TITLES,
  SETTINGS_PAGES,
  type SettingsGroup,
  type SettingsPage,
  settingsSection,
} from './settings-sections.ts';
import './settings.css';

type Setup = { checks: Array<{ id: string; ok: boolean }> | null; error: boolean };

const SECTION_ICONS: Record<string, IconName> = {
  account: 'user',
  preferences: 'settings',
  notifications: 'bell',
  members: 'people',
  workspace: 'archive',
  classifications: 'tag',
  providers: 'lock',
  registration: 'mail',
  instance: 'settings',
};

/** Which page the instance checklist sends an admin to when a check fails. */
export function setupAttention(setup: Setup, page: string): boolean {
  const failing = (ids: string[]) => setup.checks?.some((c) => ids.includes(c.id) && !c.ok);
  if (page === 'providers') return !!failing(['providers', 'smtp']);
  if (page === 'instance') return setup.error || !!failing(['storage', 'domain']);
  return false;
}

/**
 * The settings window's own navigation: a search that narrows the pages, then the pages
 * the person may open, grouped. Moving between pages replaces the history entry, so the
 * browser's Back closes the window instead of walking through every page visited.
 */
export function SettingsNav({
  setup,
  members,
}: {
  setup: Setup;
  members?: number | null;
}) {
  const { t } = useTranslation();
  const { user, instance } = useSession();
  const { pathname, search } = useLocation();
  const [query, setQuery] = useState('');
  const current = settingsSection(pathname, search).id;
  const needle = query.trim().toLocaleLowerCase();
  const pages = SETTINGS_PAGES.filter(
    (p) =>
      (!p.admin || user?.role === 'admin') &&
      (!needle ||
        `${t(p.title)} ${t(p.lead)} ${t(GROUP_TITLES[p.group])}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
  const groups = [...new Set(pages.map((p) => p.group))] as SettingsGroup[];
  return (
    <nav className="settings-nav" aria-label={t('nav.settings')}>
      <label className="settings-nav__search">
        <Icon name="search" size={14} />
        <input
          className="ink-input"
          type="search"
          aria-label={t('settingsUi.search')}
          placeholder={t('settingsUi.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
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
                    >
                      <Icon name={SECTION_ICONS[p.id] ?? 'settings'} size={16} />
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
        {pages.length === 0 && (
          <p className="settings-nav__empty" role="status">
            {t('settingsUi.noResults')}
          </p>
        )}
      </div>
      <footer className="settings-nav__footer">
        <span>
          Inkadra {instance?.version}
          {instance?.name && ` · ${instance.name}`}
        </span>
        <DiagnosticsLink>{t('settingsUi.diagnostics')}</DiagnosticsLink>
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
  // Each page starts from the neutral "saved automatically" message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on page change only.
  useEffect(() => resetSaveState(), [current.id]);
  return (
    <div className="settings-page">
      <div className="settings-page__intro">
        <p className="settings__lead">{t(current.lead)}</p>
        {actions && <div className="settings-page__actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** How the settings window opens Diagnostics, so it can keep its place in the history. */
export const DiagnosticsContext = createContext<(() => void) | undefined>(undefined);

/** A link to Diagnostics that goes through the settings window when there is one. */
export function DiagnosticsLink({ className, children }: { className?: string; children: ReactNode }) {
  const onDiagnostics = useContext(DiagnosticsContext);
  return (
    <Link
      className={className}
      to="/diagnostics"
      replace={!!onDiagnostics}
      onClick={(event) => {
        if (
          onDiagnostics &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        ) {
          event.preventDefault();
          onDiagnostics();
        }
      }}
    >
      {children}
    </Link>
  );
}
