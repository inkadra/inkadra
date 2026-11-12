// SPDX-License-Identifier: MPL-2.0
import { PLAN_ICON_KINDS, type PlanIconKind } from '@inkadra/doc-schema';
import {
  catalogueKind,
  groupOf,
  PLAN_CATEGORIES,
  PLAN_NOTE_TOOLS,
  type PlanCategory,
  type PlanNoteTool,
} from './plan-icons.ts';
import type { ProjectKitEntry } from './plan-kit.ts';
import { wattsText } from './plan-labels.ts';
import { iconWatts } from './plan-power.ts';
import type { Words } from './plan-words.ts';

/**
 * The library of a set plan (decisions 0104, 0117): what it offers, its search, and the names it
 * writes, the same on every client (decision 0116). The panel, its tiles and gestures are each
 * client's own.
 */

/** What a library tile places: a set icon, or an annotation tool (arrow, text, measure, zone). */
export type LibraryItem = PlanIconKind | PlanNoteTool;
export type LibraryCategoryId = PlanCategory['id'] | 'notes';

const NOTE_TOOLS = new Set<string>(PLAN_NOTE_TOOLS);
export const isNoteTool = (item: LibraryItem): item is PlanNoteTool => NOTE_TOOLS.has(item);

/** The rail of the library: the six categories of the catalogue, then the annotation tools. */
export const LIBRARY_CATEGORIES: Array<{ id: LibraryCategoryId; items: readonly LibraryItem[] }> = [
  ...PLAN_CATEGORIES.map((c) => ({ id: c.id as LibraryCategoryId, items: c.kinds })),
  { id: 'notes', items: PLAN_NOTE_TOOLS },
];

const KNOWN = new Set<string>([...PLAN_ICON_KINDS, ...PLAN_NOTE_TOOLS]);

/**
 * The items of a stored list (favourites, recents) this build knows, in order. The stored list
 * is an open list: an id a newer build added is skipped here and kept in the account.
 */
export const knownLibraryItems = (list: readonly string[]) =>
  list.filter((k) => KNOWN.has(k)) as LibraryItem[];

/**
 * Text as the search compares it: lower case, accents dropped ("Sôft" reads "soft"). The same on
 * every device: lower case by Unicode's default, never the device's locale (a Turkish one would
 * write "GRID" as "grıd"), and the accents as the combining marks block after NFD, which every
 * JavaScript engine parses (Hermes may not know `\p{Diacritic}`); on the catalogues' words it
 * drops exactly what `\p{Diacritic}` dropped (a test checks every word).
 */
export const foldSearch = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * The name on a library tile: the catalogue's shorter one (`tileNames`) where the full name
 * would not fit, else the full name. A tile writes it on one line or two, broken between words
 * and never inside one, so a word too long for the tile gets a short name (decision 0117).
 */
export const tileName = (t: Words, item: LibraryItem) =>
  t(`board.plan.tileNames.${item}`, { defaultValue: t(`board.plan.icons.${item}`) });

/** Where an item of the library sits: its group, "Modifiers on the light", "Notes". */
export function placeOf(t: Words, item: LibraryItem, category: LibraryCategoryId): string {
  if (isNoteTool(item)) return t(`board.plan.categories.${category}`);
  return t(`board.plan.groups.${groupOf(item).id}`);
}

/** A search result: the item and why it matched, to show under its name. */
export interface LibraryHit {
  item: LibraryItem;
  name: string;
  /** "Modifiers on the light", or the other names when a synonym matched. */
  detail: string;
  by: 'prefix' | 'name' | 'synonym' | 'category';
}

/**
 * The library searched by name, by the other names people use (synonyms) and by category and
 * group, in the language of `t`, accents and case ignored (decision 0117). Names that start
 * with the query come first, the shorter first ("soft": Softbox, then Soft light), then names
 * that hold it, then synonyms, each in the order of the catalogue; a category or group matches
 * only when the query is its whole name ("lights"), so a word of it ("soft") finds no lights.
 */
export function searchLibrary(t: Words, query: string): LibraryHit[] {
  const q = foldSearch(query.trim());
  if (!q) return [];
  const hits: LibraryHit[] = [];
  for (const c of LIBRARY_CATEGORIES)
    for (const item of c.items) {
      const name = t(`board.plan.icons.${item}`);
      const synonyms = t(`board.plan.synonyms.${item}`, { defaultValue: '' });
      const group = isNoteTool(item) ? '' : t(`board.plan.groups.${groupOf(item).id}`);
      const by: LibraryHit['by'] | null = foldSearch(name).startsWith(q)
        ? 'prefix'
        : foldSearch(name).includes(q)
          ? 'name'
          : foldSearch(synonyms).includes(q)
            ? 'synonym'
            : [t(`board.plan.categories.${c.id}`), group].some((g) => g && foldSearch(g) === q)
              ? 'category'
              : null;
      if (!by) continue;
      const detail =
        by === 'synonym'
          ? t('board.plan.lib.alsoCalled', { names: synonyms })
          : placeOf(t, item, c.id);
      hits.push({ item, name, detail, by });
    }
  const rank = { prefix: 0, name: 1, synonym: 2, category: 3 };
  return hits
    .map((h, i) => ({ h, i }))
    .sort(
      (a, b) =>
        rank[a.h.by] - rank[b.h.by] ||
        (a.h.by === 'prefix' ? a.h.name.length - b.h.name.length : 0) ||
        a.i - b.i,
    )
    .map(({ h }) => h);
}

/**
 * "LED COB 300 W · Softbox, grid", "Super 35 · 32, 50, 85 mm": the line under a kit entry, its
 * watts in the app's language (`locale`).
 */
export function projectKitDetail(
  entry: ProjectKitEntry,
  t: Words,
  sensor: string,
  locale: string,
): string {
  const { icon } = entry;
  if (catalogueKind(icon.kind) === 'camera') {
    const lenses = entry.lenses.length ? `${entry.lenses.join(', ')} mm` : '';
    return [icon.make, sensor, lenses].filter(Boolean).join(' · ');
  }
  const watts = iconWatts(icon);
  return [
    [t(`board.plan.icons.${icon.kind}`), icon.power || (watts ? wattsText(watts, locale) : '')]
      .filter(Boolean)
      .join(' '),
    icon.make,
    entry.modifiers.map((m) => t(`board.plan.icons.${m}`)).join(', '),
    icon.stand ? t(`board.plan.stands.${icon.stand}`) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
