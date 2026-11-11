// SPDX-License-Identifier: AGPL-3.0-only
import {
  metresToView,
  openingCorners,
  openingSpan,
  updatePlanWalls,
  WALL_THICKNESSES,
  wallLength,
} from '@inkadra/canvas-core';
import { PLAN_OPENING_KINDS, type PlanOpening, type PlanWall } from '@inkadra/doc-schema';
import { Button, Icon } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { LOCAL } from '../store.ts';
import type { Ed } from './editing.ts';
import { NumberField } from './NumberField.tsx';
import { OPENING_ICONS, useMetres, wallCentimetres } from './PlanWalls.tsx';

/**
 * The properties of a picked wall or opening (decision 0109): a wall's thickness, length and
 * name; an opening's kind, width, side and swing, with its distances to the corners. Deleting a
 * wall deletes its openings.
 */
export function PlanWallProperties({ ed }: { ed: Ed }) {
  const { t } = useTranslation();
  const metres = useMetres(ed);
  const ref = ed.wallSel;
  const walls = ed.shown.walls ?? [];
  const wall =
    ref?.kind === 'walls'
      ? walls.find((w) => w.id === ref.id)
      : walls.find((w) => w.id === ed.shown.openings?.find((o) => o.id === ref?.id)?.wall);
  const opening = ref?.kind === 'openings' ? ed.shown.openings?.find((o) => o.id === ref.id) : undefined;
  if (!ref || !wall) return null;
  const scale = ed.wallScale;
  const label = (target: PlanWall | PlanOpening, key: 'walls' | 'openings') => (
    <label className="plan-prop plan-prop--wide">
      <span className="plan-prop__label">{t('board.plan.labelField')}</span>
      <input
        className="plan-field"
        maxLength={60}
        value={target.label ?? ''}
        placeholder={t('board.plan.walls.labelPlaceholder')}
        onFocus={() => ed.store.undo.stopCapturing()}
        onBlur={() => ed.store.undo.stopCapturing()}
        onChange={(e) =>
          // As it is typed, in one undo step.
          updatePlanWalls(
            ed.doc,
            ed.setOwner,
            key,
            [{ ...target, label: e.target.value || undefined } as PlanWall | PlanOpening],
            LOCAL,
          )
        }
      />
    </label>
  );
  const remove = (
    <div className="plan-props__actions">
      <Button variant="danger" onClick={() => ed.removeWalls([ref.id])}>
        {t('board.plan.delete')}
      </Button>
    </div>
  );

  if (opening) {
    const span = openingSpan(wall, opening);
    const corners = openingCorners(wall, opening);
    const isDoor = opening.kind === 'door' || opening.kind === 'doubledoor';
    const write = (patch: Partial<PlanOpening>) => {
      const next = { ...opening, ...patch };
      for (const [k, v] of Object.entries(patch))
        if (v === undefined) delete (next as Record<string, unknown>)[k];
      ed.writeWalls('openings', [next]);
    };
    return (
      <>
        <div className="plan-props__head">
          <span className="plan-props__tile">
            <Icon name={OPENING_ICONS[opening.kind]} size={20} />
          </span>
          <span className="plan-props__name">
            <b>{opening.label || t(`board.plan.walls.kinds.${opening.kind}`)}</b>
            <small>
              {t('board.plan.walls.fromCorners', {
                before: metres(corners.before),
                after: metres(corners.after),
              })}
            </small>
          </span>
        </div>
        <fieldset className="plan-pills" aria-label={t('board.plan.walls.kind')}>
          {PLAN_OPENING_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="plan-pill"
              aria-pressed={opening.kind === kind}
              onClick={() => write({ kind, ...(kind === 'door' ? {} : { hinge: undefined }) })}
            >
              <Icon name={OPENING_ICONS[kind]} size={14} />
              {t(`board.plan.walls.kinds.${kind}`)}
            </button>
          ))}
        </fieldset>
        <div className="plan-props__grid">
          <label className="plan-prop">
            <span className="plan-prop__label">{t('board.plan.width')}</span>
            <NumberField
              value={Math.round(((span.to - span.from) / scale) * 100) / 100}
              min={0.1}
              max={Math.max(0.1, Math.floor((wallLength(wall) / scale) * 100) / 100)}
              step={0.01}
              nudge={0.05}
              unit="m"
              label={t('board.plan.walls.openingWidth')}
              onCommit={(v) => write({ width: Math.round(v * scale * 100) / 100 })}
            />
          </label>
        </div>
        <div className="plan-props__actions">
          <Button
            icon="rotateRight"
            onClick={() => write({ side: opening.side === 'right' ? undefined : 'right' })}
          >
            {t('board.plan.walls.flip')}
          </Button>
          {opening.kind === 'door' && (
            <Button onClick={() => write({ hinge: opening.hinge === 'end' ? undefined : 'end' })}>
              {t('board.plan.walls.swing')}
            </Button>
          )}
        </div>
        {isDoor && <p className="plan-props__hint">{t('board.plan.walls.doorHint')}</p>}
        {label(opening, 'openings')}
        {remove}
      </>
    );
  }

  const cm = wallCentimetres(wall, scale);
  const sides = Math.max(1, wall.points.length / 2 - (wall.closed ? 0 : 1));
  return (
    <>
      <div className="plan-props__head">
        <span className="plan-props__tile">
          <Icon name="wall" size={20} />
        </span>
        <span className="plan-props__name">
          <b>{wall.label || t('board.plan.walls.wall')}</b>
          <small>
            {t('board.plan.walls.wallSummary', {
              count: sides,
              length: metres(wallLength(wall)),
            })}
          </small>
        </span>
      </div>
      <div className="plan-props__row">
        <span className="plan-prop__label">{t('board.plan.walls.thickness')}</span>
        <fieldset className="plan-pills" aria-label={t('board.plan.walls.thickness')}>
          {WALL_THICKNESSES.map((m) => (
            <button
              key={m}
              type="button"
              className="plan-pill"
              aria-pressed={cm === Math.round(m * 100)}
              onClick={() =>
                ed.writeWalls('walls', [
                  { ...wall, thickness: Math.round(metresToView(m, scale) * 100) / 100 },
                ])
              }
            >
              {`${Math.round(m * 100)} cm`}
            </button>
          ))}
        </fieldset>
      </div>
      <p className="plan-props__hint">{t('board.plan.walls.cornersHint')}</p>
      {label(wall, 'walls')}
      {remove}
    </>
  );
}
