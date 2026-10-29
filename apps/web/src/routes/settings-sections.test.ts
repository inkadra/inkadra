import i18next from 'i18next';
import { expect, it } from 'vitest';
import en from '../i18n/en.json';
import itLocale from '../i18n/it.json';
import {
  autosaves,
  GROUP_TITLES,
  isSettingsHome,
  isSettingsPath,
  matchSettings,
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
      'notifications',
      'workspace',
      'classifications',
      'instance',
      'providers',
      'registration',
      'members',
    ]) {
      const pathname = section === 'members' ? '/settings/team' : '/settings';
      const search = `?unrelated=yes&section=${section}`;
      const page = settingsSection(pathname, search);
      expect(page.id).toBe(section);
      expect(i18n.exists(page.title)).toBe(true);
      expect(i18n.exists(page.lead)).toBe(true);
      expect(i18n.exists(page.keywords)).toBe(true);
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
  expect(autosaves('workspace')).toBe(false);
  expect(autosaves('providers')).toBe(false);
});

it('finds pages by the settings on them, naming the setting, in both languages', async () => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en }, it: { translation: itLocale } },
  });
  const t = (key: string) => i18n.t(key);
  const found = (query: string) =>
    matchSettings(SETTINGS_PAGES, query, t).map((m) => [m.page.id, m.setting]);
  // These used to find nothing: only titles and descriptions were searched.
  expect(found('password')).toContainEqual(['account', 'Password']);
  expect(found('2FA')).toEqual([['account', 'Two-step verification (2FA)']]);
  expect(found('theme')).toEqual([['preferences', 'Theme']]);
  expect(found('language')).toEqual([['preferences', 'Language']]);
  expect(found('invite')).toContainEqual(['members', 'Invite members']);
  expect(found('sessions')).toEqual([['account', 'Sessions']]);
  // A title match lists the page without naming a setting.
  expect(found('registration')).toContainEqual(['registration', null]);
  expect(found('nothing like this')).toEqual([]);
  expect(matchSettings(SETTINGS_PAGES, '  ', t)).toHaveLength(SETTINGS_PAGES.length);

  await i18n.changeLanguage('it');
  expect(found('password')).toContainEqual(['account', 'Password']);
  expect(found('2fa')).toEqual([['account', 'Verifica in due passaggi (2FA)']]);
  expect(found('tema')).toEqual([['preferences', 'Tema']]);
  expect(found('lingua')).toEqual([['preferences', 'Lingua']]);
  expect(found('invito')).toContainEqual(['members', 'Link di invito']);
  expect(found('elimina')).toEqual([['account', 'Elimina account']]);
  // Neither case nor accents matter.
  expect(found('TEMA')).toEqual([['preferences', 'Tema']]);
  expect(found('nome dell’istànza')).toEqual([['instance', 'Nome dell’istanza']]);
  // Nor which apostrophe: keyboards type ' where the texts use ’.
  expect(found("nome dell'istanza")).toEqual([['instance', 'Nome dell’istanza']]);
});
