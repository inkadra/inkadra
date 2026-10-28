export type SettingsGroup = 'personal' | 'workspace' | 'instance';

export interface SettingsPage {
  id: string;
  group: SettingsGroup;
  href: string;
  /** Translation key of the navigation label and page heading. */
  title: string;
  lead: string;
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
    admin: false,
  },
  {
    id: 'preferences',
    group: 'personal',
    href: '/settings?section=preferences',
    title: 'admin.preferences',
    lead: 'settingsUi.leads.preferences',
    admin: false,
  },
  {
    id: 'notifications',
    group: 'personal',
    href: '/settings?section=notifications',
    title: 'admin.notifications',
    lead: 'settingsUi.leads.notifications',
    admin: false,
  },
  {
    id: 'members',
    group: 'workspace',
    href: '/settings/team',
    title: 'admin.members',
    lead: 'admin.teamHelp',
    admin: true,
  },
  {
    id: 'workspace',
    group: 'workspace',
    href: '/settings?section=workspace',
    title: 'admin.storage',
    lead: 'settingsUi.leads.storage',
    admin: true,
  },
  {
    id: 'classifications',
    group: 'workspace',
    href: '/settings?section=classifications',
    title: 'admin.classifications',
    lead: 'catalogs.scope',
    admin: true,
  },
  {
    id: 'providers',
    group: 'instance',
    href: '/settings?section=providers',
    title: 'settingsUi.pages.access',
    lead: 'settingsUi.leads.access',
    admin: true,
  },
  {
    id: 'registration',
    group: 'instance',
    href: '/settings?section=registration',
    title: 'admin.registration',
    lead: 'settingsUi.leads.registration',
    admin: true,
  },
  {
    id: 'instance',
    group: 'instance',
    href: '/settings?section=instance',
    title: 'settingsUi.pages.about',
    lead: 'settingsUi.leads.about',
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
