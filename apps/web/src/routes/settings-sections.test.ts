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
    ...Array(5).fill('server'),
  ]);
  // One icon per page.
  expect(new Set(SETTINGS_PAGES.map((p) => p.icon)).size).toBe(SETTINGS_PAGES.length);
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
  // These used to find nothing: only titles and descriptions were searched. Language is in
  // the title of Appearance and language, so that page is found without naming a setting.
  expect(found('password')).toContainEqual(['account', 'Password']);
  expect(found('2FA')).toEqual([['account', 'Two-step verification (2FA)']]);
  expect(found('theme')).toEqual([['preferences', 'Theme']]);
  expect(found('language')).toEqual([['preferences', null]]);
  expect(found('invite')).toContainEqual(['members', 'Invite members']);
  expect(found('sessions')).toEqual([['account', 'Sessions']]);
  // A title match lists the page without naming a setting.
  expect(found('registration')).toContainEqual(['access', 'Open registration']);
  expect(found('access and')).toEqual([['access', null]]);
  expect(found('nothing like this')).toEqual([]);
  expect(matchSettings(SETTINGS_PAGES, '  ', t)).toHaveLength(SETTINGS_PAGES.length);

  await i18n.changeLanguage('it');
  expect(found('password')).toContainEqual(['account', 'Password']);
  expect(found('2fa')).toEqual([['account', 'Verifica in due passaggi (2FA)']]);
  expect(found('tema')).toEqual([['preferences', 'Tema']]);
  expect(found('lingua')).toEqual([['preferences', null]]);
  expect(found('invito')).toContainEqual(['members', 'Link di invito']);
  expect(found('elimina')).toEqual([['account', 'Elimina account']]);
  // Neither case nor accents matter.
  expect(found('TEMA')).toEqual([['preferences', 'Tema']]);
  expect(found('indirizzo pubblìco')).toEqual([['instance', 'Indirizzo pubblico']]);
  // Nor which apostrophe: keyboards type ' where the texts use ’ (here in General's lead).
  expect(found("nome dell'istanza")).toEqual([['instance', null]]);
});

it('finds settings by the words of every language, naming them in the interface one', async () => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en }, it: { translation: itLocale } },
  });
  const t = (key: string, options?: { lng: string }) => i18n.t(key, options);
  const found = (query: string) =>
    matchSettings(SETTINGS_PAGES, query, t, ['it', 'en']).map((m) => [m.page.id, m.setting]);
  // With the interface in English these Italian words used to find nothing.
  expect(found('tema')).toEqual([['preferences', 'Theme']]);
  expect(found('lingua')).toEqual([['preferences', null]]);
  expect(found('invito')).toContainEqual(['members', 'Invitation link']);
  expect(found('elimina')).toEqual([['account', 'Delete account']]);
  expect(found('registrazione')).toContainEqual(['access', 'Open registration']);
  expect(found('password')).toContainEqual(['account', 'Password']);
  await i18n.changeLanguage('it');
  expect(found('theme')).toEqual([['preferences', 'Tema']]);
  expect(found('language')).toEqual([['preferences', null]]);
});

/** Each setting, [English, Italian]: search shows the keyword at the same index in the UI language. */
const KEYWORD_PAIRS: Record<string, [string, string][]> = {
  account: [
    ['Name', 'Nome'],
    ['Email', 'Email'],
    ['Profile photo', 'Foto profilo'],
    ['Password', 'Password'],
    ['Two-step verification (2FA)', 'Verifica in due passaggi (2FA)'],
    ['Backup codes', 'Codici di riserva'],
    ['Sign-in methods', 'Metodi di accesso'],
    ['Sessions', 'Sessioni'],
    ['Devices', 'Dispositivi'],
    ['Delete account', 'Elimina account'],
    ['Your space', 'Il tuo spazio'],
    ['Largest files', 'File più grandi'],
  ],
  preferences: [
    ['Theme', 'Tema'],
    ['Dark theme', 'Tema scuro'],
    ['Light theme', 'Tema chiaro'],
    ['Language', 'Lingua'],
    ['Date format', 'Formato data'],
    ['Time format', 'Formato ora'],
  ],
  board: [
    ['Dot grid', 'Griglia a punti'],
    ['Snap to grid', 'Aggancia alla griglia'],
    ['Double-click creates a note', 'Doppio clic crea una nota'],
    ['Keep the board around its content', 'Mantieni la board attorno al contenuto'],
    ['Undo and redo buttons', 'Pulsanti Annulla e Ripeti'],
    ['Continue playing videos off-screen', 'Continua a riprodurre i video fuori schermo'],
    ['Toolbar', 'Barra degli strumenti'],
    ['Tools', 'Strumenti'],
    ['More', 'Altro'],
    ['Column', 'Colonna'],
    ['Section heading', 'Titolo di sezione'],
    ['Colour', 'Colore'],
    ['Table', 'Tabella'],
    ['Voice note', 'Nota vocale'],
    ['Map', 'Mappa'],
    ['Frame', 'Inquadratura'],
    ['Set plan', 'Pianta del set'],
    ['Reset to default toolbar', 'Ripristina la barra predefinita'],
  ],
  notifications: [
    ['Email notifications', 'Notifiche email'],
    ['Mentions', 'Menzioni'],
    ['Replies', 'Risposte'],
    ['Reviews', 'Revisioni'],
    ['Daily digest', 'Riepilogo giornaliero'],
    ['Inbox', 'Inbox'],
    ['Comments on your cards', 'Commenti sulle tue card'],
  ],
  apps: [
    ['Your calendar link', 'Link del tuo calendario'],
    ['Browser extension', 'Estensione per il browser'],
    ['Inkadra Clipper for Chrome', 'Inkadra Clipper per Chrome'],
    ['Apps and tokens', 'App e token'],
  ],
  tutorials: [
    ['Welcome tour', 'Giro di benvenuto'],
    ['Hints the first time', 'Suggerimenti alla prima apertura'],
    ['Start over', 'Ricomincia da capo'],
    ['Report a problem', 'Segnala un problema'],
  ],
  members: [
    ['Invite members', 'Invita membri'],
    ['Invitations', 'Inviti'],
    ['Invitation link', 'Link di invito'],
    ['Role', 'Ruolo'],
    ['Administrators', 'Amministratori'],
    ['Deactivate account', 'Disattiva account'],
    ['Reactivate account', 'Riattiva account'],
    ['People', 'Persone'],
    ['Space', 'Spazio'],
    ['Space limit', 'Limite di spazio'],
  ],
  access: [
    ['New accounts', 'Nuovi account'],
    ['Open registration', 'Registrazione aperta'],
    ['Invitation only', 'Solo su invito'],
    ['Closed registration', 'Registrazione chiusa'],
    [
      'Require two-step verification for administrators',
      'Richiedi la verifica in due passaggi agli amministratori',
    ],
    ['Members can create projects', 'I membri possono creare progetti'],
    ['Calendar feeds', 'Feed del calendario'],
    ['Google', 'Google'],
    ['OIDC', 'OIDC'],
    ['Single sign-on (SSO)', 'Single sign-on (SSO)'],
    ['Email sign-in link', 'Link di accesso via email'],
    ['Email and password', 'Email e password'],
    ['SMTP', 'SMTP'],
    ['Outgoing email', 'Invio email'],
  ],
  classifications: [
    ['Project types', 'Tipi di progetto'],
    ['Tags', 'Tag'],
    ['Catalogs', 'Cataloghi'],
    ['Shot size', 'Campo'],
    ['Angle', 'Angolazione'],
    ['Movement', 'Movimento'],
  ],
  reports: [
    ['Reports', 'Segnalazioni'],
    ['Send to the Inkadra developers', 'Invia agli sviluppatori di Inkadra'],
    ['Destination', 'Destinazione'],
    ['Repository', 'Repository'],
    ['GitHub token', 'Token GitHub'],
    ['Guests can report', 'Gli ospiti possono segnalare'],
    ['Attachment retention', 'Conservazione degli allegati'],
    ['Reports received', 'Segnalazioni ricevute'],
  ],
  instance: [
    ['Instance name', 'Nome dell’istanza'],
    ['Public address', 'Indirizzo pubblico'],
    ['Version', 'Versione'],
    ['Setup', 'Configurazione'],
  ],
  workspace: [
    ['Space used', 'Spazio usato'],
    ['Uploaded files', 'File caricati'],
    ['Storage', 'Archiviazione'],
    ['Space limits', 'Limiti di spazio'],
    ['Space per person', 'Spazio per persona'],
    ['Warn at', 'Avvisa a'],
  ],
  backups: [
    ['Backups', 'Backup'],
    ['Back up now', 'Esegui backup ora'],
    ['Restore', 'Ripristino'],
    ['Retention', 'Conservazione'],
    ['Nightly backup', 'Backup notturno'],
  ],
  server: [
    ['Processor', 'Processore'],
    ['Memory', 'Memoria'],
    ['Space', 'Spazio'],
    ['Services', 'Servizi'],
    ['Problems', 'Problemi'],
    ['Alerts', 'Avvisi'],
    ['Diagnostics', 'Diagnostica'],
    ['Video', 'Video'],
  ],
  updates: [
    ['Version', 'Versione'],
    ['Check now', 'Controlla ora'],
    ['Tell me when a new version is out', 'Avvisami quando esce una nuova versione'],
    ['Which versions', 'Quali versioni'],
    ['Previews', 'Anteprime'],
    ['Earlier versions', 'Versioni precedenti'],
    ['Inkadra news', 'Novità di Inkadra'],
  ],
  modules: [
    ['Modules', 'Moduli'],
    ['Storyboard', 'Storyboard'],
    ['Production', 'Produzione'],
    ['Moodboard', 'Moodboard'],
    ['Client review', 'Revisione clienti'],
    ['Set plan', 'Pianta del set'],
    ['Turn off', 'Spegni'],
    ['Turn on', 'Accendi'],
  ],
};

/** The labels each page shows, by translation key; every one must find its page. */
const PAGE_LABELS: Record<string, string[]> = {
  instance: ['admin.instanceName', 'settingsUi.about.url', 'settingsUi.about.version'],
  reports: [
    'feedback.settingsTitle',
    'feedback.destination',
    'feedback.repository',
    'feedback.token',
    'feedback.allowGuests',
    'feedback.retention',
    'feedback.received',
  ],
  access: [
    'settingsUi.registration.label',
    'admin.requireAdminTwoFactor',
    'projectCreation.settings.label',
    'calendar.admin',
  ],
  apps: ['calendar.link', 'settings.tokens.title'],
  tutorials: ['feedback.title'],
  board: ['settingsUi.pages.toolbar', 'settingsUi.preferences.keepPlaying'],
  backups: ['backups.nightly'],
  updates: [
    'updates.notify',
    'updates.channel',
    'updates.earlier',
    'settingsUi.notifications.releaseNews',
  ],
};

it('finds every setting label shown on a page, in both languages', async () => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en }, it: { translation: itLocale } },
  });
  const t = (key: string, options?: { lng: string }) => i18n.t(key, options);
  for (const [id, keys] of Object.entries(PAGE_LABELS))
    for (const key of keys)
      for (const lng of ['en', 'it']) {
        const label = i18n.t(key, { lng });
        // "Attachment retention" used to find nothing: the Reports card was missing.
        const pages = matchSettings(SETTINGS_PAGES, label, t, ['it', 'en']).map((m) => m.page.id);
        expect(pages, `${lng}: ${label}`).toContain(id);
      }
});

it('lists the same settings in the same order in every language', () => {
  const keywords = (locale: typeof en, page: string) =>
    (locale.settingsUi.keywords as Record<string, string>)[page]?.split(',').map((k) => k.trim()) ??
    [];
  expect(Object.keys(KEYWORD_PAIRS).sort()).toEqual(
    SETTINGS_PAGES.map((page) => page.keywords.replace('settingsUi.keywords.', '')).sort(),
  );
  for (const [id, pairs] of Object.entries(KEYWORD_PAIRS)) {
    expect(keywords(en, id), id).toEqual(pairs.map(([english]) => english));
    expect(keywords(itLocale, id), id).toEqual(pairs.map(([, italian]) => italian));
  }
});
