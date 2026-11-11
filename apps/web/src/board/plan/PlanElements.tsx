// SPDX-License-Identifier: AGPL-3.0-only
import {
  itemLocked,
  layerOf,
  PLAN_GRIP,
  type PlanGroupName,
  planItems,
  withGroups,
} from '@inkadra/canvas-core';
import type { PlanLayer } from '@inkadra/doc-schema';
import { Icon, IconButton } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ed } from './editing.ts';
import {
  ELEMENT_GROUPS,
  type ElementsFilter,
  elementSections,
  itemName,
  itemSummary,
} from './elements.ts';
import { PLAN_COLORS, PlanGlyph, planCss } from './PlanDrawing.tsx';

/**
 * The Elements tab (decisions 0104, 0114 and 0116): what is on the plan, by group with counts
 * (the layers, and Grip and crew), filtered by group and by the tag colours in use; each group
 * shown or hidden and locked from its heading (a layer's lock for a layer, every item's own lock
 * for Grip and crew); identical items on one row ("Practical ×3"), the Set as one line of counts
 * that opens on a click; a lock on each item locked; a click selects.
 */
export function PlanElements({ ed, onPicked }: { ed: Ed; onPicked?: () => void }) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<ElementsFilter>({ group: 'all', color: null });
  const [setOpen, setSetOpen] = useState(false);
  const sections = elementSections(ed.linked, filter);
  const everything = elementSections(ed.linked, { group: 'all', color: null });
  const picked = new Set(ed.selection.map((r) => r.id));
  const walls = ed.drawn.walls?.length ?? 0;
  const openings = ed.drawn.openings ?? [];
  // Only the tag colours the plan uses, as the mockup.
  const used = new Set(planItems(ed.linked).map(({ item }) => item.color));
  const colours = PLAN_COLORS.filter((c) => used.has(c.hex) || filter.color === c.hex);
  const nonEmpty = (g: PlanGroupName) =>
    (everything.find((s) => s.group === g)?.items.length ?? 0) > 0 ||
    (g === 'set' && walls > 0);
  /** "Walls, 2 windows, door, 9 props": the Set in one line. */
  const setSummary = (count: number) => {
    const windows = openings.filter((o) => o.kind === 'window').length;
    const doors = openings.filter((o) => o.kind !== 'window').length;
    return [
      walls ? t('board.plan.setWalls') : '',
      windows ? t('board.plan.setWindows', { count: windows }) : '',
      doors ? t('board.plan.setDoors', { count: doors }) : '',
      count ? t('board.plan.setProps', { count }) : '',
    ]
      .filter(Boolean)
      .join(', ');
  };
  const layerName = (l: PlanGroupName) =>
    l === PLAN_GRIP ? t('board.plan.gripGroup') : t(`board.plan.layers.${l}`);
  return (
    <div className="plan-elements" data-tour="plan-elements">
      <fieldset
        className={`plan-pills${ed.phone ? ' plan-pills--scroll' : ''}`}
        aria-label={t('board.plan.filterLayer')}
      >
        {(['all', ...ELEMENT_GROUPS.filter((g) => nonEmpty(g) || filter.group === g)] as const).map((l) => (
          <button
            key={l}
            type="button"
            className="plan-pill"
            aria-pressed={filter.group === l}
            onClick={() => setFilter({ ...filter, group: l })}
          >
            {l === 'all' ? t('board.plan.all') : layerName(l)}
          </button>
        ))}
      </fieldset>
      <fieldset className="plan-elements__tags" aria-label={t('board.plan.filterTag')}>
        <span className="plan-prop__label">{t('board.plan.tag')}</span>
        {colours.map((c) => (
          <button
            key={c.hex}
            type="button"
            className="plan-elements__dot"
            aria-pressed={filter.color === c.hex}
            aria-label={t(`board.plan.colors.${c.name}`)}
            data-ink-tooltip={t(`board.plan.colors.${c.name}`)}
            onClick={() => setFilter({ ...filter, color: filter.color === c.hex ? null : c.hex })}
          >
            <i style={{ background: `var(--ink-${c.token})` }} />
          </button>
        ))}
      </fieldset>
      {sections.map(({ group: layer, items }) => {
        // A group with nothing in it says nothing, unless it is the one asked for.
        if (filter.group === 'all' && !items.length && !(layer === 'set' && walls > 0))
          return null;
        const grip = layer === PLAN_GRIP;
        const hidden = ed.hiddenLayers.has(layer);
        // Grip and crew is no layer: its lock is the lock of each of its items (decision 0114).
        const locked = grip ? false : ed.locked.has(layer as PlanLayer);
        const allLocked = grip
          ? items.length > 0 && items.every((e) => itemLocked(e.item))
          : locked;
        const count = items.reduce((n, e) => n + e.refs.length, 0);
        const isSet = layer === 'set';
        // The Set is one line of counts; it opens on a click, or when it is the filter.
        const open = !isSet || setOpen || filter.group === 'set';
        return (
          <section
            key={layer}
            className={`plan-elements__section${isSet ? ' plan-elements__section--set' : ''}`}
            aria-label={layerName(layer)}
          >
            <div className="plan-elements__head">
              {isSet ? (
                <button
                  type="button"
                  className="plan-elements__toggle"
                  aria-expanded={open}
                  onClick={() => setSetOpen((v) => !v)}
                >
                  <b>{layerName(layer)}</b>
                  <span className="plan-prop__label">{setSummary(count)}</span>
                </button>
              ) : (
                <>
                  <b>{layerName(layer)}</b>
                  <span className="plan-prop__label">{count}</span>
                </>
              )}
              <span className="plan-elements__acts">
                <IconButton
                  icon={hidden ? 'eyeOff' : 'eye'}
                  aria-pressed={hidden}
                  label={t(hidden ? 'board.plan.showLayer' : 'board.plan.hideLayer', {
                    layer: layerName(layer),
                  })}
                  onClick={() => ed.toggleHidden(layer)}
                />
                <IconButton
                  icon={allLocked ? 'lock' : 'unlock'}
                  aria-pressed={allLocked}
                  disabled={grip && items.length === 0}
                  label={t(
                    grip
                      ? allLocked
                        ? 'board.plan.unlockGroup'
                        : 'board.plan.lockGroup'
                      : allLocked
                        ? 'board.plan.unlockLayer'
                        : 'board.plan.lockLayer',
                    { layer: layerName(layer) },
                  )}
                  onClick={() =>
                    grip
                      ? ed.toggleItemLock(items.map((e) => e.item))
                      : ed.toggleLocked(layer as PlanLayer)
                  }
                />
              </span>
            </div>
            {open &&
              items.map(({ item, refs }) => {
              const icon = 'x' in item ? item : null;
              const summary = icon
                ? itemSummary(icon, ed.icons, t, { scale: ed.drawn.scale, locale: i18n.language })
                : '';
              const name = refs.length > 1 ? `${itemName(item, t)} ×${refs.length}` : itemName(item, t);
              // An item of Grip and crew is on a layer of its own, that may be hidden or locked.
              const layerLocked = ed.locked.has(layerOf(item));
              return (
                <button
                  key={item.id}
                  type="button"
                  className="plan-elements__item"
                  aria-pressed={refs.every((r) => picked.has(r.id))}
                  disabled={hidden || ed.hiddenLayers.has(layerOf(item))}
                  onClick={(e) => {
                    if (layerLocked) {
                      ed.setLockedItem(item);
                      ed.setSelection([]);
                      return;
                    }
                    ed.setLockedItem(null);
                    const group = withGroups(ed.drawn, refs);
                    ed.setSelection(
                      e.shiftKey
                        ? [
                            ...ed.selection.filter((r) => !group.some((g) => g.id === r.id)),
                            ...group,
                          ]
                        : group,
                    );
                    onPicked?.();
                  }}
                >
                  <span className="plan-elements__glyph" style={{ color: planCss(item.color) }}>
                    {icon ? (
                      <PlanGlyph kind={icon.kind} size={24} />
                    ) : (
                      <Icon
                        name={'x0' in item ? (item.kind === 'text' ? 'text' : 'line') : 'pen'}
                        size={18}
                      />
                    )}
                  </span>
                  <span className="plan-lib__text">
                    <span>{name}</span>
                    {summary && <small>{summary}</small>}
                  </span>
                  {(layerLocked || itemLocked(item)) && (
                    <>
                      <Icon name="lock" size={13} />
                      <span className="ink-sr-only">{t('board.plan.lockedItem')}</span>
                    </>
                  )}
                  <i className="plan-elements__tag" style={{ background: planCss(item.color) }} />
                </button>
              );
              })}
          </section>
        );
      })}
    </div>
  );
}
