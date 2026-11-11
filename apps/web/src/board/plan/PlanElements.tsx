// SPDX-License-Identifier: AGPL-3.0-only
import { withGroups } from '@inkadra/canvas-core';
import type { PlanLayer } from '@inkadra/doc-schema';
import { Icon, IconButton } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ed } from './editing.ts';
import {
  ELEMENT_LAYERS,
  type ElementsFilter,
  elementSections,
  itemName,
  itemSummary,
} from './elements.ts';
import { PLAN_COLORS, PlanGlyph, planCss } from './PlanDrawing.tsx';

/**
 * The Elements tab (decision 0104): what is on the plan, by layer with counts, filtered by layer
 * and tag colour; each layer shown or hidden and locked from its heading; a click selects.
 */
export function PlanElements({ ed, onPicked }: { ed: Ed; onPicked?: () => void }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ElementsFilter>({ layer: 'all', color: null });
  const sections = elementSections(ed.linked, filter);
  const picked = new Set(ed.selection.map((r) => r.id));
  const walls = ed.drawn.walls?.length ?? 0;
  const layerName = (l: PlanLayer) => t(`board.plan.layers.${l}`);
  return (
    <div className="plan-elements" data-tour="plan-elements">
      <fieldset className="plan-pills plan-pills--scroll" aria-label={t('board.plan.filterLayer')}>
        {(['all', ...ELEMENT_LAYERS] as const).map((l) => (
          <button
            key={l}
            type="button"
            className="plan-pill"
            aria-pressed={filter.layer === l}
            onClick={() => setFilter({ ...filter, layer: l })}
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
      {sections.map(({ layer, items }) => {
        const hidden = ed.hiddenLayers.has(layer);
        const locked = ed.locked.has(layer);
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
                  icon={locked ? 'lock' : 'unlock'}
                  aria-pressed={locked}
                  label={t(locked ? 'board.plan.unlockLayer' : 'board.plan.lockLayer', {
                    layer: layerName(layer),
                  })}
                  onClick={() => ed.toggleLocked(layer)}
                />
              </span>
            </div>
            {layer === 'set' && walls > 0 && (
              <p className="plan-props__hint">{t('board.plan.wallCount', { count: walls })}</p>
            )}
            {items.map(({ ref, item }) => {
              const icon = 'x' in item ? item : null;
              const summary = icon ? itemSummary(icon, ed.icons, t) : '';
              return (
                <button
                  key={item.id}
                  type="button"
                  className="plan-elements__item"
                  aria-pressed={picked.has(item.id)}
                  disabled={hidden}
                  onClick={(e) => {
                    if (locked) {
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
                  {locked && <Icon name="lock" size={13} />}
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
