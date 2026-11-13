import type {
  ClassificationCatalogs,
  FeedbackReport,
  InstanceMember,
  Invitation,
} from '@inkadra/shared';
import { SHOT_CATALOG_KEYS, type ShotCatalogKey, shotOptionLabel } from '@inkadra/shared';
import type { IconName } from '@inkadra/ui';
import { formatDateTime } from '../lib/datetime.ts';
import type { Tour } from '../tutorial/tours.ts';
import {
  anchorHref,
  GROUP_TITLES,
  SETTINGS,
  type SettingsPage,
  settingPage,
} from './settings-sections.ts';

/** Looks up a translation, in the interface language or in the one given. */
export type SettingsTranslate = (key: string, options?: { lng: string }) => string;

/**
 * Lower case without accents or typographic apostrophes, so "verifica" finds "Verifica" and
 * "dell'istanza" finds "dell’istanza". Folded one character at a time, so a position in the
 * folded text is the same position in the original one (to highlight what matched).
 */
function foldChar(char: string): string {
  const folded = char
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[‘’]/g, "'")
    .toLocaleLowerCase();
  return folded.length === char.length ? folded : char.toLocaleLowerCase().slice(0, char.length);
}

export function fold(text: string): string {
  return text.replace(/./gsu, foldChar);
}

const WORD = /[\p{L}\p{N}]/u;

/**
 * Where the query starts a word of the text, as [start, end), or null. A match inside a word
 * does not count: «anto» used to find General through the «quanto» of its description.
 */
export function findWord(text: string, query: string): [number, number] | null {
  const needle = fold(query.trim());
  if (!needle) return null;
  const haystack = fold(text);
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1))
    if (i === 0 || !WORD.test(haystack[i - 1] as string)) return [i, i + needle.length];
  return null;
}

/** 0: the first text starts with the query; 1: a word of it does; 2: a word of another; else null. */
function rankTexts(texts: string[], query: string): number | null {
  for (const [index, text] of texts.entries()) {
    const at = findWord(text, query);
    if (at) return index === 0 ? (at[0] === 0 ? 0 : 1) : 2;
  }
  return null;
}

export type ResultGroup = 'people' | 'settings' | 'classifications' | 'reports' | 'tours';

/** Groups in the order the results list them. */
export const RESULT_GROUPS: ResultGroup[] = [
  'people',
  'settings',
  'classifications',
  'reports',
  'tours',
];

export interface SettingsResult {
  /** Unique among the results; also the base of the option's element id. */
  key: string;
  group: ResultGroup;
  label: string;
  sub: string;
  href: string;
  icon: IconName;
  /** People show their avatar instead of an icon. */
  person?: { name: string; image?: string | null };
  /** Lower comes first: see `rankTexts`; 3 is a match in another language only. */
  rank: number;
}

const byRank = (a: SettingsResult, b: SettingsResult) => a.rank - b.rank;

/**
 * The pages and settings a search finds, best first: a label in the interface language that
 * starts with the query, then one with a word that does, then the other texts of the row (its
 * options), then the same in the other languages loaded (`languages`, the interface one and
 * English), so "theme" finds the theme with the interface in Italian. What is shown stays in the
 * interface language. Admin-only pages are left out unless `pages` holds them.
 */
export function searchSettings(
  pages: SettingsPage[],
  query: string,
  t: SettingsTranslate,
  languages: readonly string[] = [],
  language?: string,
): SettingsResult[] {
  if (!query.trim()) return [];
  const others = languages.filter((lng) => lng !== language);
  const rank = (keys: string[], terms: string[] = []): number | null => {
    const here = rankTexts([...keys.map((key) => t(key)), ...terms], query);
    if (here !== null) return here;
    const there = others.some((lng) => rankTexts(keys.map((key) => t(key, { lng })), query) !== null);
    return there ? 3 : null;
  };
  const results: SettingsResult[] = [];
  for (const page of pages) {
    const found = rank([page.title]);
    if (found !== null)
      results.push({
        key: `page:${page.id}`,
        group: 'settings',
        label: t(page.title),
        sub: t(GROUP_TITLES[page.group]),
        href: page.href,
        icon: page.icon,
        rank: found,
      });
    for (const entry of SETTINGS) {
      if (settingPage(entry) !== page) continue;
      const hit = rank([entry.label, ...(entry.also ?? [])], entry.terms);
      if (hit !== null)
        results.push({
          key: `setting:${entry.id}`,
          group: 'settings',
          label: t(entry.label),
          sub: t(page.title),
          href: anchorHref(page, entry.id),
          icon: page.icon,
          rank: hit,
        });
    }
  }
  return results.sort(byRank);
}

/** What the search reads besides the settings, loaded once from the pages' own endpoints. */
export interface SettingsData {
  members: InstanceMember[];
  invitations: Invitation[];
  classifications: ClassificationCatalogs | null;
  reports: FeedbackReport[];
}

export const NO_DATA: SettingsData = {
  members: [],
  invitations: [],
  classifications: null,
  reports: [],
};

/** shortcut: each data group shows its first 8 results; a "show all" can come when asked. */
const PER_GROUP = 8;

type CatalogKey = 'projectTypes' | 'tags' | ShotCatalogKey;
const CATALOG_KEYS: CatalogKey[] = ['projectTypes', 'tags', ...SHOT_CATALOG_KEYS];

/**
 * The people, invitations, classification values, received reports and tours a search finds.
 * `data` holds only what the person may see (the caller loads nothing admin-only for members);
 * `pages` decides which pages a result may open, so nothing leads to a page they cannot open.
 */
export function searchData(
  data: SettingsData,
  tours: Tour[],
  pages: SettingsPage[],
  query: string,
  t: SettingsTranslate,
): SettingsResult[] {
  if (!query.trim()) return [];
  const page = (id: string) => pages.find((p) => p.id === id);
  const results: SettingsResult[] = [];
  const add = (group: ResultGroup, found: SettingsResult[]) =>
    results.push(...found.sort(byRank).slice(0, PER_GROUP));
  const members = page('members');
  if (members)
    add('people', [
      ...data.members.flatMap((m): SettingsResult[] => {
        const rank = rankTexts([m.name, m.email], query);
        return rank === null
          ? []
          : [
              {
                key: `member:${m.id}`,
                group: 'people',
                label: m.name,
                sub: `${t(`admin.roles.${m.role}`)} · ${m.email}`,
                href: anchorHref(members, `member:${m.id}`),
                icon: 'user',
                person: { name: m.name, image: m.image },
                rank,
              },
            ];
      }),
      ...data.invitations.flatMap((i): SettingsResult[] => {
        const rank = i.email ? rankTexts([i.email], query) : null;
        return rank === null || !i.email
          ? []
          : [
              {
                key: `invite:${i.id}`,
                group: 'people',
                label: i.email,
                sub: t('settingsUi.find.invite'),
                href: anchorHref(members, `invite:${i.id}`),
                icon: 'mail',
                rank,
              },
            ];
      }),
    ]);
  const catalogs = page('classifications');
  if (catalogs && data.classifications) {
    const values = data.classifications;
    add(
      'classifications',
      CATALOG_KEYS.flatMap((key) =>
        values[key].flatMap((option): SettingsResult[] => {
          const name =
            key === 'projectTypes' || key === 'tags'
              ? option.label
              : shotOptionLabel(key, option, t);
          const rank = rankTexts([name], query);
          return rank === null
            ? []
            : [
                {
                  key: `classification:${key}:${option.id}`,
                  group: 'classifications',
                  label: name,
                  sub: t(`catalogs.${key}`),
                  href: anchorHref(catalogs, `classification:${key}:${option.id}`),
                  icon: 'tag',
                  rank,
                },
              ];
        }),
      ),
    );
  }
  const reports = page('reports');
  if (reports)
    add(
      'reports',
      data.reports.flatMap((r): SettingsResult[] => {
        const rank = rankTexts([r.report.title, r.reporter], query);
        return rank === null
          ? []
          : [
              {
                key: `report:${r.id}`,
                group: 'reports',
                label: `${r.reference} · ${r.report.title}`,
                sub: `${r.reporter} · ${formatDateTime(r.createdAt, { dateStyle: 'medium' })}`,
                href: anchorHref(reports, `report:${r.id}`),
                icon: 'report',
                // The title follows the reference: a title that starts with it still ranks first.
                rank,
              },
            ];
      }),
    );
  const help = page('tutorials');
  if (help)
    add(
      'tours',
      tours.flatMap((tour): SettingsResult[] => {
        const name = t(`tutorial.tours.${tour.id}.name`);
        const rank = rankTexts([name], query);
        return rank === null
          ? []
          : [
              {
                key: `tour:${tour.id}`,
                group: 'tours',
                label: name,
                sub: t(help.title),
                href: anchorHref(help, `tour:${tour.id}`),
                icon: 'play',
                rank,
              },
            ];
      }),
    );
  return results;
}

/** The catalog a classification anchor (`classification:<key>:<id>` or `classifications.<key>`) is in. */
export function anchorCatalog(anchor: string | null): string | null {
  const match = anchor?.match(/^classification(?::|s\.)([A-Za-z]+)/);
  return match?.[1] ?? null;
}
