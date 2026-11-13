import i18next from 'i18next';
import { expect, it } from 'vitest';
import en from '../i18n/en.json';
import itLocale from '../i18n/it.json';
import {
  autosaves,
  GROUP_TITLES,
  isSettingsHome,
  isSettingsPath,
  SETTINGS_PAGES,
  settingsSection,
} from './settings-sections.ts';

it('identifies all settings pages and localizes headings, descriptions and groups in both languages', async () => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en }, it: { translation: itLocale } },
  });
  for (const language of ['en', 'it']) {
    await i18n.changeLanguage(language);
    for (const section of [
      'account',
      'preferences',
      'board',
      'modules',
      'notifications',
      'apps',
      'tutorials',
      'members',
      'access',
      'classifications',
      'reports',
      'instance',
      'workspace',
      'video',
      'backups',
      'server',
      'updates',
    ]) {
      const pathname = section === 'members' ? '/settings/team' : '/settings';
      const search = `?unrelated=yes&section=${section}`;
      const page = settingsSection(pathname, search);
      expect(page.id).toBe(section);
      expect(i18n.exists(page.title)).toBe(true);
      expect(i18n.exists(page.lead)).toBe(true);
      expect(i18n.exists(GROUP_TITLES[page.group])).toBe(true);
      if (section !== 'account') expect(page.title).not.toBe('settings.title');
      expect(isSettingsPath(pathname)).toBe(true);
    }
  }
  expect(settingsSection('/settings', '?section=unknown').id).toBe('account');
  expect(settingsSection('/settings', '?section=members').id).toBe('account');
  expect(isSettingsHome('/settings', '')).toBe(true);
  expect(isSettingsHome('/settings', '?section=account')).toBe(false);
  expect(isSettingsHome('/settings/team', '')).toBe(false);
  for (const path of ['/', '/projects', '/settings-old', '/p/settings', '/settings/teams'])
    expect(isSettingsPath(path)).toBe(false);
  expect(autosaves('account')).toBe(true);
  expect(autosaves('workspace')).toBe(true);
  expect(autosaves('access')).toBe(true);
  expect(autosaves('classifications')).toBe(false);
});

it('opens the page that took the content of a page that left in the redesign (0124)', () => {
  expect(settingsSection('/settings', '?section=toolbar').id).toBe('board');
  expect(settingsSection('/settings', '?section=providers').id).toBe('access');
  expect(settingsSection('/settings', '?section=registration').id).toBe('access');
  // Surviving pages keep their address.
  for (const id of ['preferences', 'instance', 'workspace', 'tutorials', 'server'])
    expect(settingsSection('/settings', `?section=${id}`).id).toBe(id);
  expect(SETTINGS_PAGES.map((p) => p.group)).toEqual([
    ...Array(7).fill('personal'),
    ...Array(4).fill('workspace'),
    // Video joined the Server group (decision 0128): seventeen pages.
    ...Array(6).fill('server'),
  ]);
  // One icon per page.
  expect(new Set(SETTINGS_PAGES.map((p) => p.icon)).size).toBe(SETTINGS_PAGES.length);
});
