// SPDX-License-Identifier: AGPL-3.0-only
import {
  PLAN_CATEGORIES,
  PLAN_NOTE_TOOLS,
  type PlanCategory,
  type PlanNoteTool,
} from '@inkadra/canvas-core';
import { PLAN_ICON_KINDS, type PlanIconKind } from '@inkadra/doc-schema';
import { Icon } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import { type PointerEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPreferences, updatePreferences, usePreferences } from '../../lib/preferences.ts';
import { PlanGlyph } from './PlanDrawing.tsx';

/** What a library tile places: a set icon, or an annotation tool (arrow, text, measure, zone). */
export type LibraryItem = PlanIconKind | PlanNoteTool;
type CategoryId = PlanCategory['id'] | 'notes';

const KNOWN = new Set<string>([...PLAN_ICON_KINDS, ...PLAN_NOTE_TOOLS]);
/** How many recent icons the library keeps for a person (decision 0062). */
const RECENTS = 8;
/** A pointer that moves less than this (screen pixels) from a tile taps it. */
const TAP_SLOP = 6;

const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** The words an item is found by: its name, its synonyms, its category. */
function words(t: TFunction, item: LibraryItem, category: string): string {
  return fold(
    [
      t(`board.plan.icons.${item}`),
      t(`board.plan.synonyms.${item}`, { defaultValue: '' }),
      t(`board.plan.categories.${category}`),
    ].join(' '),
  );
}

const CATEGORIES: Array<{ id: CategoryId; items: readonly LibraryItem[] }> = [
  ...PLAN_CATEGORIES.map((c) => ({ id: c.id as CategoryId, items: c.kinds })),
  { id: 'notes', items: PLAN_NOTE_TOOLS },
];

/** Remembers an icon as just used, first in the person's recents. */
export function rememberRecent(item: LibraryItem) {
  const recents = getPreferences().planRecents.filter((k) => k !== item);
  void updatePreferences({ planRecents: [item, ...recents].slice(0, RECENTS) }).catch(() => {});
}

/**
 * The icon library of a set plan (#335): a search that knows synonyms ("kino" finds the tube),
 * the person's recent and starred icons, then the categories. A tap arms an icon for the next
 * taps on the plan; a drag drops it where it lands. On a phone it is a sheet from the bottom
 * with the categories as tabs.
 */
export function PlanLibrary({
  armed,
  phone,
  onArm,
  onDrop,
  onPlaceFirst,
}: {
  armed: LibraryItem | null;
  phone: boolean;
  onArm: (item: LibraryItem) => void;
  /** A tile dragged and let go at these client coordinates. */
  onDrop: (item: LibraryItem, at: { clientX: number; clientY: number }) => void;
  /** Enter in the search: the first match, at the middle of the view. */
  onPlaceFirst: (item: LibraryItem) => void;
}) {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<CategoryId>>(new Set());
  const [tab, setTab] = useState<CategoryId | 'recent' | 'starred'>('lights');
  const [tall, setTall] = useState(false);
  const drag = useRef<{ item: LibraryItem; x: number; y: number; moved: boolean } | null>(null);
  const known = (list: readonly string[]) => list.filter((k) => KNOWN.has(k)) as LibraryItem[];
  const recents = known(prefs.planRecents);
  const favourites = known(prefs.planFavorites);
  const starred = new Set(favourites);

  const index = useMemo(
    () => CATEGORIES.flatMap((c) => c.items.map((item) => ({ item, words: words(t, item, c.id) }))),
    [t],
  );
  const q = fold(query.trim());
  const found = q ? index.filter((e) => e.words.includes(q)).map((e) => e.item) : null;

  const toggleStar = (item: LibraryItem) => {
    const next = starred.has(item) ? favourites.filter((k) => k !== item) : [...favourites, item];
    void updatePreferences({ planFavorites: next }).catch(() => {});
  };

  function down(e: PointerEvent<HTMLButtonElement>, item: LibraryItem) {
    onArm(item);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { item, x: e.clientX, y: e.clientY, moved: false };
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) d.moved = true;
  }
  function up(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) onDrop(d.item, e);
  }

  const tile = (item: LibraryItem, key: string = item) => (
    <div key={key} className="plan-lib__cell">
      <button
        type="button"
        className="plan-lib__tile"
        aria-pressed={armed === item}
        onPointerDown={(e) => down(e, item)}
        onPointerMove={move}
        onPointerUp={up}
      >
        <PlanGlyph kind={item} size={phone ? 24 : 26} />
        <span>{t(`board.plan.icons.${item}`)}</span>
      </button>
      {!phone && (
        <button
          type="button"
          className="plan-lib__star"
          aria-pressed={starred.has(item)}
          aria-label={t('board.plan.favourite', { name: t(`board.plan.icons.${item}`) })}
          onClick={() => toggleStar(item)}
        >
          <Icon name="star" size={11} />
        </button>
      )}
    </div>
  );
  const grid = (items: readonly LibraryItem[], prefix = '') => (
    <div className="plan-lib__grid">{items.map((item) => tile(item, `${prefix}${item}`))}</div>
  );

  const search = (
    <label className="plan-lib__search">
      <Icon name="search" size={13} />
      <input
        type="search"
        placeholder={t('board.plan.search')}
        aria-label={t('board.plan.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && found?.[0]) {
            e.preventDefault();
            onPlaceFirst(found[0]);
          } else if (e.key === 'Escape' && query) {
            e.stopPropagation();
            setQuery('');
          }
        }}
      />
      {!phone && !query && <kbd>/</kbd>}
    </label>
  );

  if (phone) {
    const list =
      found ??
      (tab === 'recent'
        ? recents
        : tab === 'starred'
          ? favourites
          : (CATEGORIES.find((c) => c.id === tab)?.items ?? []));
    return (
      <section
        className={`plan-lib plan-lib--sheet ink-motion-rise${tall ? ' is-tall' : ''}`}
        aria-label={t('board.plan.library')}
      >
        <button
          type="button"
          className="plan-lib__handle"
          aria-label={t(tall ? 'board.plan.sheetHalf' : 'board.plan.sheetFull')}
          onClick={() => setTall((v) => !v)}
        />
        {search}
        {!found && (
          <div className="plan-lib__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'recent'}
              onClick={() => setTab('recent')}
            >
              <Icon name="clock" size={13} />
              {t('board.plan.recent')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'starred'}
              aria-label={t('board.plan.starred')}
              onClick={() => setTab('starred')}
            >
              <Icon name="star" size={13} />
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={tab === c.id}
                onClick={() => setTab(c.id)}
              >
                {t(`board.plan.tabs.${c.id}`)}
              </button>
            ))}
          </div>
        )}
        <div className="plan-lib__body">{grid(list)}</div>
        <p className="plan-lib__hint">{t('board.plan.phoneHint')}</p>
      </section>
    );
  }

  const head = (id: CategoryId, count: number) => (
    <button
      type="button"
      className="plan-lib__cat"
      aria-expanded={!closed.has(id)}
      onClick={() =>
        setClosed((s) => {
          const next = new Set(s);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
    >
      <Icon name="chevronDown" size={12} />
      {t(`board.plan.categories.${id}`)}
      <span>{count}</span>
    </button>
  );

  return (
    <div className="plan-lib">
      {search}
      <div className="plan-lib__body">
        {found ? (
          <>
            {CATEGORIES.map((c) => {
              const hits = c.items.filter((item) => found.includes(item));
              if (hits.length === 0) return null;
              return (
                <div key={c.id}>
                  <div className="plan-lib__cat plan-lib__cat--static">
                    {t(`board.plan.categories.${c.id}`)}
                    <span>{hits.length}</span>
                  </div>
                  {grid(hits, 'q')}
                </div>
              );
            })}
            {found.length === 0 && <p className="plan-lib__hint">{t('board.plan.noMatch')}</p>}
            {found.length > 0 && <p className="plan-lib__hint">{t('board.plan.searchHint')}</p>}
          </>
        ) : (
          <>
            {recents.length > 0 && (
              <>
                <div className="plan-lib__cat plan-lib__cat--static">
                  <Icon name="clock" size={12} />
                  {t('board.plan.recent')}
                </div>
                {grid(recents.slice(0, 4), 'r')}
              </>
            )}
            {favourites.length > 0 && (
              <>
                <div className="plan-lib__cat plan-lib__cat--static plan-lib__cat--star">
                  <Icon name="star" size={12} />
                  {t('board.plan.starred')}
                </div>
                {grid(favourites, 's')}
              </>
            )}
            {CATEGORIES.map((c) => (
              <div key={c.id}>
                {head(c.id, c.items.length)}
                {!closed.has(c.id) && grid(c.items)}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
