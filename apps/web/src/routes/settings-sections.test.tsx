import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import en from '../i18n/en.json';
import itLocale from '../i18n/it.json';
import { SettingsBreadcrumb } from './SettingsBreadcrumb.tsx';
import { settingsSection } from './settings-sections.ts';

it('identifies all settings pages and localizes headings, descriptions and breadcrumbs in both languages', async () => {
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
      'instance',
      'providers',
      'members',
    ]) {
      const pathname = section === 'members' ? '/settings/team' : '/settings';
      const search = `?unrelated=yes&section=${section}`;
      const page = settingsSection(pathname, search);
      expect(page.id).toBe(section);
      expect(i18n.exists(page.title)).toBe(true);
      expect(i18n.exists(page.lead)).toBe(true);
      if (section !== 'account') expect(page.title).not.toBe('settings.title');
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <SettingsBreadcrumb pathname={pathname} search={search} />
          </MemoryRouter>
        </I18nextProvider>,
      );
      expect(html).toContain(i18n.t(page.title));
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('href="/settings"');
    }
  }
  expect(settingsSection('/settings', '?section=unknown').id).toBe('account');
});
