// SPDX-License-Identifier: AGPL-3.0-only
import {
  itemLocked,
  layerOf,
  PLAN_GRIP,
  type PlanGroupName,
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
 * The Elements tab (decisions 0104 and 0114): what is on the plan, by group with counts (the
 * layers, and Grip and crew), filtered by group and tag colour; each group shown or hidden and
 * locked from its heading (a layer's lock for a layer, every item's own lock for Grip and crew);
 * a lock on each item locked; a click selects.
 */
export function PlanElements({ ed, onPicked }: { ed: Ed; onPicked?: () => void }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ElementsFilter>({ group: 'all', color: null });
  const sections = elementSections(ed.drawn, filter);
  const picked = new Set(ed.selection.map((r) => r.id));
  const walls = ed.drawn.walls?.length ?? 0;
  const layerName = (l: PlanGroupName) =>
    l === PLAN_GRIP ? t('board.plan.gripGroup') : t(`board.plan.layers.${l}`);
  return (
    <div className="plan-elements" data-tour="plan-elements">
      <fieldset className="plan-pills plan-pills--scroll" aria-label={t('board.plan.filterLayer')}>
        {(['all', ...ELEMENT_GROUPS] as const).map((l) => (
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
        {PLAN_COLORS.map((c) => (
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
        const grip = layer === PLAN_GRIP;
        const hidden = ed.hiddenLayers.has(layer);
        // Grip and crew is no layer: its lock is the lock of each of its items (decision 0114).
        const locked = grip ? false : ed.locked.has(layer as PlanLayer);
        const allLocked = grip
          ? items.length > 0 && items.every((e) => itemLocked(e.item))
          : locked;
        const count = items.length + (layer === 'set' ? walls : 0);
        return (
          <section key={layer} className="plan-elements__section" aria-label={layerName(layer)}>
            <div className="plan-elements__head">
              <span className="plan-props__cap">{layerName(layer)}</span>
              <span className="plan-prop__label">{count}</span>
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
            {layer === 'set' && walls > 0 && (
              <p className="plan-props__hint">{t('board.plan.wallCount', { count: walls })}</p>
            )}
            {items.map(({ ref, item }) => {
              const icon = 'x' in item ? item : null;
              const summary = icon ? itemSummary(icon, ed.icons, t) : '';
              // An item of Grip and crew is on a layer of its own, that may be hidden or locked.
              const layerLocked = ed.locked.has(layerOf(item));
              return (
                <button
                  key={item.id}
                  type="button"
                  className="plan-elements__item"
                  aria-pressed={picked.has(item.id)}
                  disabled={hidden || ed.hiddenLayers.has(layerOf(item))}
                  onClick={(e) => {
                    if (layerLocked) {
                      ed.setLockedItem(item);
                      ed.setSelection([]);
                      return;
                    }
                    ed.setLockedItem(null);
                    const group = withGroups(ed.drawn, [ref]);
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
                    <span>{itemName(item, t)}</span>
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
