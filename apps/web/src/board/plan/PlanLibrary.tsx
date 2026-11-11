// SPDX-License-Identifier: AGPL-3.0-only
import { PLAN_CATEGORIES, PLAN_NOTE_TOOLS } from '@inkadra/canvas-core';
import { PLAN_ICON_KINDS, type PlanIconKind } from '@inkadra/doc-schema';
import { Icon, IconButton } from '@inkadra/ui';
import { type PointerEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getPreferences, updatePreferences, usePreferences } from '../../lib/preferences.ts';
import {
  type CategoryId,
  fold,
  LIBRARY_CATEGORIES,
  type LibraryItem,
  type ProjectKitEntry,
  projectKitDetail,
  searchLibrary,
  tileName,
} from './library.ts';
import { PlanGlyph } from './PlanDrawing.tsx';

export type { LibraryItem } from './library.ts';

const KNOWN = new Set<string>([...PLAN_ICON_KINDS, ...PLAN_NOTE_TOOLS]);
/** How many recent icons the library keeps for a person (decision 0062). */
const RECENTS = 8;
/** A pointer that moves less than this (screen pixels) from a tile taps it. */
const TAP_SLOP = 6;
/** The glyph each category shows on the rail, as on the mockup. */
const RAIL_GLYPH: Record<CategoryId, LibraryItem> = {
  lights: 'fresnel',
  grip: 'softbox',
  camera: 'camera',
  people: 'actor',
  set: 'sofa',
  av: 'monitor',
  notes: 'arrow',
};
type Shelf = CategoryId | 'mine';

let pendingRecents: LibraryItem[] = [];
let recentsTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Remembers an icon as just used, first in the person's recents. Placements in a burst go out
 * as one change, merged with the list as it is when it is sent, so a newer list from another
 * tab or device is kept and kinds this build does not know stay.
 */
export function rememberRecent(item: LibraryItem) {
  pendingRecents = [item, ...pendingRecents.filter((k) => k !== item)];
  clearTimeout(recentsTimer);
  recentsTimer = setTimeout(() => {
    const fresh = pendingRecents;
    pendingRecents = [];
    const rest = getPreferences().planRecents.filter((k) => !fresh.includes(k as LibraryItem));
    void updatePreferences({ planRecents: [...fresh, ...rest].slice(0, RECENTS) }).catch(() => {});
  }, 400);
}

/** What is being dragged out of the library: a type, or an entry of the project kit. */
export type Dragged = { item: LibraryItem } | { kit: ProjectKitEntry };
type At = { clientX: number; clientY: number };

/** The name of a match with what was searched marked. */
function Marked({ text, query }: { text: string; query: string }) {
  const at = fold(text).indexOf(fold(query));
  if (!query || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * The library of a set plan (decision 0104): docked on the left on a wide screen, with the rail
 * of categories, the groups of the chosen one, a search over names, other names and categories,
 * the person's favourites and recent icons and the project kit; a sheet from the bottom on a
 * phone, with the categories as chips. A click arms a type for a click on the plan (on a phone a
 * tap places it in the middle); a drag drops it where it lands; Enter on the search places the
 * first match in the middle of the view.
 */
export function PlanLibrary({
  armed,
  phone,
  kit,
  sensor,
  onArm,
  onPlace,
  onDrag,
  onClose,
}: {
  armed: LibraryItem | null;
  phone: boolean;
  kit: readonly ProjectKitEntry[];
  /** The name of the plan's sensor, for the cameras of the kit. */
  sensor: string;
  onArm: (item: LibraryItem) => void;
  /** Places what was picked or dragged: at these client coordinates, or in the middle. */
  onPlace: (what: Dragged, at: At | null, alt?: boolean) => void;
  /** A drag over the plan, to show where it lands; null when it ends. */
  onDrag?: (what: Dragged | null, at?: At) => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const [query, setQuery] = useState('');
  const [shelf, setShelf] = useState<Shelf>('lights');
  const [tall, setTall] = useState(false);
  const [ghost, setGhost] = useState<{ what: Dragged; x: number; y: number } | null>(null);
  const drag = useRef<{ what: Dragged; x: number; y: number; moved: boolean } | null>(null);
  const known = (list: readonly string[]) => list.filter((k) => KNOWN.has(k)) as LibraryItem[];
  const recents = known(prefs.planRecents);
  const favourites = known(prefs.planFavorites);
  const starred = new Set(favourites);
  const hits = useMemo(() => searchLibrary(t, query), [t, query]);
  const kitHits = query.trim()
    ? kit.filter((k) =>
        fold(`${k.icon.label ?? ''} ${projectKitDetail(k, t, sensor)}`).includes(
          fold(query.trim()),
        ),
      )
    : [];
  const searching = query.trim() !== '';

  const toggleStar = (item: LibraryItem) => {
    // From the stored list, so stars on kinds a newer build added are kept.
    const all = getPreferences().planFavorites;
    const next = all.includes(item) ? all.filter((k) => k !== item) : [...new Set([...all, item])];
    void updatePreferences({ planFavorites: next }).catch(() => {});
  };

  const handlers = (what: Dragged, tap: () => void) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { what, x: e.clientX, y: e.clientY, moved: false };
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) d.moved = true;
      if (d.moved) {
        setGhost({ what, x: e.clientX, y: e.clientY });
        onDrag?.(what, e);
      }
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      drag.current = null;
      setGhost(null);
      onDrag?.(null);
      if (!d) return;
      if (d.moved) onPlace(d.what, e, e.altKey);
      else tap();
    },
    onPointerCancel: () => {
      drag.current = null;
      setGhost(null);
      onDrag?.(null);
    },
    // Keyboard: Enter or Space arms; again on the armed tile places it in the middle.
    onClick: (e: { detail: number }) => {
      if (e.detail === 0) tap();
    },
  });
  /** A tap: on a phone it places in the middle; elsewhere it arms, and again it places. */
  const tapItem = (item: LibraryItem) => () => {
    if (phone || armed === item) onPlace({ item }, null);
    else onArm(item);
  };

  const tile = (item: LibraryItem, key: string = item) => (
    <div key={key} className="plan-lib__cell">
      <button
        type="button"
        className="plan-lib__tile"
        // The plain name: the label below carries soft hyphens to fit the tile.
        aria-label={t(`board.plan.icons.${item}`)}
        aria-pressed={armed === item}
        {...handlers({ item }, tapItem(item))}
      >
        <PlanGlyph kind={item} size={phone ? 30 : 30} />
        <span aria-hidden="true">{tileName(t(`board.plan.icons.${item}`))}</span>
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
  const kitRow = (entry: ProjectKitEntry, marked = '') => (
    <button
      key={entry.key}
      type="button"
      className="plan-lib__item"
      {...handlers({ kit: entry }, () => onPlace({ kit: entry }, null))}
    >
      <PlanGlyph kind={entry.icon.kind} size={26} />
      <span className="plan-lib__text">
        <span>
          <Marked
            text={entry.icon.label || t(`board.plan.icons.${entry.icon.kind}`)}
            query={marked}
          />
        </span>
        <small>
          <Marked text={projectKitDetail(entry, t, sensor)} query={marked} />
        </small>
      </span>
    </button>
  );

  const mine = (
    <>
      <span className="plan-lib__cap">{t('board.plan.starred')}</span>
      {favourites.length ? (
        grid(favourites, 's')
      ) : (
        <p className="plan-lib__hint">{t('board.plan.lib.noFavourites')}</p>
      )}
      <span className="plan-lib__cap">{t('board.plan.recent')}</span>
      {recents.length ? (
        grid(recents, 'r')
      ) : (
        <p className="plan-lib__hint">{t('board.plan.lib.noRecent')}</p>
      )}
      <div className="plan-lib__row">
        <span className="plan-lib__cap">{t('board.plan.lib.projectKit')}</span>
        <span className="plan-lib__count">{t('board.plan.lib.saved', { count: kit.length })}</span>
      </div>
      <div className="plan-lib__list">{kit.map((k) => kitRow(k))}</div>
      <p className="plan-lib__hint">{t('board.plan.lib.kitHint')}</p>
    </>
  );
  const category = LIBRARY_CATEGORIES.find((c) => c.id === shelf);
  const groups =
    shelf === 'notes'
      ? [{ id: 'notes', kinds: PLAN_NOTE_TOOLS as readonly LibraryItem[] }]
      : (PLAN_CATEGORIES.find((c) => c.id === shelf)?.groups.map((g) => ({
          id: g.id as string,
          kinds: g.kinds as readonly PlanIconKind[],
        })) ?? []);
  const shelfBody =
    shelf === 'mine' ? (
      mine
    ) : (
      <>
        {!phone && (
          <div className="plan-lib__row">
            <b>{t(`board.plan.categories.${shelf}`)}</b>
            <span className="plan-lib__count">
              {t('board.plan.lib.types', { count: category?.items.length ?? 0 })}
            </span>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.id} className="plan-lib__group">
            <span className="plan-lib__cap">
              {shelf === 'notes'
                ? t('board.plan.categories.notes')
                : t(`board.plan.groups.${g.id}`)}
            </span>
            {grid(g.kinds, g.id)}
          </section>
        ))}
      </>
    );
  const results = (
    <>
      <p className="plan-lib__hint" role="status">
        {t('board.plan.lib.results', { count: hits.length })}
        {kitHits.length > 0 && ` · ${t('board.plan.lib.kitResults', { count: kitHits.length })}`}
      </p>
      <div className="plan-lib__list">
        {hits.map((h, i) => (
          <button
            key={h.item}
            type="button"
            className="plan-lib__item"
            aria-pressed={armed === h.item}
            {...handlers({ item: h.item }, tapItem(h.item))}
          >
            <PlanGlyph kind={h.item} size={26} />
            <span className="plan-lib__text">
              <span>
                <Marked text={h.name} query={h.by === 'name' ? query.trim() : ''} />
              </span>
              <small>
                <Marked text={h.detail} query={h.by === 'name' ? '' : query.trim()} />
              </small>
            </span>
            {i === 0 && !phone && <kbd>Enter</kbd>}
          </button>
        ))}
      </div>
      {kitHits.length > 0 && (
        <>
          <span className="plan-lib__cap">{t('board.plan.lib.projectKit')}</span>
          <div className="plan-lib__list">{kitHits.map((k) => kitRow(k, query.trim()))}</div>
        </>
      )}
      <p className="plan-lib__hint">{t('board.plan.lib.searchHint')}</p>
    </>
  );
  const search = (
    <label className="plan-lib__search">
      <Icon name="search" size={15} />
      <input
        type="search"
        placeholder={t('board.plan.lib.searchAll', {
          total: PLAN_CATEGORIES.reduce((n, c) => n + c.kinds.length, 0),
        })}
        aria-label={t('board.plan.lib.searchLabel')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) {
            e.preventDefault();
            onPlace({ item: hits[0].item }, null);
          } else if (e.key === 'Escape' && query) {
            e.stopPropagation();
            setQuery('');
          }
        }}
      />
      {!phone && !query && <kbd>/</kbd>}
    </label>
  );
  const shelves: Shelf[] = ['mine', ...LIBRARY_CATEGORIES.map((c) => c.id)];
  const shelfName = (s: Shelf) =>
    s === 'mine' ? t('board.plan.lib.mine') : t(`board.plan.categories.${s}`);
  const ghostView =
    ghost &&
    createPortal(
      <div className="plan-lib__ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
        <PlanGlyph
          kind={'item' in ghost.what ? ghost.what.item : ghost.what.kit.icon.kind}
          size={36}
        />
      </div>,
      document.body,
    );

  let body: ReactNode;
  if (phone)
    body = (
      <section
        className={`plan-lib plan-lib--sheet ink-motion-rise${tall ? ' is-tall' : ''}`}
        aria-label={t('board.plan.library')}
        data-tour="plan-library"
      >
        <button
          type="button"
          className="plan-lib__handle"
          aria-label={t(tall ? 'board.plan.sheetHalf' : 'board.plan.sheetFull')}
          onClick={() => setTall((v) => !v)}
        />
        <div className="plan-lib__top">
          {search}
          {onClose && (
            <IconButton icon="close" label={t('board.plan.closeLibrary')} onClick={onClose} />
          )}
        </div>
        {!searching && (
          <fieldset className="plan-lib__chips" aria-label={t('board.plan.categoryTabs')}>
            {shelves.map((s) => (
              <button key={s} type="button" aria-pressed={shelf === s} onClick={() => setShelf(s)}>
                {s === 'mine' ? t('board.plan.starred') : t(`board.plan.tabs.${s}`)}
              </button>
            ))}
          </fieldset>
        )}
        <div className="plan-lib__body">
          {searching ? results : shelfBody}
          {!searching && <p className="plan-lib__hint">{t('board.plan.lib.tapHint')}</p>}
        </div>
      </section>
    );
  else
    body = (
      <aside
        className="plan-lib plan-lib--dock"
        aria-label={t('board.plan.library')}
        data-tour="plan-library"
      >
        <nav className="plan-lib__rail" aria-label={t('board.plan.categoryTabs')}>
          {shelves.map((s) => (
            <button
              key={s}
              type="button"
              className="plan-lib__cat"
              aria-pressed={!searching && shelf === s}
              aria-label={shelfName(s)}
              data-ink-tooltip={shelfName(s)}
              data-tooltip-side="right"
              onClick={() => {
                setQuery('');
                setShelf(s);
              }}
            >
              {s === 'mine' ? (
                <Icon name="star" size={18} />
              ) : (
                <PlanGlyph kind={RAIL_GLYPH[s]} size={26} />
              )}
            </button>
          ))}
        </nav>
        <div className="plan-lib__body">
          {search}
          {searching ? results : shelfBody}
        </div>
      </aside>
    );
  return (
    <>
      {body}
      {ghostView}
    </>
  );
}
