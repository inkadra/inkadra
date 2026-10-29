export type SettingsGroup = 'personal' | 'workspace' | 'instance';

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
}

/** Every settings page in navigation order. URLs predate the redesign and stay stable. */
export const SETTINGS_PAGES: SettingsPage[] = [
  {
    id: 'account',
    group: 'personal',
    href: '/settings?section=account',
    title: 'admin.account',
    lead: 'settingsUi.leads.account',
    keywords: 'settingsUi.keywords.account',
    admin: false,
  },
  {
    id: 'preferences',
    group: 'personal',
    href: '/settings?section=preferences',
    title: 'admin.preferences',
    lead: 'settingsUi.leads.preferences',
    keywords: 'settingsUi.keywords.preferences',
    admin: false,
  },
  {
    id: 'notifications',
    group: 'personal',
    href: '/settings?section=notifications',
    title: 'admin.notifications',
    lead: 'settingsUi.leads.notifications',
    keywords: 'settingsUi.keywords.notifications',
    admin: false,
  },
  {
    id: 'members',
    group: 'workspace',
    href: '/settings/team',
    title: 'admin.members',
    lead: 'admin.teamHelp',
    keywords: 'settingsUi.keywords.members',
    admin: true,
  },
  {
    id: 'workspace',
    group: 'workspace',
    href: '/settings?section=workspace',
    title: 'admin.storage',
    lead: 'settingsUi.leads.storage',
    keywords: 'settingsUi.keywords.workspace',
    admin: true,
  },
  {
    id: 'classifications',
    group: 'workspace',
    href: '/settings?section=classifications',
    title: 'admin.classifications',
    lead: 'catalogs.scope',
    keywords: 'settingsUi.keywords.classifications',
    admin: true,
  },
  {
    id: 'providers',
    group: 'instance',
    href: '/settings?section=providers',
    title: 'settingsUi.pages.access',
    lead: 'settingsUi.leads.access',
    keywords: 'settingsUi.keywords.providers',
    admin: true,
  },
  {
    id: 'registration',
    group: 'instance',
    href: '/settings?section=registration',
    title: 'admin.registration',
    lead: 'settingsUi.leads.registration',
    keywords: 'settingsUi.keywords.registration',
    admin: true,
  },
  {
    id: 'instance',
    group: 'instance',
    href: '/settings?section=instance',
    title: 'settingsUi.pages.about',
    lead: 'settingsUi.leads.about',
    keywords: 'settingsUi.keywords.instance',
    admin: true,
  },
];

export const GROUP_TITLES: Record<SettingsGroup, string> = {
  personal: 'admin.personal',
  workspace: 'admin.workspace',
  instance: 'settingsUi.groups.instance',
};

const ACCOUNT = SETTINGS_PAGES[0] as SettingsPage;

/** Shared identity for the page heading, the navigation and the global settings breadcrumb. */
export function settingsSection(pathname: string, search: string): SettingsPage {
  const section =
    pathname === '/settings/team' ? 'members' : new URLSearchParams(search).get('section');
  return (
    SETTINGS_PAGES.find(
      (p) => p.id === section && (p.id === 'members') === (pathname === '/settings/team'),
    ) ?? ACCOUNT
  );
}

/** Settings open as a window over the page underneath; these are the URLs that open it. */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname === '/settings/team';
}

/** Pages whose changes save themselves; the window header reports their progress. */
export function autosaves(id: string): boolean {
  return id !== 'workspace' && id !== 'providers';
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
 * language in `languages` is searched, so "tema" finds the theme with the interface in
 * English; what is shown stays in the interface language. The keyword lists of all languages
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
