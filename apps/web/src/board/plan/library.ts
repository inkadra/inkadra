// SPDX-License-Identifier: AGPL-3.0-only
import {
  catalogueKind,
  groupOf,
  iconWatts,
  PLAN_CATEGORIES,
  PLAN_NOTE_TOOLS,
  type PlanCategory,
  type PlanNoteTool,
  type ProjectKitEntry,
} from '@inkadra/canvas-core';
import type { PlanIconKind } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';

/** What a library tile places: a set icon, or an annotation tool (arrow, text, measure, zone). */
export type LibraryItem = PlanIconKind | PlanNoteTool;
export type CategoryId = PlanCategory['id'] | 'notes';

const NOTE_TOOLS = new Set<string>(PLAN_NOTE_TOOLS);
export const isNoteTool = (item: LibraryItem): item is PlanNoteTool => NOTE_TOOLS.has(item);

/** The rail of the library: the six categories of the catalogue, then the annotation tools. */
export const LIBRARY_CATEGORIES: Array<{ id: CategoryId; items: readonly LibraryItem[] }> = [
  ...PLAN_CATEGORIES.map((c) => ({ id: c.id as CategoryId, items: c.kinds })),
  { id: 'notes', items: PLAN_NOTE_TOOLS },
];

export const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Where an item of the library sits: "Lights: soft and LED", "Notes". */
export function placeOf(t: TFunction, item: LibraryItem, category: CategoryId): string {
  const cat = t(`board.plan.categories.${category}`);
  if (isNoteTool(item)) return cat;
  return `${cat}: ${t(`board.plan.groups.${groupOf(item).id}`).toLocaleLowerCase()}`;
}

/** A search result: the item and why it matched, to show under its name. */
export interface LibraryHit {
  item: LibraryItem;
  name: string;
  /** "Lights: soft and LED", or the other names when a synonym matched. */
  detail: string;
  by: 'name' | 'synonym' | 'category';
}

/**
 * The library searched by name, by the other names people use (synonyms) and by category and
 * group, in the language of the app, accents and case ignored. Names that match come first,
 * then synonyms, then categories, each in the order of the catalogue.
 */
export function searchLibrary(t: TFunction, query: string): LibraryHit[] {
  const q = fold(query.trim());
  if (!q) return [];
  const hits: LibraryHit[] = [];
  for (const c of LIBRARY_CATEGORIES)
    for (const item of c.items) {
      const name = t(`board.plan.icons.${item}`);
      const synonyms = t(`board.plan.synonyms.${item}`, { defaultValue: '' });
      const place = placeOf(t, item, c.id);
      const group = isNoteTool(item) ? '' : t(`board.plan.groups.${groupOf(item).id}`);
      const by: LibraryHit['by'] | null = fold(name).includes(q)
        ? 'name'
        : fold(synonyms).includes(q)
          ? 'synonym'
          : fold(`${t(`board.plan.categories.${c.id}`)} ${group}`).includes(q)
            ? 'category'
            : null;
      if (!by) continue;
      const detail = by === 'synonym' ? t('board.plan.lib.alsoCalled', { names: synonyms }) : place;
      hits.push({ item, name, detail, by });
    }
  const rank = { name: 0, synonym: 1, category: 2 };
  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => rank[a.h.by] - rank[b.h.by] || a.i - b.i)
    .map(({ h }) => h);
}

/** "LED COB 300 W · Softbox, grid", "Super 35 · 32, 50, 85 mm": the line under a kit entry. */
export function projectKitDetail(entry: ProjectKitEntry, t: TFunction, sensor: string): string {
  const { icon } = entry;
  if (catalogueKind(icon.kind) === 'camera') {
    const lenses = entry.lenses.length ? `${entry.lenses.join(', ')} mm` : '';
    return [icon.make, sensor, lenses].filter(Boolean).join(' · ');
  }
  const watts = iconWatts(icon);
  return [
    [t(`board.plan.icons.${icon.kind}`), icon.power || (watts ? `${watts} W` : '')]
      .filter(Boolean)
      .join(' '),
    icon.make,
    entry.modifiers.map((m) => t(`board.plan.icons.${m}`)).join(', '),
    icon.stand ? t(`board.plan.stands.${icon.stand}`) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const VOWELS = /[aeiouyàáâãäåèéêëìíîïòóôõöùúûüœæ]/i;
/** Pairs of letters a word is not broken between ("ch", "ck", "qu", "gn"…). */
const KEPT_PAIRS = new Set(['ch', 'ck', 'ph', 'th', 'sh', 'sc', 'qu', 'gn', 'nh', 'lh']);
/** A stop and r or l start a syllable together ("tri", "pro", "bla"). */
const onset = (b: string, c: string) => /[bcdfgkpt]/i.test(b) && /[rl]/i.test(c);

/**
 * A tile's name with soft hyphens where a long word may break ("Pro­fil­schein­wer­fer"), so a
 * name fits the library's 60 px tiles in every language: the browser shows a hyphen only where
 * it breaks the line. A break goes before a consonant (or a stop with r or l, or "sch") that a
 * vowel follows, never within three letters of a word's ends. shortcut: syllables by letter pattern,
 * not by dictionary, so a word breaks at a slightly odd place now and then; browsers that
 * hyphenate by dictionary (`hyphens: auto`) may choose their own points as well.
 */
export function tileName(name: string): string {
  const consonant = (x: string) => /\p{L}/u.test(x) && !VOWELS.test(x);
  return name
    .split(' ')
    .map((word) => {
      if (word.length < 9) return word;
      let out = '';
      for (let i = 0; i < word.length; i++) {
        const [a, b, c, d] = [
          word[i - 1] ?? '',
          word[i] ?? '',
          word[i + 1] ?? '',
          word[i + 2] ?? '',
        ];
        const starts =
          VOWELS.test(c) ||
          (onset(b, c) && VOWELS.test(d)) ||
          word.slice(i, i + 3).toLowerCase() === 'sch';
        const breaks =
          i >= 3 &&
          i <= word.length - 3 &&
          consonant(b) &&
          starts &&
          /\p{L}/u.test(a) &&
          !KEPT_PAIRS.has((a + b).toLowerCase()) &&
          !onset(a, b) &&
          // "schr" and "chr" stay together ("Kühl-schrank", not "Kühlsch-rank").
          !(a === 'h' && /[cs]/i.test(word[i - 2] ?? '') && /r/i.test(b));
        out += (breaks ? '\u00AD' : '') + b;
      }
      return out;
    })
    .join(' ');
}
