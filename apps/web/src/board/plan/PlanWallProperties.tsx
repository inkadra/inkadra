// SPDX-License-Identifier: AGPL-3.0-only
import {
  changeOpeningKind,
  flipOpening,
  itemLocked,
  openingCorners,
  openingMaxMetres,
  openingMetres,
  resizeOpening,
  swingOpening,
  updatePlanWalls,
  WALL_THICKNESSES,
  wallCentimetres,
  wallLength,
  wallSideCount,
  wallThickness,
} from '@inkadra/canvas-core';
import { PLAN_OPENING_KINDS, type PlanOpening, type PlanWall } from '@inkadra/doc-schema';
import { Button, Icon } from '@inkadra/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCAL } from '../store.ts';
import type { Ed } from './editing.ts';
import { NumberField } from './NumberField.tsx';
import { OPENING_ICONS, useMetres } from './PlanWalls.tsx';

/**
 * The properties of a picked wall or opening (decision 0110): a wall's thickness, length and
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
  const opening =
    ref?.kind === 'openings' ? ed.shown.openings?.find((o) => o.id === ref.id) : undefined;
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
  const target = opening ?? wall;
  /** Locked on its own (decision 0114): its fields are shown, not edited, and it stays. */
  const frozen = itemLocked(target);
  const wrap = (body: ReactNode) => (
    <>
      {frozen && (
        <div className="plan-props__locked" role="status">
          <Icon name="lock" size={16} />
          <span>{t('board.plan.itemLocked')}</span>
        </div>
      )}
      <fieldset className="plan-props__fields" disabled={frozen}>
        {body}
      </fieldset>
      <div className="plan-props__actions">
        <Button
          aria-pressed={frozen}
          data-ink-tooltip={t(frozen ? 'board.plan.unlockItemHint' : 'board.plan.lockItemHint')}
          onClick={() => ed.toggleWallLock(ref)}
        >
          {t(frozen ? 'board.plan.unlock' : 'board.plan.lock')}
        </Button>
        <Button variant="danger" disabled={frozen} onClick={() => ed.removeWalls([ref.id])}>
          {t('board.plan.delete')}
        </Button>
      </div>
    </>
  );

  if (opening) {
    const corners = openingCorners(wall, opening);
    const isDoor = opening.kind === 'door' || opening.kind === 'doubledoor';
    // A field set back to its default goes as undefined: updatePlanWalls deletes it.
    const write = (patch: Partial<PlanOpening>) =>
      ed.writeWalls('openings', [{ ...opening, ...patch }]);
    return wrap(
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
              onClick={() => write(changeOpeningKind(kind))}
            >
              <Icon name={OPENING_ICONS[kind]} size={14} />
              {t(`board.plan.walls.kinds.${kind}`)}
            </button>
          ))}
        </fieldset>
        <div className="plan-props__grid">
          <div className="plan-prop">
            <span className="plan-prop__label">{t('board.plan.width')}</span>
            <NumberField
              value={openingMetres(wall, opening, scale)}
              min={0.1}
              max={openingMaxMetres(wall, opening, scale)}
              step={0.01}
              nudge={0.05}
              unit="m"
              label={t('board.plan.walls.openingWidth')}
              onCommit={(v) => write(resizeOpening(v, scale))}
            />
          </div>
        </div>
        <div className="plan-props__actions">
          <Button icon="rotateRight" onClick={() => write(flipOpening(opening))}>
            {t('board.plan.walls.flip')}
          </Button>
          {opening.kind === 'door' && (
            <Button onClick={() => write(swingOpening(opening))}>
              {t('board.plan.walls.swing')}
            </Button>
          )}
        </div>
        {isDoor && <p className="plan-props__hint">{t('board.plan.walls.doorHint')}</p>}
        {label(opening, 'openings')}
      </>,
    );
  }

  const cm = wallCentimetres(wall, scale);
  const sides = wallSideCount(wall);
  return wrap(
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
                ed.writeWalls('walls', [{ ...wall, thickness: wallThickness(m, scale) }])
              }
            >
              {`${Math.round(m * 100)} cm`}
            </button>
          ))}
        </fieldset>
      </div>
      <p className="plan-props__hint">{t('board.plan.walls.cornersHint')}</p>
      {label(wall, 'walls')}
    </>,
  );
}
