// SPDX-License-Identifier: AGPL-3.0-only
import { type FrameElement, formatDuration } from '@inkadra/canvas-core';
import {
  ShootingDayInput as DaySchema,
  type Person,
  type ProjectMember,
  type Schedule,
  type ScheduleBlock,
  type ShootingDay,
  type ShootingDayInput,
} from '@inkadra/shared';
import { Button, Dialog, DialogActions, EmptyState, Select } from '@inkadra/ui';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../../lib/api.ts';
import { useIsPhone } from '../../lib/phone.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { CallSheetModal } from './CallSheetModal.tsx';
import { plannedWrap } from './call-sheet.ts';
import { AutoTime, TokenField } from './fields.tsx';
import { NeededItems } from './NeededItems.tsx';
import { neededForDay, updateNeededRow } from './needed.ts';
import { castConflicts, clockLabel, newScheduleBlock, scheduleTimes } from './schedule.ts';
import { useSlugline, useStoryboard } from './storyboard-data.ts';
import './film.css';
import { formatClock } from '../../lib/datetime.ts';

export const SHOT_DRAG_TYPE = 'application/x-inkadra-schedule-shot';
export function resolveDroppedShot(
  payload: string,
  boardId: string,
  ids: readonly string[],
  readOnly: boolean,
): string | null {
  if (readOnly) return null;
  try {
    const value: unknown = JSON.parse(payload);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('boardId' in value) ||
      !('shotId' in value)
    )
      return null;
    return value.boardId === boardId &&
      typeof value.shotId === 'string' &&
      ids.includes(value.shotId)
      ? value.shotId
      : null;
  } catch {
    return null;
  }
}

const byDate = (a: ShootingDay, b: ShootingDay) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

function inputOf(day: ShootingDay): ShootingDayInput {
  const { date, callTime, wrap, location, notes, blocks } = day;
  return { date, callTime, wrap, location, notes, blocks };
}

const sameInput = (a: ShootingDayInput, b: ShootingDayInput) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The day after the last shooting day, or today for the first one. */
function nextDate(days: readonly ShootingDay[]): string {
  const last = days.at(-1)?.date;
  const time = last ? Date.parse(`${last}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(time)) return new Date().toLocaleDateString('en-CA');
  return new Date(time + 86_400_000).toISOString().slice(0, 10);
}

function useDayLabel() {
  const { i18n } = useTranslation();
  return (date: string) => {
    const time = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(time)) return date;
    return new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(time);
  };
}

/** Minutes as "1h 30" or "45 min". */
function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}

type Selection = { day: string | null; block: string | null };
type DayTab = 'plan' | 'needed';

export function ScheduleView({
  store,
  projectName,
  projectId,
  boardId = '',
  userId,
  readOnly = false,
}: {
  store: BoardStore;
  boardTitle?: string;
  projectName?: string;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const slugline = useSlugline();
  const dayLabel = useDayLabel();
  const { groups, frames, labels } = useStoryboard(store);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [days, setDays] = useState<ShootingDay[]>([]);
  // Unsaved edits per day, with the revision they started from. A draft is never dropped when
  // the server has a newer revision: it is flagged as stale until the user picks a version.
  const [drafts, setDrafts] = useState<
    Record<string, { revision: number; draft: ShootingDayInput }>
  >({});
  const [selection, setSelection] = useState<Selection>({ day: null, block: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<DayTab>('plan');
  const [people, setPeople] = useState<Person[]>([]);
  const path = `/boards/${boardId}/schedule`;

  // Who brings what: the project's members, as on the to-do cards.
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api.get<{ items: ProjectMember[] }>(`/projects/${projectId}/members`).then(
      (r) => alive && setPeople(r.items.map((m) => ({ ...m.user, email: null }))),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Shooting days are saved over the API, not in the live board: they are fetched again when
  // the tab comes back into view and after a conflict, so there is no manual reload.
  useEffect(() => {
    let active = true;
    const fetchDays = (initial: boolean) => {
      if (initial) setLoading(true);
      api
        .get<Schedule>(path)
        .then((data) => {
          if (!active) return;
          // A GET that started before a save can answer after it: keep the newer revision.
          setDays((current) =>
            data.items
              .map((item) => {
                const mine = current.find((day) => day.id === item.id);
                return mine && mine.revision > item.revision ? mine : item;
              })
              .sort(byDate),
          );
          // A stale draft that already matches the server copy has nothing left to keep.
          setDrafts((current) => {
            const next = { ...current };
            let changed = false;
            for (const item of data.items) {
              const saved = next[item.id];
              if (
                saved &&
                saved.revision !== item.revision &&
                sameInput(saved.draft, inputOf(item))
              ) {
                delete next[item.id];
                changed = true;
              }
            }
            return changed ? next : current;
          });
          if (initial) setError('');
        })
        .catch(() => {
          if (active && initial) setError(t('schedule.loadError'));
        })
        .finally(() => {
          if (active && initial) setLoading(false);
        });
    };
    fetchDays(refresh === 0);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchDays(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [path, refresh, t]);

  const drafted = useMemo(
    () =>
      days.map((day) => {
        const saved = drafts[day.id];
        return {
          day,
          dirty: !!saved,
          stale: !!saved && saved.revision !== day.revision,
          draft: saved ? saved.draft : inputOf(day),
        };
      }),
    [days, drafts],
  );
  const conflicts = useMemo(() => castConflicts(drafted.map((d) => d.draft)), [drafted]);
  const scheduled = new Set(
    drafted.flatMap((d) => d.draft.blocks.map((block) => block.shotId).filter(Boolean)),
  );
  const activeIndex = Math.max(
    0,
    drafted.findIndex((d) => d.day.id === selection.day),
  );
  const active = drafted[activeIndex];
  const disabled = readOnly || busy;
  const dayName = (index: number) => {
    const day = drafted[index];
    return [t('schedule.dayNumber', { n: index + 1 }), day && dayLabel(day.draft.date)]
      .filter(Boolean)
      .join(' · ');
  };

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function write(action: () => Promise<void>) {
    if (busy || readOnly) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      const conflict = err instanceof RequestError && err.status === 409;
      setError(t(conflict ? 'schedule.conflict' : 'schedule.saveError'));
      if (conflict) setRefresh((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }
  const setDraft = (day: ShootingDay, draft: ShootingDayInput) =>
    setDrafts((current) => ({ ...current, [day.id]: { revision: day.revision, draft } }));
  const dropDraft = (day: ShootingDay) =>
    setDrafts((current) => {
      const { [day.id]: _, ...rest } = current;
      return rest;
    });
  // "Keep mine": the draft is rebased on the server revision, so the next save replaces it.
  const keepDraft = (day: ShootingDay) =>
    setDrafts((current) => {
      const saved = current[day.id];
      return saved ? { ...current, [day.id]: { ...saved, revision: day.revision } } : current;
    });
  const save = (day: ShootingDay, draft: ShootingDayInput) =>
    write(async () => {
      const saved = await api.put<ShootingDay>(`${path}/${day.id}`, {
        ...draft,
        revision: day.revision,
      });
      setDays((current) => current.map((item) => (item.id === day.id ? saved : item)).sort(byDate));
      // Edits typed while the request was running stay, on top of the saved revision.
      setDrafts((current) => {
        const { [day.id]: entry, ...rest } = current;
        if (!entry || entry.draft === draft) return rest;
        return { ...rest, [day.id]: { ...entry, revision: saved.revision } };
      });
    });
  const addDay = () =>
    write(async () => {
      const day = await api.post<ShootingDay>(path, {
        date: nextDate(days),
        callTime: '08:00',
        wrap: null,
        location: '',
        notes: '',
        blocks: [],
      });
      setDays((current) => [...current, day].sort(byDate));
      setSelection({ day: day.id, block: null });
    });
  const addShot = (index: number, shotId: string) => {
    const target = drafted[index];
    if (!target || disabled || scheduled.has(shotId)) return;
    const { day, draft, stale } = target;
    if (stale) {
      setError(t('schedule.staleBlocked', { day: dayName(index) }));
      return;
    }
    if (!DaySchema.safeParse(draft).success) {
      setError(t('schedule.invalidBlocked', { day: dayName(index) }));
      return;
    }
    const frame = frames.find((item) => item.id === shotId);
    if (!frame) return;
    const block = { ...newScheduleBlock('shot', shotId), cast: frame.cast ?? [] };
    const next = { ...draft, blocks: [...draft.blocks, block] };
    setDraft(day, next);
    setSelection({ day: day.id, block: block.id });
    // The day may be off-screen (phones stack the columns): say where the shot went.
    setNotice(t('schedule.addedTo', { shot: labels.get(shotId) ?? '', day: dayName(index) }));
    void save(day, next);
  };
  const shotTitle = (shotId: string) => {
    const frame = frames.find((item) => item.id === shotId);
    const label = labels.get(shotId) ?? t('schedule.missingShot');
    return frame?.action ? `${label} · ${frame.action}` : label;
  };
  const callSheetShots = new Map(
    groups.flatMap(({ scene, frames: items }) =>
      items.map((frame) => [
        frame.id,
        {
          label: labels.get(frame.id) ?? '',
          action: frame.action?.trim(),
          scene: scene?.number,
          slugline: scene ? slugline(scene) : undefined,
        },
      ]),
    ),
  );
  // Character cards of the board and names already in the storyboard or the plan, offered
  // while typing the cast of a block.
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const castSuggestions = [
    ...new Map(
      [
        ...[...snap.byId.values()].flatMap((el) => (el.type === 'character' ? [el.name] : [])),
        ...frames.flatMap((frame) => frame.cast ?? []),
        ...drafted.flatMap(({ draft }) => draft.blocks.flatMap((block) => block.cast)),
      ]
        .filter((name) => name.trim())
        .map((name) => [name.trim().toLocaleLowerCase(), name.trim()]),
    ).values(),
  ].sort((a, b) => a.localeCompare(b));
  const phone = useIsPhone();
  const [sheetOpen, setSheetOpen] = useState(false);
  const neededOf = (day: ShootingDayInput) => neededForDay(day, snap.byId.values());
  const neededRows = active ? neededOf(active.draft) : [];
  const inspector = active && (
    <DayInspector
      key={active.day.id}
      day={active.day}
      draft={active.draft}
      dirty={active.dirty}
      stale={active.stale}
      index={activeIndex}
      blockId={selection.block}
      conflicts={conflicts}
      shotTitle={shotTitle}
      castSuggestions={castSuggestions}
      readOnly={readOnly}
      busy={busy}
      tab={tab}
      onTab={setTab}
      neededCount={neededRows.length}
      needed={
        <NeededItems
          rows={neededRows}
          people={people}
          userId={userId}
          readOnly={readOnly}
          phone={phone}
          onChange={(row, patch) => updateNeededRow(store.doc, row, patch, LOCAL)}
        />
      }
      onChange={(draft) => setDraft(active.day, draft)}
      onSelectBlock={(block) => setSelection({ day: active.day.id, block })}
      onSave={() => save(active.day, active.draft)}
      onReload={() => dropDraft(active.day)}
      onKeep={() => keepDraft(active.day)}
      onDelete={() =>
        write(async () => {
          const { day } = active;
          await api.delete(`${path}/${day.id}`, { revision: day.revision });
          setDays((current) => current.filter((item) => item.id !== day.id));
          setSelection({ day: null, block: null });
        })
      }
    />
  );
  const unscheduled = frames.filter((frame) => !scheduled.has(frame.id));

  return (
    <section className="schedule" aria-label={t('nav.schedule')}>
      <div className="story__bar" data-chrome>
        <span className="story__total">
          {t('schedule.days', { count: days.length })} ·{' '}
          {t('schedule.scheduledShots', { scheduled: scheduled.size, total: frames.length })}
        </span>
        {conflicts.size > 0 && (
          <span className="schedule__flag">
            {t('schedule.conflicts', { count: conflicts.size })}
          </span>
        )}
        <span className="ink-header__spacer" />
        <Button icon="file" disabled={loading || !!error} onClick={() => setCallSheetOpen(true)}>
          {t('shells.callSheet')}
        </Button>
        {/* With no days the empty state carries the same action. */}
        {!readOnly && days.length > 0 && (
          <Button variant="primary" icon="plus" disabled={busy || loading} onClick={addDay}>
            {t('schedule.addDay')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="schedule__error">
          {error}
        </p>
      )}
      <p role="status" className="schedule__notice" hidden={!notice}>
        {notice}
      </p>
      {loading ? (
        <div className="board-state">
          <p role="status" className="ink-muted">
            {t('schedule.loading')}
          </p>
        </div>
      ) : (
        <div className="story__main">
          <aside className="schedule__queue" aria-label={t('schedule.queue')} data-scroll>
            <h2 className="story__sidebar-title">
              {t('schedule.queue')} <span>{unscheduled.length}</span>
            </h2>
            {!frames.length ? (
              <p className="schedule__hint">{t('shells.noShots')}</p>
            ) : !unscheduled.length ? (
              <p className="schedule__hint">{t('schedule.allScheduled')}</p>
            ) : (
              <p className="schedule__hint">
                {readOnly ? (
                  t('schedule.queueReadOnly')
                ) : (
                  <>
                    {/* A finger taps, a mouse drags or clicks: film.css shows the one that fits. */}
                    <span className="schedule__hint-pointer">{t('schedule.queueHint')}</span>
                    <span className="schedule__hint-touch">{t('schedule.queueHintTouch')}</span>
                  </>
                )}
              </p>
            )}
            {groups.map((group) => {
              const items = group.frames.filter((frame) => !scheduled.has(frame.id));
              if (!items.length) return null;
              return (
                <section key={group.scene?.id ?? 'loose'} className="schedule__scene">
                  <h3 className="schedule__scene-title">
                    {group.scene
                      ? [group.scene.number, group.scene.title || slugline(group.scene)]
                          .filter(Boolean)
                          .join(' · ')
                      : t('film.loose')}
                  </h3>
                  {items.map((frame) => (
                    <QueueShot
                      key={frame.id}
                      frame={frame}
                      label={labels.get(frame.id) ?? ''}
                      boardId={boardId}
                      disabled={disabled || !active}
                      onAdd={() => addShot(activeIndex, frame.id)}
                    />
                  ))}
                </section>
              );
            })}
          </aside>
          <div className="schedule__board" data-scroll>
            {!days.length ? (
              <div className="board-state">
                <EmptyState
                  icon="calendar"
                  title={t('schedule.emptyTitle')}
                  actions={
                    !readOnly && (
                      <Button variant="primary" icon="plus" disabled={busy} onClick={addDay}>
                        {t('schedule.addDay')}
                      </Button>
                    )
                  }
                >
                  {t(readOnly ? 'schedule.emptyReadOnly' : 'schedule.emptyBody')}
                </EmptyState>
              </div>
            ) : (
              <div className="schedule__days">
                {drafted.map(({ day, draft, dirty, stale }, index) => (
                  <DayColumn
                    key={day.id}
                    draft={draft}
                    index={index}
                    dirty={dirty}
                    stale={stale}
                    selected={day.id === active?.day.id}
                    selectedBlock={day.id === active?.day.id ? selection.block : null}
                    conflicts={conflicts}
                    shotTitle={shotTitle}
                    readOnly={readOnly}
                    onSelect={(block) => {
                      setSelection({ day: day.id, block });
                      setSheetOpen(true);
                    }}
                    onDrop={(payload) => {
                      const id = resolveDroppedShot(
                        payload,
                        boardId,
                        frames.map((frame) => frame.id),
                        disabled,
                      );
                      if (id) addShot(index, id);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          {active &&
            (phone
              ? // Phones have no room for a side panel: the day opens as a sheet over the plan.
                sheetOpen && (
                  <div className="phone-sheet">
                    <Dialog
                      open
                      title={`${t('schedule.dayNumber', { n: activeIndex + 1 })} · ${dayLabel(active.draft.date)}`}
                      onClose={() => setSheetOpen(false)}
                    >
                      {inspector}
                      <DialogActions>
                        <Button onClick={() => setSheetOpen(false)}>{t('shells.close')}</Button>
                      </DialogActions>
                    </Dialog>
                  </div>
                )
              : inspector)}
        </div>
      )}
      {callSheetOpen && (
        <CallSheetModal
          days={days}
          shots={callSheetShots}
          needed={neededOf}
          people={people}
          projectName={projectName}
          projectId={projectId}
          initialDayId={active?.day.id}
          unsaved={drafted.some((item) => item.dirty)}
          onClose={() => setCallSheetOpen(false)}
        />
      )}
    </section>
  );
}

/** A shot waiting for a day: drag it onto a day, or click it to add it to the selected day. */
function QueueShot({
  frame,
  label,
  boardId,
  disabled,
  onAdd,
}: {
  frame: FrameElement;
  label: string;
  boardId: string;
  disabled: boolean;
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
      <span className="schedule__shot-label">{label}</span>
      {frame.action && <span className="schedule__shot-action">{frame.action}</span>}
      {frame.durationMs !== undefined && (
        <span className="schedule__shot-meta">{formatDuration(frame.durationMs)}</span>
      )}
    </button>
  );
}

function DayColumn({
  draft,
  index,
  dirty,
  stale,
  selected,
  selectedBlock,
  conflicts,
  shotTitle,
  readOnly,
  onSelect,
  onDrop,
}: {
  draft: ShootingDayInput;
  index: number;
  dirty: boolean;
  stale: boolean;
  selected: boolean;
  selectedBlock: string | null;
  conflicts: Set<string>;
  shotTitle: (shotId: string) => string;
  readOnly: boolean;
  onSelect: (block: string | null) => void;
  onDrop: (payload: string) => void;
}) {
  const { t } = useTranslation();
  const dayLabel = useDayLabel();
  const [over, setOver] = useState(false);
  // Without a saved wrap time the day ends with its last block.
  const wrap = plannedWrap(draft);
  return (
    <section
      className={`schedule__day${selected ? ' is-selected' : ''}${over ? ' is-drop' : ''}`}
      aria-label={t('schedule.day', { date: draft.date })}
      onDragOver={(event) => {
        if (readOnly) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        // Moving over a child fires dragleave on the column too: only leaving it counts.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDrop(event.dataTransfer.getData(SHOT_DRAG_TYPE));
      }}
    >
      <button
        type="button"
        className="schedule__day-head"
        aria-pressed={selected && !selectedBlock}
        onClick={() => onSelect(null)}
      >
        <span className="schedule__day-date">{dayLabel(draft.date)}</span>
        <span className="schedule__day-sub">
          {[t('schedule.dayNumber', { n: index + 1 }), draft.location.trim().split('\n')[0]]
            .filter(Boolean)
            .join(' · ')}
          {dirty && ` · ${t('schedule.unsaved')}`}
        </span>
        {stale && <span className="schedule__flag">{t('schedule.staleFlag')}</span>}
      </button>
      <ol className="schedule__timeline">
        <li className="schedule__marker">
          {formatClock(draft.callTime)} {t('schedule.callRow')}
        </li>
        {scheduleTimes(draft).map(({ block, start, end }) => (
          <li
            key={block.id}
            className={`schedule__block schedule__block--${block.type}${conflicts.has(block.id) ? ' has-conflict' : ''}${selectedBlock === block.id ? ' is-selected' : ''}`}
            style={{ '--block-span': Math.min(block.duration, 240) } as CSSProperties}
          >
            <button
              type="button"
              className="schedule__block-select"
              aria-pressed={selectedBlock === block.id}
              onClick={() => onSelect(block.id)}
            >
              <strong>
                {clockLabel(start)} – {clockLabel(end)}
              </strong>
              <span className="schedule__block-title">
                {block.shotId
                  ? shotTitle(block.shotId)
                  : block.title || t(`schedule.types.${block.type}`)}
              </span>
              <span className="schedule__block-meta">
                {[
                  t(`schedule.types.${block.type}`),
                  minutesLabel(block.duration),
                  block.cast.join(', '),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {conflicts.has(block.id) && (
                <span className="schedule__flag">{t('schedule.castFlag')}</span>
              )}
            </button>
          </li>
        ))}
        {wrap !== null && (
          <li className="schedule__marker">
            {clockLabel(wrap)} {t('schedule.wrapRow')}
          </li>
        )}
      </ol>
      {!readOnly && <p className="schedule__drop">{t('schedule.dropHint')}</p>}
    </section>
  );
}

function DayInspector({
  day,
  draft,
  dirty,
  stale,
  index,
  blockId,
  conflicts,
  shotTitle,
  castSuggestions,
  readOnly,
  busy,
  tab,
  onTab,
  neededCount,
  needed,
  onChange,
  onSelectBlock,
  onSave,
  onReload,
  onKeep,
  onDelete,
}: {
  day: ShootingDay;
  draft: ShootingDayInput;
  dirty: boolean;
  stale: boolean;
  index: number;
  blockId: string | null;
  conflicts: Set<string>;
  shotTitle: (shotId: string) => string;
  castSuggestions: string[];
  readOnly: boolean;
  busy: boolean;
  tab: DayTab;
  onTab: (tab: DayTab) => void;
  neededCount: number;
  needed: ReactNode;
  onChange: (draft: ShootingDayInput) => void;
  onSelectBlock: (block: string | null) => void;
  onSave: () => Promise<void>;
  onReload: () => void;
  onKeep: () => void;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const dayLabel = useDayLabel();
  // Deleting a day or a filled block asks first: a misclick must not lose a day's work.
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'day' } | { kind: 'block'; id: string } | null
  >(null);
  const disabled = readOnly || busy;
  const valid = DaySchema.safeParse(draft).success;
  const slots = scheduleTimes(draft);
  const planned = slots.reduce((sum, slot) => sum + slot.block.duration, 0);
  const blockIndex = draft.blocks.findIndex((block) => block.id === blockId);
  const block = draft.blocks[blockIndex];
  const slot = slots[blockIndex];
  const wrapAuto = plannedWrap({ ...draft, wrap: null });
  const idBase = useId();
  const update = (patch: Partial<ShootingDayInput>) => onChange({ ...draft, ...patch });
  const blockUpdate = (id: string, patch: Partial<ScheduleBlock>) =>
    update({
      blocks: draft.blocks.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  const removeBlock = (id: string) => {
    update({ blocks: draft.blocks.filter((item) => item.id !== id) });
    onSelectBlock(null);
  };
  const move = (offset: number) => {
    const blocks = [...draft.blocks];
    const [moved] = blocks.splice(blockIndex, 1);
    if (moved) blocks.splice(blockIndex + offset, 0, moved);
    update({ blocks });
  };
  return (
    <aside className="schedule__inspector" aria-label={t('schedule.inspector')} data-scroll>
      <header className="schedule__inspector-head">
        <span className="story__sidebar-title">{t('schedule.dayNumber', { n: index + 1 })}</span>
        <h2>{dayLabel(draft.date)}</h2>
        <p className="schedule__summary">
          {t('schedule.summary', { count: draft.blocks.length, planned: minutesLabel(planned) })}
        </p>
      </header>
      <div className="schedule__tabs" role="tablist" aria-label={t('schedule.inspector')}>
        {(['plan', 'needed'] as const).map((value) => (
          <button
            key={value}
            id={`${idBase}-tab-${value}`}
            type="button"
            role="tab"
            className="schedule__tab"
            aria-selected={tab === value}
            aria-controls={`${idBase}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => onTab(value)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = value === 'plan' ? 'needed' : 'plan';
              onTab(next);
              document.getElementById(`${idBase}-tab-${next}`)?.focus();
            }}
          >
            {t(value === 'plan' ? 'callSheet.schedule' : 'needed.title')}
            {value === 'needed' && neededCount > 0 && (
              <span className="schedule__tab-count">{neededCount}</span>
            )}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${idBase}-panel`}
        aria-labelledby={`${idBase}-tab-${tab}`}
        className="schedule__panel"
      >
        {tab === 'needed' ? (
          needed
        ) : (
          <>
            {stale && !readOnly && (
              <div role="alert" className="schedule__stale">
                <p>{t('schedule.staleBody')}</p>
                <div className="schedule__actions">
                  <Button disabled={busy} onClick={onReload}>
                    {t('schedule.staleReload')}
                  </Button>
                  <Button variant="primary" disabled={busy} onClick={onKeep}>
                    {t('schedule.staleKeep')}
                  </Button>
                </div>
              </div>
            )}
            <fieldset disabled={disabled}>
              <legend className="ink-sr-only">{t('schedule.day', { date: draft.date })}</legend>
              <div className="schedule__fields">
                <label>
                  {t('schedule.date')}
                  <input
                    className="ink-input"
                    type="date"
                    required
                    value={draft.date}
                    onChange={(e) => update({ date: e.target.value })}
                  />
                </label>
                <label>
                  {t('schedule.callTime')}
                  <input
                    className="ink-input"
                    type="time"
                    required
                    value={draft.callTime}
                    onChange={(e) => update({ callTime: e.target.value })}
                  />
                </label>
                <label htmlFor={`${idBase}-wrap`}>
                  {t('schedule.wrap')}
                  <AutoTime
                    id={`${idBase}-wrap`}
                    value={draft.wrap}
                    computed={wrapAuto === null ? null : clockLabel(wrapAuto)}
                    autoLabel={t('schedule.auto')}
                    onChange={(wrap) => update({ wrap })}
                  />
                </label>
              </div>
              {/* The first line names the place; the next lines the address and how to get in. */}
              <div className="schedule__wide">
                <label htmlFor={`${idBase}-location`}>{t('schedule.location')}</label>
                <textarea
                  id={`${idBase}-location`}
                  className="ink-input"
                  rows={3}
                  maxLength={1000}
                  value={draft.location}
                  onChange={(e) => update({ location: e.target.value })}
                />
              </div>
              {/* Labels beside, not around, the text areas: their name stays the label alone. */}
              <div className="schedule__wide">
                <label htmlFor={`${idBase}-notes`}>{t('schedule.notes')}</label>
                <textarea
                  id={`${idBase}-notes`}
                  className="ink-input"
                  rows={3}
                  maxLength={10000}
                  value={draft.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </div>
              <h3 className="story__sidebar-title">{t('schedule.block')}</h3>
              {block ? (
                <div className="schedule__block-editor" key={block.id}>
                  {block.shotId && (
                    <p className="schedule__block-shot">{shotTitle(block.shotId)}</p>
                  )}
                  <div className="schedule__fields">
                    {/* biome-ignore lint/a11y/noLabelWithoutControl: Select renders a labelable button. */}
                    <label>
                      {t('schedule.type')}
                      <Select
                        className="ink-input"
                        value={block.type}
                        onChange={(e) =>
                          blockUpdate(block.id, { type: e as ScheduleBlock['type'] })
                        }
                      >
                        {(['setup', 'shot', 'break', 'move', 'note'] as const).map((type) => (
                          <option key={type} value={type}>
                            {t(`schedule.types.${type}`)}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label>
                      {t('schedule.title')}
                      <input
                        className="ink-input"
                        maxLength={500}
                        value={block.title}
                        onChange={(e) => blockUpdate(block.id, { title: e.target.value })}
                      />
                    </label>
                    <label htmlFor={`${idBase}-start`}>
                      {t('schedule.start')}
                      <AutoTime
                        key={block.id}
                        id={`${idBase}-start`}
                        value={block.start}
                        computed={slot ? clockLabel(slot.start) : null}
                        autoLabel={t('schedule.auto')}
                        onChange={(start) => blockUpdate(block.id, { start })}
                      />
                    </label>
                    <label>
                      {t('schedule.duration')}
                      <input
                        className="ink-input"
                        type="number"
                        min={1}
                        max={1440}
                        value={block.duration}
                        onChange={(e) =>
                          blockUpdate(block.id, { duration: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <label htmlFor={`${idBase}-cast`}>
                    {t('schedule.cast')}
                    <TokenField
                      id={`${idBase}-cast`}
                      values={block.cast}
                      suggestions={castSuggestions}
                      placeholder={t('schedule.castPlaceholder')}
                      disabled={disabled}
                      removeLabel={(name) => t('schedule.removeToken', { name })}
                      onChange={(cast) => blockUpdate(block.id, { cast })}
                    />
                  </label>
                  <label htmlFor={`${idBase}-departments`}>
                    {t('schedule.departments')}
                    <TokenField
                      id={`${idBase}-departments`}
                      values={block.departments}
                      placeholder={t('schedule.departmentsPlaceholder')}
                      disabled={disabled}
                      removeLabel={(name) => t('schedule.removeToken', { name })}
                      onChange={(departments) => blockUpdate(block.id, { departments })}
                    />
                  </label>
                  {conflicts.has(block.id) && (
                    <p role="status" className="schedule__error">
                      {t('schedule.castConflict')}
                    </p>
                  )}
                  {!readOnly && (
                    <div className="schedule__actions schedule__actions--block">
                      <Button disabled={blockIndex === 0} onClick={() => move(-1)}>
                        {t('schedule.up')}
                      </Button>
                      <Button
                        disabled={blockIndex === draft.blocks.length - 1}
                        onClick={() => move(1)}
                      >
                        {t('schedule.down')}
                      </Button>
                      <span className="ink-header__spacer" />
                      <Button
                        variant="ghost"
                        className="schedule__remove"
                        onClick={() => {
                          // An empty block carries nothing to lose: drop it without asking.
                          if (block.title.trim() || block.shotId) {
                            setPendingDelete({ kind: 'block', id: block.id });
                          } else {
                            removeBlock(block.id);
                          }
                        }}
                      >
                        {t('schedule.removeBlock')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="schedule__hint">
                  {t(draft.blocks.length ? 'schedule.blockHint' : 'schedule.noBlocks')}
                </p>
              )}
              {!readOnly && (
                <div className="schedule__actions">
                  <Button
                    icon="plus"
                    onClick={() => {
                      const next = newScheduleBlock('setup');
                      update({ blocks: [...draft.blocks, next] });
                      onSelectBlock(next.id);
                    }}
                  >
                    {t('schedule.addBlock')}
                  </Button>
                </div>
              )}
              {!readOnly && (
                <div className="schedule__save">
                  <Button
                    variant="primary"
                    block
                    disabled={!valid || stale}
                    onClick={() => onSave()}
                  >
                    {t('schedule.save')}
                  </Button>
                  {dirty && <span className="schedule__hint">{t('schedule.unsaved')}</span>}
                </div>
              )}
              {/* Away from the everyday actions, and confirmed in a dialog. */}
              {!readOnly && (
                <div className="schedule__danger">
                  <Button
                    variant="danger"
                    icon="trash"
                    onClick={() => setPendingDelete({ kind: 'day' })}
                  >
                    {t('schedule.deleteDay')}
                  </Button>
                </div>
              )}
            </fieldset>
          </>
        )}
      </div>
      {/* Outside the fieldset: a disabled fieldset would also disable the dialog buttons. */}
      <Dialog
        open={pendingDelete !== null}
        title={t(
          pendingDelete?.kind === 'block' ? 'schedule.removeBlockTitle' : 'schedule.deleteDayTitle',
        )}
        onClose={() => setPendingDelete(null)}
      >
        <p>
          {pendingDelete?.kind === 'block'
            ? t('schedule.removeBlockBody')
            : t('schedule.deleteDayBody', { date: day.date })}
        </p>
        <DialogActions>
          {/* First focusable element: the native dialog focuses it on open, and Escape closes. */}
          <Button disabled={disabled} onClick={() => setPendingDelete(null)}>
            {t('schedule.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={disabled}
            onClick={() => {
              const target = pendingDelete;
              setPendingDelete(null);
              if (target?.kind === 'block') removeBlock(target.id);
              else if (target?.kind === 'day') void onDelete();
            }}
          >
            {t('schedule.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </aside>
  );
}
