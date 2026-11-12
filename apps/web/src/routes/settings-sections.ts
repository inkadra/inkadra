import type { IconName } from '@inkadra/ui';

export type SettingsGroup = 'personal' | 'workspace' | 'server';

export interface SettingsPage {
  id: string;
  group: SettingsGroup;
  href: string;
  /** Translation key of the navigation label and page heading. */
  title: string;
  lead: string;
  /** Translation key of the settings on the page, comma-separated, for the search. */
  keywords: string;
  admin: boolean;
  /** One icon per page, in the navigation (decision 0124). */
  icon: IconName;
}

const page = (
  id: string,
  group: SettingsGroup,
  icon: IconName,
  title: string,
  lead = `settingsUi.leads.${id}`,
): SettingsPage => ({
  id,
  group,
  icon,
  href: id === 'members' ? '/settings/team' : `/settings?section=${id}`,
  title,
  lead,
  keywords: `settingsUi.keywords.${id}`,
  admin: group !== 'personal',
});

/**
 * Every settings page in navigation order (decision 0124). Ids that survived the redesign keep
 * their URL; `preferences` is "Appearance and language", `instance` "General", `workspace`
 * "Storage" and `tutorials` "Help and tutorials".
 */
export const SETTINGS_PAGES: SettingsPage[] = [
  page('account', 'personal', 'user', 'admin.account'),
  page('preferences', 'personal', 'sun', 'settingsUi.pages.appearance'),
  page('board', 'personal', 'board', 'settingsUi.pages.board'),
  page('modules', 'personal', 'layers', 'settingsUi.pages.modules'),
  page('notifications', 'personal', 'bell', 'admin.notifications'),
  page('apps', 'personal', 'link', 'settingsUi.pages.apps'),
  page('tutorials', 'personal', 'play', 'settingsUi.pages.help'),
  page('members', 'workspace', 'people', 'admin.members', 'admin.teamHelp'),
  page('access', 'workspace', 'lock', 'settingsUi.pages.access'),
  page('classifications', 'workspace', 'tag', 'admin.classifications', 'catalogs.scope'),
  page('reports', 'workspace', 'report', 'settingsUi.pages.reports'),
  page('instance', 'server', 'home', 'settingsUi.pages.general'),
  page('workspace', 'server', 'archive', 'admin.storage', 'settingsUi.leads.storage'),
  page('backups', 'server', 'clock', 'backups.title'),
  page('server', 'server', 'tiles', 'settingsUi.pages.server'),
  page('updates', 'server', 'upload', 'settingsUi.pages.updates'),
];

export const GROUP_TITLES: Record<SettingsGroup, string> = {
  personal: 'admin.personal',
  workspace: 'settingsUi.groups.workspace',
  server: 'settingsUi.groups.server',
};

/**
 * Which page fixes a failing check of the instance checklist (decision 0124): the navigation
 * dot, the phone list and the "Configure" button of General follow it.
 */
export const CHECK_PAGES: Record<string, string> = {
  providers: 'access',
  smtp: 'access',
  storage: 'workspace',
  domain: 'server',
};

/** Pages that left in the redesign (decision 0124) open the page that took their content. */
export const MOVED_SECTIONS: Record<string, string> = {
  toolbar: 'board',
  providers: 'access',
  registration: 'access',
};

const ACCOUNT = SETTINGS_PAGES[0] as SettingsPage;

/** Shared identity for the page heading, the navigation and the global settings breadcrumb. */
export function settingsSection(pathname: string, search: string): SettingsPage {
  const team = pathname === '/settings/team';
  const asked = team ? 'members' : new URLSearchParams(search).get('section');
  const section = (asked && MOVED_SECTIONS[asked]) ?? asked;
  return SETTINGS_PAGES.find((p) => p.id === section && (p.id === 'members') === team) ?? ACCOUNT;
}

/** Settings open as a window over the page underneath; these are the URLs that open it. */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname === '/settings/team';
}

/** Pages whose changes save themselves; the window header reports their progress. */
export function autosaves(id: string): boolean {
  return id !== 'classifications';
}

/** Plain `/settings` is the phone settings home; every page has an explicit section. */
export function isSettingsHome(pathname: string, search: string): boolean {
  return pathname === '/settings' && !new URLSearchParams(search).get('section');
}

export interface SettingsMatch {
  page: SettingsPage;
  /** The setting that matched, when the page matched through one rather than its title. */
  setting: string | null;
}

/**
 * Lower case without accents or typographic apostrophes, so "verifica" finds "Verifica" and
 * "dell'istanza" finds "dell’istanza".
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2018\u2019]/g, "'")
    .toLocaleLowerCase();
}

/** Looks up a translation, in the interface language or in the one given. */
export type SettingsTranslate = (key: string, options?: { lng: string }) => string;

/**
 * The pages a settings search finds: by title, description and group, or by one of the
 * settings on the page (password, 2FA, theme, invitations…), which is then named. Every
 * language in `languages` is searched, so "theme" finds the theme with the interface in
 * Italian; what is shown stays in the interface language. The app passes the languages it has
 * loaded (the interface one and English): the others are files nobody has downloaded. The keyword lists of all languages
 * name the same settings in the same order (a test checks this).
 */
export function matchSettings(
  pages: SettingsPage[],
  query: string,
  t: SettingsTranslate,
  languages: readonly string[] = [],
): SettingsMatch[] {
  const needle = fold(query.trim());
  if (!needle) return pages.map((page) => ({ page, setting: null }));
  const variants = (key: string) => [t(key), ...languages.map((lng) => t(key, { lng }))];
  const list = (text: string) => text.split(',').map((k) => k.trim());
  return pages.flatMap((page): SettingsMatch[] => {
    const heading = [page.title, page.lead, GROUP_TITLES[page.group]].flatMap(variants);
    if (heading.some((text) => fold(text).includes(needle))) return [{ page, setting: null }];
    const shown = list(t(page.keywords));
    const index = variants(page.keywords)
      .map((text) => list(text).findIndex((k) => k && fold(k).includes(needle)))
      .find((i) => i >= 0);
    const setting = index === undefined ? undefined : shown[index];
    return setting ? [{ page, setting }] : [];
  });
}
