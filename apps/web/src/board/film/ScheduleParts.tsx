// SPDX-License-Identifier: AGPL-3.0-only
import type { FrameElement, PlanElement, SceneElement, SceneGroup } from '@inkadra/canvas-core';
import type { AspectRatio } from '@inkadra/doc-schema';
import {
  ShootingDayInput as DaySchema,
  type ScheduleBlock,
  type ShootingDayInput,
} from '@inkadra/shared';
import {
  Button,
  Checkbox,
  DateField,
  Dialog,
  DialogActions,
  Icon,
  IconButton,
  Select,
} from '@inkadra/ui';
import { Fragment, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moveTabFocus } from '../../lib/tabs.ts';
import { SetupChips } from '../plan/SetupChips.tsx';
import { ScenePlanButton } from '../plan/scenes.tsx';
import { groupBySetup, type ShotSetup } from '../plan/setups.ts';
import { clockString, minutesLabel, monthGrid, parseDuration, SHOT_DRAG_TYPE } from './calendar.ts';
import { plannedWrap } from './call-sheet.ts';
import { FramePicture } from './FramePicture.tsx';
import { AutoTime, TokenField } from './fields.tsx';
import type { CalendarDay } from './ScheduleCalendar.tsx';
import { clockLabel, scheduleTimes } from './schedule.ts';
import {
  type BlockLook,
  offersWhole,
  type ScheduleSource,
  SourceDot,
  type SourceGroup,
} from './schedule-sources.tsx';

/**
 * The tabs of the day panel. A list, so a new tab is one entry here and one in DayPanel's
 * `tabs` (decision 0089).
 */
export type DayTab = 'day' | 'block' | 'calls' | 'needed';

const TYPES = ['shot', 'setup', 'break', 'move', 'note'] as const;
const QUICK = [15, 30, 45, 60, 90];

/** "Alba 07:12 · Tramonto 16:52", from the map link of the location. */
export function SunLine({
  sun,
}: {
  sun: { sunrise: number | null; sunset: number | null } | null;
}) {
  const { t } = useTranslation();
  if (!sun || (sun.sunrise === null && sun.sunset === null)) return null;
  return (
    <span className="schedule__sun">
      <Icon name="sun" size={12} />
      {[
        sun.sunrise !== null && t('schedule.sunrise', { time: clockLabel(sun.sunrise) }),
        sun.sunset !== null && t('schedule.sunset', { time: clockLabel(sun.sunset) }),
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

// --- The queue: month, search, filters, shots by scene -------------------------------------------

export function ScheduleQueue({
  groups,
  labels,
  scheduled,
  totalFrames,
  boardId,
  sources,
  aspectOf,
  slugline,
  plansOf,
  setupsOf,
  setups,
  bySetup,
  onBySetup,
  readOnly,
  disabled,
  loading,
  failed,
  focusDate,
  today,
  shootingDates,
  visibleDates,
  dropDate,
  onPickDate,
  onAdd,
  onAddScene,
}: {
  groups: readonly SourceGroup[];
  labels: ReadonlyMap<string, string>;
  /** Frames (`shot:board/id`) and scenes (`scene:board/id`) already planned. */
  scheduled: ReadonlySet<string>;
  totalFrames: number;
  boardId: string;
  /**
   * The storyboards of the Production board (decision 0123): the queue groups frames by
   * storyboard, then scene, with a Storyboard filter and their dots, and offers whole scenes.
   */
  sources?: readonly ScheduleSource[] | undefined;
  /** The aspect of the storyboard a frame comes from. */
  aspectOf: (frameId: string) => AspectRatio;
  slugline: (scene: SceneElement) => string;
  /** The set plans of a scene, for its chip. */
  plansOf: (sceneId: string) => readonly PlanElement[];
  /** The setups of the set plans a shot belongs to (decision 0104). */
  setupsOf?: ((frameId: string) => readonly ShotSetup[] | undefined) | undefined;
  /** The setups of every shot; "Group by" is offered only when the board's plans have some. */
  setups?: ReadonlyMap<string, readonly ShotSetup[]> | undefined;
  /** The person's "Group by: Setup": a scene's shots under their setups (decision 0115). */
  bySetup?: boolean | undefined;
  onBySetup?: ((on: boolean) => void) | undefined;
  readOnly: boolean;
  disabled: boolean;
  loading: boolean;
  failed: boolean;
  focusDate: string;
  today: string;
  shootingDates: ReadonlySet<string>;
  visibleDates: ReadonlySet<string>;
  /** Where a day dragged by its heading would land. */
  dropDate: string | null;
  onPickDate: (date: string) => void;
  onAdd: (shotId: string) => void;
  /** A scene as a whole, drawn or not (decision 0123, answer 4). */
  onAddScene?: ((boardId: string, sceneId: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [board, setBoard] = useState('');
  const [scene, setScene] = useState('');
  const [cast, setCast] = useState('');
  const across = !!sources;
  const sourceOf = (id: string) => sources?.find((s) => s.boardId === id);
  const groupKey = (g: SourceGroup) => `${g.boardId}/${g.scene?.id ?? 'loose'}`;
  // A scene the script left out is not offered for shooting (decision 0082).
  const waiting = groups
    .filter((g) => !g.scene?.omitted)
    .map((g) => ({
      ...g,
      frames: g.frames.filter((f) => !scheduled.has(`shot:${g.boardId}/${f.id}`)),
      // A scene is offered as a whole until a block plans it (decision 0123).
      whole: !!onAddScene && offersWhole(g, scheduled),
    }))
    .filter((g) => g.frames.length || g.whole);
  const count = waiting.reduce((sum, g) => sum + g.frames.length + (g.whole ? 1 : 0), 0);
  const total = totalFrames + (onAddScene ? groups.filter((g) => g.scene).length : 0);
  const castNames = [
    ...new Map(
      waiting
        .flatMap((g) => g.frames.flatMap((f) => f.cast ?? []))
        .map((name) => [name.trim().toLocaleLowerCase(), name.trim()]),
    ).values(),
  ].sort((a, b) => a.localeCompare(b));
  const words = query.trim().toLocaleLowerCase();
  const sceneText = (g: SourceGroup) =>
    [g.scene?.number, g.scene?.title, g.scene && slugline(g.scene), sourceOf(g.boardId)?.title]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
  const shown = waiting
    .filter((g) => !board || g.boardId === board)
    .filter((g) => !scene || groupKey(g) === scene)
    .map((g) => ({
      ...g,
      frames: g.frames.filter((f) => {
        if (cast && !(f.cast ?? []).some((n) => n.trim().toLocaleLowerCase() === cast))
          return false;
        if (!words) return true;
        const text = [labels.get(f.id), f.action, ...(f.cast ?? []), sceneText(g)]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        return text.includes(words);
      }),
      whole: g.whole && !cast && (!words || sceneText(g).includes(words)),
    }))
    .filter((g) => g.frames.length || g.whole);
  const queueShot = (g: SourceGroup) => (frame: FrameElement) => (
    <QueueShot
      key={frame.id}
      frame={frame}
      label={labels.get(frame.id) ?? ''}
      boardId={g.boardId}
      boardAspect={aspectOf(frame.id)}
      dot={sourceOf(g.boardId)}
      disabled={disabled}
      setups={setupsOf?.(frame.id)}
      onAdd={() => onAdd(frame.id)}
    />
  );
  const sceneName = (g: SceneGroup) =>
    g.scene
      ? [t('schedule.sceneShort', { number: g.scene.number }), g.scene.title || slugline(g.scene)]
          .filter(Boolean)
          .join(' · ')
      : t('film.loose');
  /** How many frames a scene has, planned or not. */
  const drawn = (g: SourceGroup) =>
    groups.find((x) => groupKey(x) === groupKey(g))?.frames.length ?? 0;
  const dotIcon = (source: ScheduleSource | undefined, decorative = true) =>
    source && <SourceDot color={source.dot} name={source.title} decorative={decorative} />;
  return (
    <aside
      className="schedule__queue"
      aria-label={t('schedule.queue')}
      data-scroll
      data-tour="schedule-queue"
    >
      <MiniMonth
        focusDate={focusDate}
        today={today}
        shootingDates={shootingDates}
        visibleDates={visibleDates}
        dropDate={dropDate}
        onPick={onPickDate}
      />
      <h2 className="story__sidebar-title">
        {t('schedule.toPlan')} <span>{loading || failed ? '' : count}</span>
      </h2>
      {loading ? (
        <div className="schedule__queue-loading">
          <span className="ink-skeleton" />
          <span className="ink-skeleton" />
          <span className="ink-skeleton" />
        </div>
      ) : failed ? (
        <p className="schedule__hint">—</p>
      ) : !total ? (
        <p className="schedule__hint">
          {t(across ? 'schedule.noStoryboardShots' : 'shells.noShots')}
        </p>
      ) : !count ? (
        <p className="schedule__hint">{t('schedule.allScheduled')}</p>
      ) : (
        <>
          <label className="schedule__search">
            <Icon name="search" size={14} />
            <input
              className="ink-input"
              type="search"
              placeholder={t('schedule.search')}
              aria-label={t('schedule.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="schedule__filters">
            {sources && sources.length > 0 && (
              <span className="schedule__filter" data-tour="schedule-storyboards">
                <Select
                  variant="quiet"
                  aria-label={t('schedule.filterStoryboard')}
                  value={board}
                  onChange={(value) => {
                    setBoard(value);
                    setScene('');
                  }}
                  options={[
                    { value: '', label: t('schedule.storyboardFilterLabel') },
                    ...sources.map((s) => ({ value: s.boardId, label: s.title, icon: dotIcon(s) })),
                  ]}
                />
              </span>
            )}
            <Select
              variant="quiet"
              aria-label={t('schedule.filterScene')}
              value={scene}
              onChange={setScene}
              options={[
                { value: '', label: t('schedule.sceneFilterLabel') },
                ...waiting
                  .filter((g) => !board || g.boardId === board)
                  .map((g) => ({
                    value: groupKey(g),
                    // Prefixed by its storyboard on the Production board.
                    label: across
                      ? `${sourceOf(g.boardId)?.title ?? ''} · ${sceneName(g)}`
                      : sceneName(g),
                  })),
              ]}
            />
            {!!setups?.size && onBySetup && (
              <Select
                variant="quiet"
                className="schedule__group-by"
                aria-label={t('film.list.groupBy')}
                value={bySetup ? 'setup' : 'scene'}
                onChange={(value) => onBySetup(value === 'setup')}
                options={[
                  {
                    value: 'scene',
                    label: `${t('film.list.groupBy')}: ${t('film.list.groupScene')}`,
                  },
                  {
                    value: 'setup',
                    label: `${t('film.list.groupBy')}: ${t('film.list.groupSetup')}`,
                  },
                ]}
              />
            )}
            {castNames.length > 0 && (
              <Select
                variant="quiet"
                aria-label={t('schedule.filterCast')}
                value={cast}
                onChange={setCast}
                options={[
                  { value: '', label: t('schedule.castFilterLabel') },
                  ...castNames.map((name) => ({ value: name.toLocaleLowerCase(), label: name })),
                ]}
              />
            )}
          </div>
          <p className="schedule__hint">
            {readOnly ? (
              t('schedule.queueReadOnly')
            ) : (
              <>
                {/* A finger taps, a mouse drags or clicks: the CSS shows the one that fits. */}
                <span className="schedule__hint-pointer">{t('schedule.queueHint')}</span>
                <span className="schedule__hint-touch">{t('schedule.queueHintTouch')}</span>
              </>
            )}
          </p>
          {!shown.length && <p className="schedule__hint">{t('schedule.noMatches')}</p>}
          {shown.map((group, i) => (
            <Fragment key={groupKey(group)}>
              {/* On the Production board the scenes come under their storyboard. */}
              {across && shown[i - 1]?.boardId !== group.boardId && (
                <h3 className="schedule__source-title">
                  {dotIcon(sourceOf(group.boardId))}
                  <span>{sourceOf(group.boardId)?.title}</span>
                </h3>
              )}
              <section className="schedule__scene">
                <h3 className="schedule__scene-title">
                  <span>{sceneName(group)}</span>
                  {group.scene && <ScenePlanButton compact plans={plansOf(group.scene.id)} />}
                </h3>
                {group.whole && group.scene && (
                  <button
                    type="button"
                    className="schedule__shot schedule__shot--scene"
                    disabled={disabled}
                    onClick={() => group.scene && onAddScene?.(group.boardId, group.scene.id)}
                  >
                    <span className="schedule__shot-pic" aria-hidden="true">
                      <Icon name="film" size={16} />
                    </span>
                    <span className="schedule__shot-text">
                      <span className="schedule__shot-label">
                        {dotIcon(sourceOf(group.boardId), false)}
                        {t('schedule.wholeScene')}
                      </span>
                      <span className="schedule__shot-action">
                        {drawn(group)
                          ? t('schedule.wholeSceneHint', { count: drawn(group) })
                          : t('schedule.sceneNoFrames')}
                      </span>
                    </span>
                  </button>
                )}
                {bySetup && setups?.size
                  ? groupBySetup(group.frames, setups).map(({ setup, shots }) => (
                      <section
                        key={setup?.planId ?? 'none'}
                        className="schedule__setup"
                        aria-label={setup ? setup.name : t('film.list.noSetup')}
                      >
                        <h4
                          className="schedule__setup-title"
                          title={setup ? `${setup.plan} · ${setup.name}` : undefined}
                        >
                          {setup && <Icon name="map" size={11} />}
                          <span>{setup ? setup.name : t('film.list.noSetup')}</span>
                        </h4>
                        {shots.map(queueShot(group))}
                      </section>
                    ))
                  : group.frames.map(queueShot(group))}
              </section>
            </Fragment>
          ))}
        </>
      )}
    </aside>
  );
}

/** A shot waiting for a day: drag it to a time, or click it to add it to the selected day. */
function QueueShot({
  frame,
  label,
  boardId,
  boardAspect,
  dot,
  disabled,
  setups,
  onAdd,
}: {
  frame: FrameElement;
  label: string;
  boardId: string;
  boardAspect: AspectRatio;
  /** Its storyboard on the Production board. */
  dot?: ScheduleSource | undefined;
  disabled: boolean;
  setups?: readonly ShotSetup[] | undefined;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="schedule__shot"
      draggable={!disabled}
      onClick={onAdd}
      onDragStart={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData(SHOT_DRAG_TYPE, JSON.stringify({ boardId, shotId: frame.id }));
      }}
    >
      <span className="schedule__shot-pic" aria-hidden="true">
        <FramePicture
          assetId={frame.assetId}
          aspect={frame.aspect}
          boardAspect={boardAspect}
          strokes={frame.strokes}
          shapes={frame.shapes}
          referenceOpacity={frame.referenceOpacity}
          pixels={96}
        />
      </span>
      <span className="schedule__shot-text">
        <span className="schedule__shot-label">
          {dot && <SourceDot color={dot.dot} name={dot.title} />}
          {label}
        </span>
        {frame.action && <span className="schedule__shot-action">{frame.action}</span>}
        <SetupChips setups={setups} />
      </span>
    </button>
  );
}

/** The month of the date on screen, shooting days marked; a click shows that date. */
function MiniMonth({
  focusDate,
  today,
  shootingDates,
  visibleDates,
  dropDate,
  onPick,
}: {
  focusDate: string;
  today: string;
  shootingDates: ReadonlySet<string>;
  visibleDates: ReadonlySet<string>;
  dropDate: string | null;
  onPick: (date: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.language, { ...options, timeZone: 'UTC' }).format(
      Date.parse(`${date}T00:00:00Z`),
    );
  const grid = monthGrid(focusDate);
  const month = focusDate.slice(0, 7);
  const inMonth = [...shootingDates].filter((d) => d.startsWith(month)).length;
  // Drop the last week when it is all next month.
  const weeks = Array.from({ length: 6 }, (_, w) => grid.slice(w * 7, w * 7 + 7)).filter(
    (week, w) => w < 5 || week.some((d) => d.startsWith(month)),
  );
  return (
    <div className="schedule__month">
      <div className="schedule__month-head">
        <b>{format(`${month}-01`, { month: 'long', year: 'numeric' })}</b>
        <span>{t('schedule.days', { count: inMonth })}</span>
      </div>
      <table className="schedule__month-grid">
        <thead>
          <tr>
            {grid.slice(0, 7).map((date) => (
              <th key={date} scope="col" abbr={format(date, { weekday: 'long' })}>
                {format(date, { weekday: 'narrow' })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => (
                <td key={date}>
                  {date.startsWith(month) && (
                    <button
                      type="button"
                      className={`schedule__month-day${shootingDates.has(date) ? ' has-shoot' : ''}${visibleDates.has(date) ? ' is-visible' : ''}${date === today ? ' is-today' : ''}${date === dropDate ? ' is-drop' : ''}`}
                      // A day dragged by its heading can land here (phase 3).
                      data-day-drop={date}
                      aria-pressed={date === focusDate}
                      aria-label={`${format(date, { weekday: 'long', day: 'numeric', month: 'long' })}${shootingDates.has(date) ? ` · ${t('schedule.shootDay')}` : ''}`}
                      onClick={() => onPick(date)}
                    >
                      {Number(date.slice(8))}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- One block: the popover, the phone sheet and the panel's Blocco tab --------------------------

export function BlockEditor({
  variant,
  entry,
  blockId,
  days,
  conflicts,
  readOnly,
  castSuggestions,
  blockTitle,
  look,
  slugline,
  dayName,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
  onOpenScene,
  onDetails,
  onClose,
  setupsOf,
}: {
  variant: 'popover' | 'sheet' | 'panel';
  entry: CalendarDay;
  blockId: string;
  days: CalendarDay[];
  conflicts: Set<string>;
  readOnly: boolean;
  castSuggestions: string[];
  /** The name of a block as the calendar shows it. */
  blockTitle: (block: ScheduleBlock) => string;
  /** The frame or scene a block plans, read from its own storyboard (decision 0123). */
  look: (block: ScheduleBlock) => BlockLook | null;
  slugline: (scene: SceneElement) => string;
  dayName: (entry: CalendarDay) => string;
  onChange: (next: ShootingDayInput, key?: string) => void;
  onMove: (dayId: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onOpenScene: ((sceneId: string, boardId: string) => void) | undefined;
  onDetails: () => void;
  onClose: () => void;
  /** The setups of the set plans a shot belongs to (decision 0104). */
  setupsOf?: ((frameId: string) => readonly ShotSetup[] | undefined) | undefined;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { draft } = entry;
  const slots = scheduleTimes(draft);
  const index = draft.blocks.findIndex((b) => b.id === blockId);
  const block = draft.blocks[index];
  const slot = slots[index];
  if (!block || !slot) return null;
  const locked = readOnly || entry.stale;
  const previous = draft.blocks[index - 1];
  const seen = look(block);
  // A storyboard that cannot be read shows the stored label only: no picture, no frame fields.
  const frame = seen?.frame;
  const scene = seen?.scene;
  const update = (patch: Partial<ScheduleBlock>, key?: string) =>
    onChange(
      { ...draft, blocks: draft.blocks.map((b) => (b.id === block.id ? { ...b, ...patch } : b)) },
      key,
    );
  const typeName = (type: ScheduleBlock['type']) => t(`schedule.types.${type}`);
  const name = (b: ScheduleBlock) =>
    look(b) ? blockTitle(b).split(' · ')[0] : b.title || typeName(b.type);
  const after = previous ? t('schedule.after', { block: name(previous) }) : t('schedule.afterCall');
  const others = days.filter((d) => d.day.id !== entry.day.id);
  const full = variant === 'panel';
  return (
    <div className={`schedule__editor schedule__editor--${variant}`}>
      <div className="schedule__editor-head">
        <Select
          className={`schedule__type schedule__type--${block.type}`}
          variant="quiet"
          aria-label={t('schedule.type')}
          disabled={locked}
          value={block.type}
          onChange={(type) => update({ type: type as ScheduleBlock['type'] })}
          // A scene block keeps its type: only the queue makes one (decision 0123).
          options={[...TYPES, ...(block.type === 'scene' ? (['scene'] as const) : [])].map(
            (type) => ({ value: type, label: typeName(type) }),
          )}
        />
        <span className="ink-header__spacer" />
        {variant === 'popover' && !locked && (
          <>
            <IconButton icon="copy" label={t('schedule.duplicate')} onClick={onDuplicate} />
            <IconButton icon="trash" label={t('schedule.removeBlock')} onClick={onRemove} />
          </>
        )}
        {variant !== 'panel' && (
          <IconButton icon="close" label={t('shells.close')} onClick={onClose} />
        )}
      </div>
      {seen ? (
        <div className="schedule__editor-shot">
          {/* No picture of a storyboard that cannot be read (decision 0123). */}
          {(frame || seen.source) && (
            <span className="schedule__editor-pic" aria-hidden="true">
              {frame ? (
                <FramePicture
                  assetId={frame.assetId}
                  aspect={frame.aspect}
                  boardAspect={seen.aspect}
                  strokes={frame.strokes}
                  shapes={frame.shapes}
                  referenceOpacity={frame.referenceOpacity}
                  pixels={200}
                />
              ) : (
                block.type === 'scene' && <Icon name="film" size={20} />
              )}
            </span>
          )}
          <span className="schedule__editor-shot-text">
            <b>
              {seen.dot && <SourceDot color={seen.dot.color} name={seen.dot.name} decorative />}
              {blockTitle(block)}
            </b>
            {block.shotId && <SetupChips setups={setupsOf?.(block.shotId)} />}
            {seen.dot && <span>{seen.dot.name}</span>}
            {scene && block.type !== 'scene' && (
              <span className="schedule__editor-scene">
                {[t('schedule.sceneShort', { number: scene.number }), slugline(scene)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
            {scene && seen.source && onOpenScene && (
              <button
                type="button"
                className="schedule__link"
                onClick={() => seen.source && onOpenScene(scene.id, seen.source.boardId)}
              >
                {t('schedule.openStoryboard')}
              </button>
            )}
          </span>
        </div>
      ) : null}
      <fieldset className="schedule__editor-fields" disabled={locked}>
        <legend className="ink-sr-only">{t('schedule.block')}</legend>
        {(!seen || full) && (
          <label className="schedule__field">
            {t('schedule.title')}
            <input
              className="ink-input"
              maxLength={500}
              value={block.title}
              onChange={(e) => update({ title: e.target.value }, `title:${block.id}`)}
            />
          </label>
        )}
        <div className="schedule__pair">
          <label className="schedule__field" htmlFor={`${id}-start`}>
            {t('schedule.start')}
            <AutoTime
              key={block.id}
              id={`${id}-start`}
              value={block.start}
              computed={clockLabel(slot.start)}
              autoLabel={after}
              disabled={locked}
              onChange={(start) => update({ start }, `start:${block.id}`)}
            />
          </label>
          {variant === 'sheet' ? (
            <fieldset className="schedule__field">
              <legend>{t('schedule.duration')}</legend>
              <span className="schedule__stepper">
                <IconButton
                  icon="minus"
                  label={t('schedule.shorter')}
                  disabled={locked || block.duration <= 5}
                  onClick={() => update({ duration: Math.max(5, block.duration - 5) })}
                />
                <output aria-live="polite">{minutesLabel(block.duration)}</output>
                <IconButton
                  icon="plus"
                  label={t('schedule.longer')}
                  disabled={locked || block.duration >= 1440}
                  onClick={() => update({ duration: Math.min(1440, block.duration + 5) })}
                />
              </span>
            </fieldset>
          ) : (
            <label className="schedule__field" htmlFor={`${id}-duration`}>
              {t('schedule.duration')}
              <DurationField
                id={`${id}-duration`}
                key={block.id}
                minutes={block.duration}
                onChange={(duration) => update({ duration }, `duration:${block.id}`)}
              />
            </label>
          )}
        </div>
        <fieldset className="schedule__quick">
          <legend className="ink-sr-only">{t('schedule.quickDuration')}</legend>
          {QUICK.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="schedule__chip"
              aria-pressed={block.duration === minutes}
              onClick={() => update({ duration: minutes })}
            >
              {minutes < 60 ? `${minutes}′` : minutesLabel(minutes)}
            </button>
          ))}
        </fieldset>
        <label className="schedule__check">
          <Checkbox
            checked={block.start !== null}
            onChange={(e) => update({ start: e.target.checked ? clockString(slot.start) : null })}
          />
          <span>
            {t('schedule.fixed')}
            {variant !== 'sheet' && <small>{t('schedule.fixedHint')}</small>}
          </span>
        </label>
        <label className="schedule__field" htmlFor={`${id}-cast`}>
          {t('schedule.cast')}
          <TokenField
            id={`${id}-cast`}
            values={block.cast}
            suggestions={castSuggestions}
            placeholder={t('schedule.castPlaceholder')}
            disabled={locked}
            removeLabel={(value) => t('schedule.removeToken', { name: value })}
            onChange={(cast) => update({ cast })}
          />
        </label>
        {/* Printed under the description as a highlighted line: "LIGHTS AND WINDOWS ON". */}
        <div className="schedule__field">
          <label htmlFor={`${id}-notes`}>{t('schedule.blockNotes')}</label>
          <textarea
            id={`${id}-notes`}
            className="ink-input"
            rows={2}
            maxLength={2000}
            placeholder={t('schedule.blockNotesPlaceholder')}
            value={block.notes ?? ''}
            onChange={(e) => update({ notes: e.target.value }, `notes:${block.id}`)}
          />
        </div>
        {full && (
          <label className="schedule__field" htmlFor={`${id}-departments`}>
            {t('schedule.departments')}
            <TokenField
              id={`${id}-departments`}
              values={block.departments}
              placeholder={t('schedule.departmentsPlaceholder')}
              disabled={locked}
              removeLabel={(value) => t('schedule.removeToken', { name: value })}
              onChange={(departments) => update({ departments })}
            />
          </label>
        )}
        {conflicts.has(block.id) && (
          <p role="status" className="schedule__error">
            {t('schedule.castConflict')}
          </p>
        )}
      </fieldset>
      {!locked && (
        <div className={`schedule__editor-actions schedule__editor-actions--${variant}`}>
          {others.length > 0 && (
            <Select
              className="schedule__move"
              aria-label={t('schedule.moveTo')}
              placeholder={variant === 'sheet' ? t('schedule.moveShort') : t('schedule.moveTo')}
              value=""
              onChange={onMove}
              options={others.map((d) => ({ value: d.day.id, label: dayName(d) }))}
            />
          )}
          {variant === 'sheet' && (
            <>
              <Button onClick={onDuplicate}>{t('schedule.duplicate')}</Button>
              <Button variant="danger" onClick={onRemove}>
                {t('schedule.remove')}
              </Button>
            </>
          )}
          {variant === 'panel' && (
            <Button variant="ghost" className="schedule__remove" icon="trash" onClick={onRemove}>
              {t('schedule.removeBlock')}
            </Button>
          )}
          {variant === 'popover' && (
            <button type="button" className="schedule__link" onClick={onDetails}>
              {t('schedule.allDetails')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A day changed elsewhere while it was edited here: which version to keep. In the day panel, and
 * in the week view as a banner over the calendar (the approved mockup's states).
 */
export function StaleChoice({
  entry,
  busy,
  banner = false,
  onReload,
  onKeep,
}: {
  entry: CalendarDay;
  busy: boolean;
  banner?: boolean;
  onReload: () => void;
  onKeep: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div role="alert" className={`schedule__stale${banner ? ' is-banner' : ''}`}>
      <p>
        {entry.day.updatedBy
          ? t('schedule.staleBy', {
              name: entry.day.updatedBy.name,
              day: new Intl.DateTimeFormat(i18n.language, {
                weekday: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              }).format(Date.parse(`${entry.day.date}T00:00:00Z`)),
            })
          : t('schedule.staleBody')}
      </p>
      <div className="schedule__actions">
        <Button disabled={busy} onClick={onReload}>
          {t('schedule.staleReload')}
        </Button>
        <Button variant="primary" disabled={busy} onClick={onKeep}>
          {t('schedule.staleKeep')}
        </Button>
      </div>
    </div>
  );
}

// --- The day panel ------------------------------------------------------------------------------

export function DayPanel({
  entry,
  total,
  blockId,
  tab,
  onTab,
  readOnly,
  busy,
  sun,
  neededCount,
  needed,
  callsCount,
  calls,
  block,
  setups,
  onChange,
  onAddBlock,
  onReload,
  onKeep,
  onDelete,
  onMoveDate,
}: {
  entry: CalendarDay;
  total: number;
  blockId: string | null;
  tab: DayTab;
  onTab: (tab: DayTab) => void;
  readOnly: boolean;
  busy: boolean;
  sun: { sunrise: number | null; sunset: number | null } | null;
  neededCount: number;
  needed: ReactNode;
  /** People called on the day; none while the roster is unknown. */
  callsCount?: number | undefined;
  calls: ReactNode;
  block: (id: string) => ReactNode;
  /** With "Group by: Setup", the day's shots under their setups (decision 0115). */
  setups?: ReactNode;
  onChange: (next: ShootingDayInput, key?: string) => void;
  onAddBlock: () => void;
  onReload: () => void;
  onKeep: () => void;
  onDelete: () => void;
  /** "Move to another date…": the dialog that moves or swaps the whole day. */
  onMoveDate: () => void;
}) {
  const { t, i18n } = useTranslation();
  const idBase = useId();
  const { draft, stale } = entry;
  const disabled = readOnly || busy;
  const wrapAuto = plannedWrap({ ...draft, wrap: null });
  const valid = DaySchema.safeParse(draft).success;
  const update = (patch: Partial<ShootingDayInput>, key?: string) =>
    onChange({ ...draft, ...patch }, key);
  const selected = draft.blocks.find((b) => b.id === blockId);
  const long = Number.isNaN(Date.parse(`${draft.date}T00:00:00Z`))
    ? draft.date
    : new Intl.DateTimeFormat(i18n.language, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }).format(Date.parse(`${draft.date}T00:00:00Z`));
  const summary = (() => {
    const slots = scheduleTimes(draft);
    const end = plannedWrap(draft);
    const call = slots.length ? Math.min(...slots.map((s) => s.start)) : null;
    return [
      end === null ? draft.callTime : `${draft.callTime} – ${clockLabel(end)}`,
      end !== null && call !== null && end > call ? minutesLabel(end - call) : '',
      t('schedule.blocks', { count: draft.blocks.length }),
    ]
      .filter(Boolean)
      .join(' · ');
  })();
  // One entry per tab: label, count and what it shows.
  const tabs: Array<{
    id: DayTab;
    label: string;
    count?: number | undefined;
    panel: () => ReactNode;
  }> = [
    { id: 'day', label: t('schedule.tabDay'), panel: () => dayFields },
    {
      id: 'block',
      label: t('schedule.tabBlock'),
      panel: () =>
        selected ? (
          block(selected.id)
        ) : (
          <>
            <p className="schedule__hint">
              {t(draft.blocks.length ? 'schedule.blockHint' : 'schedule.noBlocks')}
            </p>
            {setups}
            {!readOnly && (
              <div>
                <Button icon="plus" disabled={disabled || stale} onClick={onAddBlock}>
                  {t('schedule.addBlock')}
                </Button>
              </div>
            )}
          </>
        ),
    },
    { id: 'calls', label: t('dayCalls.title'), count: callsCount, panel: () => calls },
    { id: 'needed', label: t('needed.title'), count: neededCount, panel: () => needed },
  ];
  const current = tabs.find((item) => item.id === tab) ?? tabs[0];
  const dayFields = (
    <>
      {stale && !readOnly && (
        <StaleChoice entry={entry} busy={busy} onReload={onReload} onKeep={onKeep} />
      )}
      <fieldset disabled={disabled}>
        <legend className="ink-sr-only">{t('schedule.day', { date: draft.date })}</legend>
        <div className="schedule__fields">
          <label htmlFor={`${idBase}-date`}>
            {t('schedule.date')}
            <DateField
              id={`${idBase}-date`}
              label={t('schedule.date')}
              required
              value={draft.date}
              onChange={(date) => update({ date }, 'date')}
            />
          </label>
          <label>
            {t('schedule.callTime')}
            <input
              className="ink-input"
              type="time"
              required
              value={draft.callTime}
              onChange={(e) => update({ callTime: e.target.value }, 'call')}
            />
          </label>
          <label htmlFor={`${idBase}-wrap`}>
            {t('schedule.wrap')}
            <AutoTime
              id={`${idBase}-wrap`}
              value={draft.wrap}
              computed={wrapAuto === null ? null : clockLabel(wrapAuto)}
              autoLabel={t('schedule.auto')}
              onChange={(wrap) => update({ wrap }, 'wrap')}
            />
          </label>
        </div>
        {!valid && <p className="schedule__error">{t('schedule.invalid')}</p>}
        {!readOnly && (
          <div>
            <Button icon="calendar" disabled={stale} onClick={onMoveDate}>
              {t('schedule.moveDay')}
            </Button>
          </div>
        )}
        {/* The first line names the place; the next lines the address and how to get in. */}
        <div className="schedule__wide">
          <label htmlFor={`${idBase}-location`}>{t('schedule.location')}</label>
          <textarea
            id={`${idBase}-location`}
            className="ink-input"
            rows={3}
            maxLength={1000}
            value={draft.location}
            onChange={(e) => update({ location: e.target.value }, 'location')}
          />
        </div>
        {sun && (sun.sunrise !== null || sun.sunset !== null) ? (
          <div className="schedule__sun-card">
            <SunLine sun={sun} />
            <p>{t('schedule.sunNote')}</p>
          </div>
        ) : sun ? (
          <p className="schedule__hint">{t('schedule.sunPolar')}</p>
        ) : (
          <p className="schedule__hint">{t('schedule.sunHint')}</p>
        )}
        {/* Labels beside, not around, the text areas: their name stays the label alone. */}
        <div className="schedule__wide">
          <label htmlFor={`${idBase}-notes`}>{t('schedule.notes')}</label>
          <textarea
            id={`${idBase}-notes`}
            className="ink-input"
            rows={3}
            maxLength={10000}
            value={draft.notes}
            onChange={(e) => update({ notes: e.target.value }, 'notes')}
          />
        </div>
        {!readOnly && <p className="schedule__hint">{t('schedule.autosaveHint')}</p>}
        {/* Away from the everyday fields, and confirmed in a dialog. */}
        {!readOnly && (
          <div className="schedule__danger">
            <Button variant="danger" icon="trash" onClick={onDelete}>
              {t('schedule.deleteDay')}
            </Button>
          </div>
        )}
      </fieldset>
    </>
  );
  return (
    <aside
      className={`schedule__inspector${tab === 'needed' || tab === 'calls' ? ' schedule__inspector--wide' : ''}`}
      aria-label={t('schedule.inspector')}
      data-scroll
    >
      <header className="schedule__inspector-head">
        <span className="story__sidebar-title">
          {t('schedule.dayOf', { n: entry.index + 1, total })}
        </span>
        <h2>{long.charAt(0).toLocaleUpperCase() + long.slice(1)}</h2>
        <p className="schedule__summary">{summary}</p>
      </header>
      <div
        className="schedule__tabs"
        role="tablist"
        aria-label={t('schedule.inspector')}
        onKeyDown={moveTabFocus}
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`${idBase}-tab-${item.id}`}
            type="button"
            role="tab"
            className="schedule__tab"
            aria-selected={current?.id === item.id}
            aria-controls={`${idBase}-panel`}
            tabIndex={current?.id === item.id ? 0 : -1}
            onClick={() => onTab(item.id)}
          >
            {/* The tour points at the calls tab (decision 0092). */}
            {item.id === 'calls' ? (
              <span data-tour="schedule-calls">{item.label}</span>
            ) : (
              item.label
            )}
            {!!item.count && <span className="schedule__tab-count">{item.count}</span>}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${idBase}-panel`}
        aria-labelledby={`${idBase}-tab-${current?.id}`}
        className="schedule__panel"
      >
        {current?.panel()}
      </div>
    </aside>
  );
}

function DurationField({
  id,
  minutes,
  onChange,
}: {
  id: string;
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const emitted = useRef(minutes);
  useEffect(() => {
    if (emitted.current !== minutes) setText(null);
    emitted.current = minutes;
  }, [minutes]);
  const value = text ?? minutesLabel(minutes);
  const valid = parseDuration(value) !== null;
  return (
    <>
      <input
        id={id}
        className="ink-input"
        type="text"
        value={value}
        aria-label={t('schedule.duration')}
        aria-describedby={!valid ? `${id}-error` : undefined}
        aria-invalid={!valid}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const duration = parseDuration(next);
          if (duration !== null) {
            emitted.current = duration;
            onChange(duration);
          }
        }}
        onBlur={() => {
          if (valid) setText(null);
        }}
      />
      {!valid && (
        <span id={`${id}-error`} role="alert">
          {t('schedule.invalidDuration')}
        </span>
      )}
    </>
  );
}

/**
 * "Move to another date…": the keyboard and phone way of dragging a day by its heading. A date
 * that already has a shooting day swaps with it, as a drop does.
 */
export function MoveDayDialog({
  entry,
  days,
  dayName,
  onMove,
  onClose,
}: {
  entry: CalendarDay;
  days: readonly CalendarDay[];
  dayName: (entry: CalendarDay) => string;
  onMove: (date: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [date, setDate] = useState(entry.draft.date);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== entry.draft.date;
  const taken = days.filter((d) => d !== entry && d.draft.date === date);
  return (
    <Dialog open title={t('schedule.moveDayTitle', { day: dayName(entry) })} onClose={onClose}>
      <form
        className="schedule__move-day"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onMove(date);
        }}
      >
        <label htmlFor={`${id}-date`}>
          {t('schedule.date')}
          <DateField
            id={`${id}-date`}
            label={t('schedule.date')}
            required
            value={date}
            onChange={setDate}
          />
        </label>
        <p className="schedule__hint" aria-live="polite">
          {!valid
            ? t('schedule.moveDayPick')
            : taken.length
              ? t('schedule.moveDaySwap', { day: taken.map(dayName).join(', ') })
              : t('schedule.moveDayFree')}
        </p>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('schedule.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            {t(taken.length ? 'schedule.swapDays' : 'schedule.moveDayConfirm')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
