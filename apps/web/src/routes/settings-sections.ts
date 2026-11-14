import { MODULE_IDS, SHOT_CATALOG_KEYS } from '@inkadra/shared';
import type { IconName } from '@inkadra/ui';

export type SettingsGroup = 'personal' | 'workspace' | 'server';

export interface SettingsPage {
  id: string;
  group: SettingsGroup;
  href: string;
  /** Translation key of the navigation label and page heading. */
  title: string;
  lead: string;
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
  page('audit', 'workspace', 'eye', 'audit.title'),
  page('instance', 'server', 'home', 'settingsUi.pages.general'),
  page('workspace', 'server', 'disk', 'admin.storage', 'settingsUi.leads.storage'),
  page('video', 'server', 'film', 'settingsUi.pages.video'),
  page('backups', 'server', 'clock', 'backups.title'),
  page('server', 'server', 'tiles', 'settingsUi.pages.server'),
  page('updates', 'server', 'upload', 'settingsUi.pages.updates'),
];

/**
 * One setting the search finds: a row (or a card) of a settings page. The id is also the row's
 * `data-setting` anchor (`anchor` on `Row`, `Card` and `Summary`), so opening the result can
 * scroll to it; a test fails when no component carries it.
 */
export interface SettingEntry {
  /** `<page id>.<name>`: the page it is on, and the row's anchor. */
  id: string;
  /** Translation key of the label the row shows: the search reads the interface's own words. */
  label: string;
  /** Other texts of the row that find it (its options, its card), as translation keys. */
  also?: string[];
  /** Words that are the same in every language (2FA, SMTP). */
  terms?: string[];
}

const s = (id: string, label: string, also?: string[], terms?: string[]): SettingEntry => ({
  id,
  label,
  also,
  terms,
});

/** Every searchable setting, page by page in navigation order. */
export const SETTINGS: SettingEntry[] = [
  s('account.photo', 'settingsUi.account.photo'),
  s('account.name', 'auth.name'),
  s('account.email', 'auth.email'),
  s('account.password', 'admin.password', ['settings.password.change']),
  s('account.twoFactor', 'settings.twoFactor.title', [], ['2FA', 'TOTP']),
  s('account.methods', 'settings.methods.title'),
  s('account.sessions', 'settings.sessions.title'),
  s('account.space', 'storageSpace.title', ['storageSpace.largestTitle']),
  s('account.delete', 'settings.delete.title'),
  s('preferences.theme', 'admin.theme', ['admin.themes.dark', 'admin.themes.light']),
  s('preferences.language', 'settings.profile.language'),
  s('preferences.dateFormat', 'settingsUi.preferences.dateFormat'),
  s('preferences.timeFormat', 'settingsUi.preferences.timeFormat'),
  s('board.dotGrid', 'settingsUi.preferences.dotGrid'),
  s('board.snapToGrid', 'settingsUi.preferences.snap'),
  s('board.doubleClickNote', 'settingsUi.preferences.doubleClick'),
  s('board.keepAroundContent', 'settingsUi.preferences.keepAround'),
  s('board.undoButtons', 'settingsUi.preferences.undoButtons'),
  s('board.keepPlaying', 'settingsUi.preferences.keepPlaying'),
  s('board.toolbar', 'settingsUi.pages.toolbar', ['settingsUi.toolbar.more']),
  s('board.toolbarReset', 'settingsUi.toolbar.reset'),
  ...['board', ...MODULE_IDS].map((id) => s(`modules.${id}`, `modules.names.${id}`)),
  s('notifications.what', 'settingsUi.notifications.what', ['settingsUi.notifications.inbox']),
  s('notifications.frequency', 'settingsUi.notifications.frequency', [
    'settingsUi.notifications.short.daily',
  ]),
  s('notifications.releaseNews', 'settingsUi.notifications.releaseNews'),
  s('apps.calendar', 'calendar.link', ['calendar.title']),
  s('apps.clipper', 'settingsUi.apps.clipper', ['settings.tokens.clipper.title']),
  s('apps.tokens', 'settings.tokens.title'),
  s('tutorials.welcome', 'tutorial.settings.welcomeTitle'),
  s('tutorials.hints', 'tutorial.settings.hints'),
  s('tutorials.reset', 'tutorial.settings.reset'),
  s('tutorials.report', 'feedback.title'),
  s('members.invite', 'settingsUi.members.invite', ['admin.linkInvite']),
  s('members.list', 'admin.members', ['admin.role']),
  s('members.invitations', 'settingsUi.members.invitations'),
  s('access.registration', 'settingsUi.registration.label', [
    'admin.registration',
    'admin.registrationModes.open',
    'admin.registrationModes.invite',
    'admin.registrationModes.closed',
  ]),
  s('access.projectCreation', 'projectCreation.settings.label'),
  s('access.calendar', 'calendar.admin'),
  s('access.adminTwoFactor', 'admin.requireAdminTwoFactor', [], ['2FA']),
  s('access.methods', 'settings.methods.title', [], ['Google', 'OIDC', 'SSO']),
  s('access.email', 'settingsUi.access.email', [], ['SMTP']),
  ...['projectTypes', 'tags', ...SHOT_CATALOG_KEYS].map((key) =>
    s(`classifications.${key}`, `catalogs.${key}`),
  ),
  s('reports.settings', 'feedback.settingsTitle'),
  s('reports.destination', 'feedback.destination'),
  s('reports.repository', 'feedback.repository', [], ['GitHub']),
  s('reports.token', 'feedback.token'),
  s('reports.allowGuests', 'feedback.allowGuests'),
  s('reports.retention', 'feedback.retention'),
  s('reports.received', 'feedback.received'),
  s('audit.filter', 'audit.filter', ['audit.title']),
  s('audit.events', 'audit.events', [
    'audit.groups.members',
    'audit.groups.sharing',
    'audit.groups.security',
  ]),
  s('instance.setup', 'settingsUi.general.setup'),
  s('instance.name', 'admin.instanceName'),
  s('instance.url', 'settingsUi.about.url'),
  s('instance.version', 'settingsUi.about.version'),
  s('workspace.used', 'settingsUi.storage.used'),
  s('workspace.limits', 'storageLimits.title'),
  s('workspace.total', 'storageLimits.total'),
  s('workspace.perUser', 'storageLimits.perUser'),
  s('workspace.largestFile', 'storageLimits.largestFile'),
  s('workspace.warn', 'storageLimits.warn'),
  s('workspace.usage', 'settingsUi.storage.usage', ['settingsUi.storage.by.project']),
  // Its rows are `workspace.byUser:<user id>`: the search finds each person's space too.
  s('workspace.byUser', 'admin.storageCharts.byUser', ['settingsUi.storage.by.user']),
  s('video.encoder', 'videoSettings.encoding.encoder', [], ['NVENC', 'Quick Sync', 'VAAPI', 'AV1']),
  s('video.quality', 'videoSettings.quality.title', [
    'videoSettings.quality.light',
    'videoSettings.quality.balanced',
    'videoSettings.quality.high',
  ]),
  s('video.renditions', 'videoSettings.rungs.title', [], ['480p', '720p', '1080p', '4K']),
  s('video.playable', 'videoSettings.playable.label', ['videoSettings.examples.title']),
  s('video.live', 'videoSettings.live.title', [
    'videoSettings.live.enabled',
    'videoSettings.live.modes.live',
  ]),
  s('video.existing', 'videoSettings.existing.title', ['videoSettings.existing.regenerate']),
  s(
    'video.advanced',
    'videoSettings.advanced.title',
    [
      'videoSettings.advanced.rerun',
      'videoSettings.advanced.sessions',
      'videoSettings.advanced.target',
      'videoSettings.advanced.peak',
    ],
    ['CRF', 'CQ', 'global_quality', 'bitrate'],
  ),
  s('backups.now', 'backups.now'),
  s('backups.nightly', 'backups.nightly'),
  s('backups.time', 'backups.time'),
  s('backups.keep', 'backups.keep'),
  s('backups.history', 'backups.history'),
  s('server.health', 'server.how.title'),
  s('server.people', 'server.people.title'),
  s('server.problems', 'server.problems.title'),
  s('server.alerts', 'server.alerts.enabled', ['server.alerts.title']),
  s('server.alertsHow', 'server.alerts.how'),
  s('server.admin', 'server.admin.title'),
  s('updates.notify', 'updates.notify'),
  s('updates.channel', 'updates.channel'),
  s('updates.releaseNews', 'settingsUi.notifications.releaseNews'),
  s('updates.earlier', 'updates.earlier'),
  s('updates.how', 'settingsUi.updates.how'),
];

/** The page a setting is on. */
export function settingPage(entry: SettingEntry): SettingsPage {
  const id = entry.id.slice(0, entry.id.indexOf('.'));
  return SETTINGS_PAGES.find((p) => p.id === id) as SettingsPage;
}

/** The search parameter that names the row a page scrolls to and highlights on opening. */
export const ANCHOR_PARAM = 'setting';

/** The address of a page that opens on one of its rows. */
export function anchorHref(page: SettingsPage, anchor: string): string {
  return `${page.href}${page.href.includes('?') ? '&' : '?'}${ANCHOR_PARAM}=${encodeURIComponent(anchor)}`;
}

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
