import type {
  ClassificationCatalogs,
  FeedbackReport,
  InstanceMember,
  Invitation,
} from '@inkadra/shared';
import { Avatar, Icon, KeyCap } from '@inkadra/ui';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.ts';
import { useIsPhone } from '../lib/phone.ts';
import { usePreferences } from '../lib/preferences.ts';
import { useSession } from '../lib/session.tsx';
import { toursFor } from '../tutorial/tours.ts';
import {
  findWord,
  NO_DATA,
  RESULT_GROUPS,
  type ResultGroup,
  type SettingsData,
  searchData,
  searchSettings,
} from './settings-search.ts';
import { SETTINGS_PAGES } from './settings-sections.ts';

const GROUP_LABELS: Record<ResultGroup, string> = {
  people: 'settingsUi.find.people',
  settings: 'settingsUi.find.settings',
  classifications: 'admin.classifications',
  reports: 'feedback.received',
  tours: 'settingsUi.find.tours',
};
/** The page a group's results open, named on its heading when it differs from the group. */
const GROUP_PAGES: Partial<Record<ResultGroup, string>> = {
  people: 'admin.members',
  tours: 'settingsUi.pages.help',
};

const loaded = new Map<string, Promise<SettingsData>>();

/**
 * The data an administrator's search reads, from the endpoints its pages already call: once
 * per person and session, so typing never waits on the network twice. Members never call it:
 * every one of these endpoints is for administrators.
 */
function loadData(userId: string): Promise<SettingsData> {
  let data = loaded.get(userId);
  if (!data) {
    data = Promise.all([
      api
        .get<{ items: InstanceMember[] }>('/instance/members')
        .then((r) => r.items)
        .catch(() => []),
      api
        .get<{ items: Invitation[] }>('/invitations')
        .then((r) => r.items.filter((i) => i.projectId === null && i.boardId === null))
        .catch(() => []),
      api.get<ClassificationCatalogs>('/instance/classifications').catch(() => null),
      api
        .get<{ items: FeedbackReport[] }>('/feedback/reports')
        .then((r) => r.items)
        .catch(() => []),
    ]).then(([members, invitations, classifications, reports]) => ({
      members,
      invitations,
      classifications,
      reports,
    }));
    loaded.set(userId, data);
  }
  return data;
}

/** Tests start from an empty session. */
export function forgetSettingsData() {
  loaded.clear();
}

/** The text with the word the query found marked. */
function Marked({ text, query }: { text: string; query: string }) {
  const at = findWord(text, query);
  if (!at) return text;
  return (
    <>
      {text.slice(0, at[0])}
      <mark className="settings-find__mark">{text.slice(...at)}</mark>
      {text.slice(at[1])}
    </>
  );
}

/**
 * The settings search (combobox): every setting is a result of its own, then the people,
 * classification values, received reports and tours it finds, grouped. Opening one goes to its
 * page, which scrolls to the row (`useRevealAnchor`). Arrows move, Enter opens, Escape clears
 * the text and, once empty, closes the window. Without text it shows `children`.
 */
export function SettingsSearch({
  onClose,
  replace = true,
  children,
}: {
  onClose?: () => void;
  /** The desktop window replaces its history entry; the phone list pushes one, to come back. */
  replace?: boolean;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { user, instance } = useSession();
  const { modulesOff } = usePreferences();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const listId = useId();
  const [query, setQuery] = useState('');
  // The data is matched a moment after typing stops, and loaded on the first search.
  const [settled, setSettled] = useState('');
  const [data, setData] = useState<SettingsData>(NO_DATA);
  const [active, setActive] = useState(0);
  const admin = user?.role === 'admin';
  const userId = user?.id;
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(query), 150);
    return () => window.clearTimeout(timer);
  }, [query]);
  const wanted = admin && !!userId && settled.trim() !== '';
  useEffect(() => {
    if (!wanted || !userId) return;
    let alive = true;
    void loadData(userId).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [wanted, userId]);

  const searching = query.trim() !== '';
  const pages = SETTINGS_PAGES.filter((p) => !p.admin || admin);
  const found = [
    ...searchSettings(pages, query, t, i18n.languages, i18n.language),
    ...searchData(
      admin ? data : NO_DATA,
      toursFor(admin, !!instance?.demo, modulesOff),
      pages,
      settled,
      t,
    ),
  ];
  const results = RESULT_GROUPS.flatMap((group) => found.filter((r) => r.group === group));
  const current = Math.min(active, results.length - 1);
  const optionId = (index: number) => `${listId}-${index}`;
  useEffect(() => {
    if (current >= 0) document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
  });

  const open = (index: number) => {
    const result = results[index];
    if (result) navigate(result.href, { replace });
  };

  return (
    <>
      <label className="settings-nav__search">
        <Icon name="search" size={14} />
        <input
          className="ink-input"
          type="search"
          role="combobox"
          aria-label={t('settingsUi.search')}
          aria-expanded={searching}
          aria-controls={searching && results.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={searching && current >= 0 ? optionId(current) : undefined}
          placeholder={t('settingsUi.search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // A search field clears itself on Escape and swallows it: clear here, and close
              // the window once there is nothing left to clear.
              if (query) setQuery('');
              else if (onClose) onClose();
              else return;
              e.preventDefault();
            } else if (!searching) return;
            else if (e.key === 'ArrowDown') setActive(Math.min(results.length - 1, current + 1));
            else if (e.key === 'ArrowUp') setActive(Math.max(0, current - 1));
            else if (e.key === 'Enter') open(current);
            else return;
            e.preventDefault();
          }}
        />
      </label>
      {!searching ? (
        children
      ) : (
        <div className="settings-nav__groups settings-find">
          {results.length === 0 ? (
            <p className="settings-nav__empty" role="status">
              {t('settingsUi.noResults')}
            </p>
          ) : (
            <div id={listId} role="listbox" aria-label={t('settingsUi.find.results')}>
              {RESULT_GROUPS.map((group) => {
                const items = results.filter((r) => r.group === group);
                const where = GROUP_PAGES[group];
                return (
                  items.length > 0 && (
                    // biome-ignore lint/a11y/useSemanticElements: a listbox may only own options and ARIA groups.
                    <div
                      key={group}
                      role="group"
                      aria-label={t(GROUP_LABELS[group])}
                      className="settings-find__group"
                    >
                      <p aria-hidden="true" className="settings-find__heading">
                        <span>{t(GROUP_LABELS[group])}</span>
                        {where && <span>{t(where)}</span>}
                      </p>
                      {items.map((r) => {
                        const index = results.indexOf(r);
                        return (
                          <button
                            key={r.key}
                            id={optionId(index)}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={index === current}
                            className="settings-find__item"
                            onPointerDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => open(index)}
                          >
                            <span className="settings-find__icon">
                              {r.person ? (
                                <Avatar name={r.person.name} image={r.person.image} size={20} />
                              ) : (
                                <Icon name={r.icon} size={16} />
                              )}
                            </span>
                            <span className="settings-find__text">
                              <span className="settings-find__label">
                                <Marked text={r.label} query={query} />
                              </span>
                              <span className="settings-find__sub">
                                <Marked text={r.sub} query={query} />
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )
                );
              })}
            </div>
          )}
          {!phone && results.length > 0 && (
            <p className="settings-find__keys" aria-hidden="true">
              <span>
                <KeyCap>↑↓</KeyCap> {t('settingsUi.find.move')}
              </span>
              <span>
                <KeyCap>{t('settingsUi.find.enter')}</KeyCap> {t('settingsUi.find.open')}
              </span>
            </p>
          )}
        </div>
      )}
    </>
  );
}
