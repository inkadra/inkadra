// SPDX-License-Identifier: AGPL-3.0-only
import {
  itemLocked,
  layerOf,
  PLAN_GRIP,
  type PlanGroupName,
  planItems,
  shownOpenings,
  withGroups,
} from '@inkadra/canvas-core';
import type { PlanLayer } from '@inkadra/doc-schema';
import { Icon, IconButton } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAsset } from '../assets.ts';
import type { Ed } from './editing.ts';
import {
  ELEMENT_GROUPS,
  type ElementsFilter,
  elementSections,
  itemName,
  itemSummary,
} from './elements.ts';
import { PLAN_COLORS, PlanGlyph, planCss } from './PlanDrawing.tsx';
import { OPENING_ICONS, setSummary as wallSummary } from './PlanWalls.tsx';

/**
 * The Elements tab (decisions 0104, 0114 and 0117): what is on the plan, by group with counts
 * (the layers, and Grip and crew), filtered by group and by the tag colours in use; each group
 * shown or hidden and locked from its heading (a layer's lock for a layer, every item's own lock
 * for Grip and crew); identical items on one row ("Practical ×3"), the Set as one line of counts
 * that opens on a click; a lock on each item locked; a click selects.
 */
export function PlanElements({
  ed,
  onPicked,
  onBackground,
}: {
  ed: Ed;
  onPicked?: () => void;
  /** Opens the controls of the background picture. */
  onBackground?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const background = ed.drawn.background;
  const asset = useAsset(background?.assetId);
  const backgroundText = background
    ? [
        asset && asset !== 'missing' ? asset.filename : t('board.plan.background.picture'),
        `${Math.round((background.opacity ?? 1) * 100)}%`,
        background.grey && t('board.plan.background.greyShort'),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const [filter, setFilter] = useState<ElementsFilter>({ group: 'all', color: null });
  const [setOpen, setSetOpen] = useState(false);
  const sections = elementSections(ed.linked, filter);
  const everything = elementSections(ed.linked, { group: 'all', color: null });
  const picked = new Set(ed.selection.map((r) => r.id));
  const walls = ed.drawn.walls?.length ?? 0;
  // Only the tag colours the plan uses, as the mockup.
  const used = new Set(planItems(ed.linked).map(({ item }) => item.color));
  const colours = PLAN_COLORS.filter((c) => used.has(c.hex) || filter.color === c.hex);
  const nonEmpty = (g: PlanGroupName) =>
    (everything.find((s) => s.group === g)?.items.length ?? 0) > 0 ||
    (g === 'set' && (walls > 0 || !!background));
  /** "Walls, 2 windows, a door, 9 props": the Set in one line. */
  const setSummary = (count: number) =>
    [wallSummary(ed.drawn, t), count ? t('board.plan.setProps', { count }) : '']
      .filter(Boolean)
      .join(', ');
  const layerName = (l: PlanGroupName) =>
    l === PLAN_GRIP ? t('board.plan.gripGroup') : t(`board.plan.layers.${l}`);
  return (
    <div className="plan-elements" data-tour="plan-elements">
      <fieldset
        className={`plan-pills${ed.phone ? ' plan-pills--scroll' : ''}`}
        aria-label={t('board.plan.filterLayer')}
      >
        {(['all', ...ELEMENT_GROUPS.filter((g) => nonEmpty(g) || filter.group === g)] as const).map(
          (l) => (
            <button
              key={l}
              type="button"
              className="plan-pill"
              aria-pressed={filter.group === l}
              onClick={() => setFilter({ ...filter, group: l })}
            >
              {l === 'all' ? t('board.plan.all') : layerName(l)}
            </button>
          ),
        )}
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
        if (filter.group === 'all' && !items.length && !(layer === 'set' && nonEmpty('set')))
          return null;
        const grip = layer === PLAN_GRIP;
        // The bases listed under what they carry are counted and locked with it, not again.
        const main = items.filter((e) => !e.sub);
        const hidden = ed.hiddenLayers.has(layer);
        // Grip and crew is no layer: its lock is the lock of each of its items (decision 0114).
        const locked = grip ? false : ed.locked.has(layer as PlanLayer);
        const allLocked = grip
          ? main.length > 0 && main.every((e) => itemLocked(e.item))
          : locked;
        const count = main.reduce((n, e) => n + e.refs.length, 0);
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
                  disabled={grip && main.length === 0}
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
                      ? ed.toggleItemLock(main.map((e) => e.item))
                      : ed.toggleLocked(layer as PlanLayer)
                  }
                />
              </span>
            </div>
            {isSet &&
              open &&
              !filter.color &&
              [
                ...(ed.drawn.walls ?? []).map((w) => ({
                  ref: { kind: 'walls' as const, id: w.id },
                  item: w,
                })),
                ...shownOpenings(ed.drawn).map((o) => ({
                  ref: { kind: 'openings' as const, id: o.id },
                  item: o,
                })),
              ].map(({ ref, item }) => (
                <button
                  key={item.id}
                  type="button"
                  className="plan-elements__item"
                  aria-pressed={ed.wallSel?.id === item.id}
                  disabled={hidden}
                  onClick={() => {
                    if (locked) {
                      ed.selectWall(null);
                      ed.setLockedWall(true);
                      return;
                    }
                    ed.selectWall(ref);
                    onPicked?.();
                  }}
                >
                  <span className="plan-elements__glyph">
                    <Icon name={'kind' in item ? OPENING_ICONS[item.kind] : 'wall'} size={18} />
                  </span>
                  <span className="plan-lib__text">
                    <span>
                      {item.label ||
                        t(
                          'kind' in item
                            ? `board.plan.walls.kinds.${item.kind}`
                            : 'board.plan.walls.wall',
                        )}
                    </span>
                  </span>
                  {(locked || itemLocked(item)) && (
                    <>
                      <Icon name="lock" size={13} />
                      <span className="ink-sr-only">{t('board.plan.lockedItem')}</span>
                    </>
                  )}
                </button>
              ))}
            {open &&
              items.map(({ item, refs, sub }) => {
                const icon = 'x' in item ? item : null;
                const summary = icon
                  ? itemSummary(icon, ed.icons, t, { scale: ed.drawn.scale, locale: i18n.language })
                  : '';
                const name =
                  refs.length > 1 ? `${itemName(item, t)} ×${refs.length}` : itemName(item, t);
                // An item of Grip and crew is on a layer of its own, that may be hidden or locked.
                const layerLocked = ed.locked.has(layerOf(item));
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`plan-elements__item${sub ? ' plan-elements__item--sub' : ''}`}
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
            {isSet && background && (
              <div className="plan-elements__head plan-elements__background">
                <button
                  type="button"
                  className="plan-elements__bgopen"
                  onClick={onBackground}
                  aria-label={t('board.plan.background.edit')}
                >
                  <b>{t('board.plan.background.button')}</b>
                  <span className="plan-prop__label">{backgroundText}</span>
                </button>
                <span className="plan-elements__acts">
                  <IconButton
                    icon={background.hidden ? 'eyeOff' : 'eye'}
                    aria-pressed={!!background.hidden}
                    label={t(
                      background.hidden
                        ? 'board.plan.background.showIt'
                        : 'board.plan.background.hideIt',
                    )}
                    onClick={() => {
                      const next = { ...background };
                      if (next.hidden) delete next.hidden;
                      else next.hidden = true;
                      ed.editPlan({ background: next }, ed.scaleOwner);
                    }}
                  />
                </span>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
