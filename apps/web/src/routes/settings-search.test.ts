import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ClassificationCatalogs,
  FeedbackReport,
  InstanceMember,
  Invitation,
  StorageUsage,
} from '@inkadra/shared';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import itLocale from '../i18n/it.json';
import { TOURS } from '../tutorial/tours.ts';
import { anchorCatalog, findWord, NO_DATA, searchData, searchSettings } from './settings-search.ts';
import { anchorHref, SETTINGS, SETTINGS_PAGES } from './settings-sections.ts';

async function translator(language: 'it' | 'en') {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: language,
    resources: { en: { translation: en }, it: { translation: itLocale } },
  });
  return (key: string, options?: Record<string, string>) => i18n.t(key, options);
}

async function finder(language: 'it' | 'en') {
  const t = await translator(language);
  return (query: string) => searchSettings(SETTINGS_PAGES, query, t, ['it', 'en'], language);
}

describe('matching words', () => {
  it('finds the query at the start of a word, whatever its case, accents or apostrophe', () => {
    expect(findWord('Antonino', 'anto')).toEqual([0, 4]);
    expect(findWord('Link di invito', 'INVITO')).toEqual([8, 14]);
    expect(findWord('Indirizzo pubblico', 'pubblìco')).toEqual([10, 18]);
    expect(findWord('Nome dell’istanza', "dell'ist")).toEqual([5, 13]);
    expect(findWord('Verifica (2FA)', '2fa')).toEqual([10, 13]);
    // Inside a word is no match: «quanto» is not «anto».
    expect(findWord('quanto manca', 'anto')).toBeNull();
    expect(findWord('anything', '  ')).toBeNull();
  });
});

describe('searching the settings', () => {
  it('lists each setting as its own result, named with its page, opening its row', async () => {
    const found = await finder('it');
    const theme = found('tema')[0];
    expect(theme).toMatchObject({
      key: 'setting:preferences.theme',
      group: 'settings',
      label: 'Tema',
      sub: 'Aspetto e lingua',
      href: '/settings?section=preferences&setting=preferences.theme',
    });
    // Its options find it too.
    expect(found('scuro').map((r) => r.key)).toEqual(['setting:preferences.theme']);
    // A page is found by its title, and Members keeps its own address.
    expect(found('membri').map((r) => r.key)).toContain('page:members');
    expect(found('2fa').map((r) => r.key)).toEqual([
      'setting:account.twoFactor',
      'setting:access.adminTwoFactor',
    ]);
    expect(found('nothing like this')).toEqual([]);
    expect(found('  ')).toEqual([]);
  });

  it('no longer finds General for «anto», through the «quanto» of its description', async () => {
    // General's lead reads «Il nome dell’istanza e quanto manca per finire la configurazione»:
    // the old search matched any substring of titles, descriptions and keywords.
    for (const language of ['it', 'en'] as const) {
      const found = await finder(language);
      expect(found('anto').map((r) => r.key)).toEqual([]);
    }
  });

  it('ranks the interface language first, then other languages', async () => {
    const italian = await finder('it');
    // «Repository» is Italian too; Reports, Report a problem… match only in English.
    const repo = italian('repo');
    expect(repo[0]).toMatchObject({ key: 'setting:reports.repository', rank: 0 });
    expect(repo.slice(1).every((r) => r.rank === 3)).toBe(true);
    expect(repo.map((r) => r.key)).toContain('setting:tutorials.report');
    // Shown in the interface language whichever language matched.
    expect(italian('theme').map((r) => r.label)).toEqual(['Tema']);
    const english = await finder('en');
    expect(english('tema').map((r) => [r.label, r.rank])).toEqual([['Theme', 3]]);
    // A label that starts with the query comes before one with a later word that does.
    expect(english('time').map((r) => r.key)).toEqual([
      'setting:preferences.timeFormat',
      'setting:backups.time',
      'setting:tutorials.hints',
    ]);
    for (const query of ['re', 'acc', 'spa', 'pro', 'ver'])
      for (const results of [italian(query), english(query)]) {
        const ranks = results.map((r) => r.rank);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      }
  });

  it('finds every label the pages show, in both languages', async () => {
    const t = await translator('en');
    for (const entry of SETTINGS)
      for (const lng of ['en', 'it'] as const) {
        const found = await finder(lng);
        const label = t(entry.label, { lng });
        expect(
          found(label).map((r) => r.key),
          `${lng}: ${label}`,
        ).toContain(`setting:${entry.id}`);
      }
  });
});

/** The app's source, without the tests. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('the settings registry', () => {
  it('points every setting at a row that a component anchors', () => {
    const code = sources(join(__dirname, '..'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // `anchor="x"` on Row, Card or Summary, `data-setting="x"` on an element, or a template
    // (`modules.${id}`) whose ${…} stands for one segment of the id.
    const anchors = [
      ...code.matchAll(/(?:data-setting|\banchor)=(?:"([^"]+)"|\{`([^`]+)`\})/g),
    ].map(([, plain, template]) =>
      plain
        ? new RegExp(`^${literal(plain)}$`)
        : new RegExp(
            `^${(template as string)
              .split(/\$\{[^}]+\}/)
              .map(literal)
              .join('[^.:]+')}$`,
          ),
    );
    const missing = SETTINGS.filter((entry) => !anchors.some((a) => a.test(entry.id)));
    expect(
      missing.map((entry) => entry.id),
      'add anchor="…" to the row, or update SETTINGS',
    ).toEqual([]);
  });

  it('names each setting once, on a page that exists, with texts in the catalogue', () => {
    expect(new Set(SETTINGS.map((e) => e.id)).size).toBe(SETTINGS.length);
    const pages = SETTINGS_PAGES.map((p) => p.id);
    const lookup = (key: string) =>
      key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], itLocale);
    for (const entry of SETTINGS) {
      expect(pages, entry.id).toContain(entry.id.split('.')[0]);
      for (const key of [entry.label, ...(entry.also ?? [])])
        expect(typeof lookup(key), `${entry.id}: ${key}`).toBe('string');
    }
  });

  it('builds addresses that open a row, and finds the catalog of a classification', () => {
    const members = SETTINGS_PAGES.find((p) => p.id === 'members');
    const board = SETTINGS_PAGES.find((p) => p.id === 'board');
    if (!members || !board) throw new Error('pages missing');
    expect(anchorHref(members, 'member:u1')).toBe('/settings/team?setting=member%3Au1');
    expect(anchorHref(board, 'board.dotGrid')).toBe(
      '/settings?section=board&setting=board.dotGrid',
    );
    expect(anchorCatalog('classification:shotSizes:wide')).toBe('shotSizes');
    expect(anchorCatalog('classifications.tags')).toBe('tags');
    expect(anchorCatalog('member:u1')).toBeNull();
    expect(anchorCatalog(null)).toBeNull();
  });
});

const member = (id: string, name: string, email: string): InstanceMember =>
  ({ id, name, email, role: 'member', image: null }) as InstanceMember;
const DATA = {
  members: [
    member('u1', 'Antonino Russo', 'antonino@example.com'),
    member('u2', 'Maddalena Del Curto', 'm@example.com'),
    member('u3', 'Carla Santo', 'carla@example.com'),
  ],
  invitations: [
    { id: 'i1', email: 'anto.new@example.com', kind: 'email' } as Invitation,
    { id: 'i2', email: null, kind: 'link' } as Invitation,
  ],
  classifications: {
    revision: 1,
    projectTypes: [{ id: 'spot', label: 'Spot' }],
    tags: [{ id: 'ant', label: 'Antologia' }],
    shotSizes: [],
    shotAngles: [],
    shotMovements: [],
  } as unknown as ClassificationCatalogs,
  reports: [
    {
      id: 'r1',
      reference: 'R-12',
      reporter: 'Antonino Russo',
      report: { title: 'Board lenta' },
      createdAt: '2026-11-03T10:00:00.000Z',
    } as FeedbackReport,
  ],
  storage: {
    originalBytes: 20_000_000,
    byProject: [],
    byType: [],
    byUser: [
      { userId: 'u1', name: 'Antonino Russo', bytes: 13_000_000, derivedBytes: 650_000 },
      { userId: null, name: null, bytes: 7_000_000 },
    ],
  } as unknown as StorageUsage,
};

describe('searching the data', () => {
  it('finds people, invitations, values, reports and tours, each opening its row', async () => {
    const t = await translator('it');
    const { results: found, more } = searchData(DATA, TOURS, SETTINGS_PAGES, 'anto', t);
    expect(more).toEqual({});
    expect(found.map((r) => [r.group, r.key, r.href])).toEqual([
      ['people', 'member:u1', '/settings/team?setting=member%3Au1'],
      ['people', 'invite:i1', '/settings/team?setting=invite%3Ai1'],
      [
        'classifications',
        'classification:tags:ant',
        '/settings?section=classifications&setting=classification%3Atags%3Aant',
      ],
      ['reports', 'report:r1', '/settings?section=reports&setting=report%3Ar1'],
      ['settings', 'usage:u1', '/settings?section=workspace&setting=workspace.byUser%3Au1'],
    ]);
    // Usage per person (#708): the space with its previews, on Storage.
    expect(found.find((r) => r.key === 'usage:u1')).toMatchObject({
      label: 'Utilizzo per persona: Antonino Russo',
      sub: 'Archiviazione · 13.65 MB',
    });
    // «Santo» is a word of its own; «Carla Santo» does not start with «anto».
    expect(searchData(DATA, TOURS, SETTINGS_PAGES, 'santo', t).results.map((r) => r.key)).toEqual(
      ['member:u3'],
    );
    expect(searchData(DATA, TOURS, SETTINGS_PAGES, 'spot', t).results[0]).toMatchObject({
      label: 'Spot',
      sub: 'Tipi di progetto',
    });
    const tour = TOURS[0];
    if (!tour) throw new Error('no tours');
    const name = t(`tutorial.tours.${tour.id}.name`);
    expect(
      searchData(NO_DATA, TOURS, SETTINGS_PAGES, name, t).results.map((r) => r.key),
    ).toContain(`tour:${tour.id}`);
  });

  it('keeps 8 results per group and counts the others (#709)', async () => {
    const t = await translator('it');
    const many = Array.from({ length: 11 }, (_, i) => member(`m${i}`, `Anna ${i}`, `a${i}@x.it`));
    const { results, more } = searchData(
      { ...DATA, members: many },
      TOURS,
      SETTINGS_PAGES,
      'anna',
      t,
    );
    expect(results.filter((r) => r.group === 'people')).toHaveLength(8);
    expect(more).toEqual({ people: 3 });
  });

  it('shows members nothing that only administrators may see, even if it was loaded', async () => {
    const t = await translator('it');
    const memberPages = SETTINGS_PAGES.filter((p) => !p.admin);
    const found = searchData(DATA, TOURS, memberPages, 'anto', t).results;
    expect(found.filter((r) => r.group !== 'tours')).toEqual([]);
    expect(searchData(DATA, TOURS, memberPages, 'spot', t).results).toEqual([]);
  });
});
