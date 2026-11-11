// SPDX-License-Identifier: AGPL-3.0-only
import {
  addPlanWall,
  copySetLayer,
  layerOf,
  linkedLocation,
  type PlanElement,
  planItems,
  ROOM_MAX_METRES,
  ROOM_MIN_METRES,
  ROOM_PRESETS,
  type RoomPreset,
  roomScale,
  roomWalls,
  setSources,
  updateElement,
} from '@inkadra/canvas-core';
import { Button, ChoiceTile, Select } from '@inkadra/ui';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCAL } from '../store.ts';
import type { Ed } from './editing.ts';
import type { useBackgroundPicker } from './PlanBackground.tsx';
import { NumberField } from './NumberField.tsx';
import { setSummary } from './PlanWalls.tsx';

type Choice = 'reuse' | 'draw' | 'trace' | 'scan' | `room:${RoomPreset}`;

/** The drawings of the choices, as the approved mockup draws them (44 by 36). */
const PICTURES: Record<'reuse' | 'draw' | 'trace' | 'scan', ReactNode> = {
  reuse: (
    <>
      <rect x="4" y="5" width="36" height="26" rx="1" />
      <path d="M14 5v8h12" strokeOpacity={0.5} />
    </>
  ),
  draw: (
    <>
      <path d="M6 30V6h32v14" strokeWidth={3.5} />
      <path d="M38 20v10H22" strokeDasharray="3 4" />
    </>
  ),
  trace: (
    <>
      <rect x="5" y="5" width="34" height="26" rx="3" />
      <path d="M5 25l9-9 7 7 5-5 13 13" />
      <circle cx="29" cy="12" r="2.5" />
    </>
  ),
  scan: (
    <>
      <rect x="13" y="3" width="18" height="30" rx="4" />
      <path d="M4 12V6h6M40 12V6h-6M4 24v6h6M40 24v6h-6" />
    </>
  ),
};
/** The ready rooms, 32 by 28. */
const ROOMS: Record<RoomPreset, ReactNode> = {
  rect: <rect x="3" y="4" width="26" height="20" />,
  l: <path d="M3 4h14v10h12v10H3z" />,
  u: <path d="M3 4h8v10h10V4h8v20H3z" />,
  studio: <path d="M3 24V4h26v20" />,
  exterior: <path d="M3 22q6-8 12-3t14-6" strokeDasharray="3 3" />,
};

/**
 * The start dialog of an empty set plan (decision 0109), as the approved mockup draws it: reuse
 * the Set of another plan of the same location, draw the walls, trace an image, scan the room
 * (coming with the phone app), or a ready room with its width and depth; or start empty. A
 * floating panel over the empty drawing; a sheet on a phone.
 */
export function PlanStart({
  ed,
  picker,
  onClose,
}: {
  ed: Ed;
  picker: ReturnType<typeof useBackgroundPicker>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { plan, drawn, cards } = ed;
  // shortcut: only the plans of the open board are offered, the ones the web app can read;
  // upgrade when plans of other boards of the project can be read here with their access.
  const sources = setSources(ed.base ?? plan, ed.kitPlans ?? [], cards);
  const [choice, setChoice] = useState<Choice>(sources.length ? 'reuse' : 'room:rect');
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [width, setWidth] = useState(8);
  const [depth, setDepth] = useState(6);
  const source = sources.find((s) => s.id === sourceId) ?? sources[0];
  const room = choice.startsWith('room:') ? (choice.slice(5) as RoomPreset) : null;
  const scale = room ? roomScale(width, depth, drawn.scale) : null;
  const tooBig = !!room && scale === null;

  const place = linkedLocation(plan, cards)?.name;
  const scene = (plan.sceneIds ?? []).map((s) => cards.get(s)).find((c) => c?.type === 'scene');
  const sceneLine =
    scene?.type === 'scene'
      ? [
          t('board.plan.start.scene', { number: scene.number }),
          scene.setting && t(`film.scene.settings.${scene.setting}`),
          scene.time && t(`film.scene.times.${scene.time}`),
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
  const title = place || (scene?.type === 'scene' && scene.location) || plan.title;
  const sourceName = (p: PlanElement) => {
    const parts = [linkedLocation(p, cards)?.name, p.title].filter(Boolean);
    return parts.join(', ') || t('board.plan.name');
  };

  const go = () => {
    if (choice === 'reuse' && source) {
      ed.change(() => {
        copySetLayer(ed.doc, source, ed.setOwner, LOCAL);
        // Its walls were measured at its scale: a plan without one takes it.
        if (!drawn.scale && source.scale)
          updateElement(
            ed.doc,
            ed.scaleOwner,
            { scale: source.scale, grid: source.grid ?? '0.5' },
            LOCAL,
          );
      });
    } else if (choice === 'draw') {
      ed.setArmed(null);
      ed.setTool('walls');
    } else if (choice === 'trace') picker.pick();
    else if (room && scale) {
      ed.change(() => {
        if (!drawn.scale) updateElement(ed.doc, ed.scaleOwner, { scale, grid: '0.5' }, LOCAL);
        for (const wall of roomWalls(room, width, depth, scale))
          addPlanWall(ed.doc, ed.setOwner, wall, LOCAL);
      });
    }
    onClose();
  };
  const primary =
    choice === 'reuse'
      ? t('board.plan.start.reuseGo')
      : choice === 'draw'
        ? t('board.plan.start.drawGo')
        : choice === 'trace'
          ? t('board.plan.start.traceGo')
          : t('board.plan.start.roomGo');
  const tile = (value: Choice, children: ReactNode, opts: { label?: string; className?: string; disabled?: boolean } = {}) => (
    <ChoiceTile
      variant="card"
      name={id}
      value={value}
      className={opts.className ?? 'plan-start__opt'}
      checked={choice === value}
      disabled={opts.disabled}
      aria-label={opts.label}
      onChange={() => setChoice(value)}
    >
      {children}
    </ChoiceTile>
  );
  const picture = (which: keyof typeof PICTURES) => (
    <svg className="plan-start__pic" viewBox="0 0 44 36" aria-hidden="true">
      {PICTURES[which]}
    </svg>
  );
  return (
    <section
      className={`plan-float plan-start${ed.phone ? ' plan-sheet' : ''}`}
      role="dialog"
      aria-labelledby={`${id}-title`}
      data-tour="plan-start"
    >
      <header className="plan-start__head">
        <b id={`${id}-title`}>
          {title ? t('board.plan.start.titleOf', { name: title }) : t('board.plan.start.title')}
        </b>
        <span className="plan-prop__label">
          {[sceneLine, t('board.plan.start.later')].filter(Boolean).join('. ')}
        </span>
      </header>
      <fieldset className="plan-start__choices" aria-label={t('board.plan.start.how')}>
        {source &&
          tile(
            'reuse',
            <span className="plan-start__row">
              {picture('reuse')}
              <span className="plan-start__text">
                <b>{t('board.plan.start.reuse')}</b>
                <span className="plan-prop__label">
                  {t('board.plan.start.reuseText', {
                    name: sourceName(source),
                    what: [
                      setSummary(source, t),
                      planItems(source).some(({ item }) => layerOf(item) === 'set') &&
                        t('board.plan.start.furniture'),
                    ]
                      .filter(Boolean)
                      .join(', '),
                  })}
                </span>
              </span>
            </span>,
            { className: 'plan-start__opt plan-start__opt--wide' },
          )}
        {sources.length > 1 && choice === 'reuse' && (
          <Select
            aria-label={t('board.plan.start.reuseFrom')}
            value={source?.id ?? ''}
            onChange={setSourceId}
            options={sources.map((s) => ({ value: s.id, label: sourceName(s) }))}
          />
        )}
        <div className="plan-start__grid">
          {tile(
            'draw',
            <>
              {picture('draw')}
              <b>{t('board.plan.start.draw')}</b>
              <span className="plan-prop__label">{t('board.plan.start.drawText')}</span>
            </>,
          )}
          {tile(
            'trace',
            <>
              {picture('trace')}
              <b>{t('board.plan.start.trace')}</b>
              <span className="plan-prop__label">{t('board.plan.start.traceText')}</span>
            </>,
            { disabled: !picker.can },
          )}
          {tile(
            'scan',
            <>
              {picture('scan')}
              <b>{t('board.plan.start.scan')}</b>
              <span className="plan-prop__label">{t('board.plan.start.scanText')}</span>
            </>,
            { disabled: true },
          )}
        </div>
        <span className="plan-props__cap">{t('board.plan.start.ready')}</span>
        <div className="plan-start__rooms">
          {ROOM_PRESETS.map((r) =>
            tile(
              `room:${r}`,
              <svg className="plan-start__room" viewBox="0 0 32 28" aria-hidden="true">
                {ROOMS[r]}
              </svg>,
              { label: t(`board.plan.start.rooms.${r}`), className: 'plan-start__shape' },
            ),
          )}
          <span className="plan-start__size">
            <NumberField
              value={width}
              min={ROOM_MIN_METRES}
              max={ROOM_MAX_METRES}
              step={0.1}
              unit="m"
              label={t('board.plan.width')}
              onCommit={(v) => {
                setWidth(v);
                if (!room) setChoice('room:rect');
              }}
            />
            <span className="plan-prop__label">{t('board.plan.start.by')}</span>
            <NumberField
              value={depth}
              min={ROOM_MIN_METRES}
              max={ROOM_MAX_METRES}
              step={0.1}
              unit="m"
              label={t('board.plan.depth')}
              onCommit={(v) => {
                setDepth(v);
                if (!room) setChoice('room:rect');
              }}
            />
          </span>
        </div>
        {tooBig && (
          <p className="plan-pop__wrong" role="alert">
            {t('board.plan.start.tooBig')}
          </p>
        )}
      </fieldset>
      <div className="plan-start__actions">
        <Button variant="ghost" onClick={onClose}>
          {t('board.plan.start.empty')}
        </Button>
        <Button variant="primary" disabled={tooBig || choice === 'scan'} onClick={go}>
          {primary}
        </Button>
      </div>
    </section>
  );
}
