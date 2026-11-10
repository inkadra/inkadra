// SPDX-License-Identifier: AGPL-3.0-only
import { variantView } from '@inkadra/canvas-core';
import {
  ShootingDayInput as DaySchema,
  type Person,
  type ProjectMember,
  type Schedule,
  type ScheduleBlock,
  type ShootingDay,
  type ShootingDayInput,
} from '@inkadra/shared';
import {
  Button,
  Dialog,
  DialogActions,
  EmptyState,
  Icon,
  IconButton,
  Segmented,
} from '@inkadra/ui';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../../lib/api.ts';
import { formatClock } from '../../lib/datetime.ts';
import { useIsPhone } from '../../lib/phone.ts';
import { plansOfScene } from '../plan/scenes.tsx';
import { isMac, isTyping } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { useBoardAspect } from './aspect.ts';
import type { SheetScene } from './CallSheetModal.tsx';
import { CallSheetModal } from './CallSheetModal.tsx';
import {
  addDays,
  clockString,
  duplicateBlock,
  insertDrawnBlock,
  localDate,
  minutesLabel,
  moveDay,
  placeBlock,
  SHOT_DRAG_TYPE,
  sameScheduleInput as sameInput,
  weekDates,
  weekStart,
} from './calendar.ts';
import { plannedWrap } from './call-sheet.ts';
import { DayCallsPanel } from './DayCallsPanel.tsx';
import { dayCrew, useCrew } from './day-calls.ts';
import { NeededItems } from './NeededItems.tsx';
import { neededForDay, updateNeededRow } from './needed.ts';
import {
  type CalendarColumn,
  type CalendarDay,
  type DayChange,
  ScheduleCalendar,
} from './ScheduleCalendar.tsx';
import {
  BlockEditor,
  DayPanel,
  type DayTab,
  MoveDayDialog,
  ScheduleQueue,
  SunLine,
} from './ScheduleParts.tsx';
import { castConflicts, clockLabel, newScheduleBlock, nowOnDay, whileVisible } from './schedule.ts';
import { useSlugline, useStoryboard } from './storyboard-data.ts';
import { locationCoords, sunTimes } from './sun.ts';
import './film.css';
import './schedule.css';

export { SHOT_DRAG_TYPE };
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
  const { date, callTime, wrap, location, notes, blocks, calls } = day;
  // Calls come only to project members: without them the save leaves the stored ones alone.
  return { date, callTime, wrap, location, notes, blocks, ...(calls ? { calls } : {}) };
}

/** The day after the last shooting day, or today for the first one. */
function nextDate(days: readonly ShootingDay[]): string {
  const last = days.at(-1)?.date;
  return last ? addDays(last, 1) : localDate(new Date());
}

type Drafts = Record<string, { revision: number; draft: ShootingDayInput | null }>;
/** One step of undo: the days it changed, before and after. */
interface Step {
  key: string | undefined;
  at: number;
  days: Array<{
    id: string;
    day: ShootingDay;
    before: ShootingDayInput | null;
    after: ShootingDayInput | null;
  }>;
}
/** Typing in one field within this long is one step of undo. */
const COALESCE_MS = 1500;
/** An edit waits this long for the next before it is saved. */
const SAVE_DELAY = 600;
const RETRY_DELAY = 5000;

/** A draft for `day`, or none when it is back to the saved version. */
function withDraft(
  current: Drafts,
  day: ShootingDay,
  next: ShootingDayInput | null,
  pending = false,
): Drafts {
  const revision = current[day.id]?.revision ?? day.revision;
  if (!pending && revision === day.revision && next !== null && sameInput(next, inputOf(day))) {
    if (!current[day.id]) return current;
    const { [day.id]: _, ...rest } = current;
    return rest;
  }
  return { ...current, [day.id]: { revision, draft: next } };
}

export function ScheduleView({
  store,
  projectName,
  projectId,
  boardId = '',
  userId,
  readOnly = false,
  onOpenScene,
  onOpenTroupe,
}: {
  store: BoardStore;
  boardTitle?: string;
  projectName?: string;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly?: boolean;
  /** "Open in the storyboard" on a shot's block: the storyboard, scrolled to its scene. */
  onOpenScene?: (sceneId: string) => void;
  /** The empty "Convocazioni" tab links to the Troupe view. */
  onOpenTroupe?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const slugline = useSlugline();
  const { groups, frames, labels } = useStoryboard(store);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [days, setDays] = useState<ShootingDay[]>([]);
  // Unsaved edits per day, with the revision they started from. A draft is never dropped when
  // the server has a newer revision: it is flagged as stale until the user picks a version.
  const [drafts, setDrafts] = useState<Drafts>({});
  const [selection, setSelection] = useState<{ day: string | null; block: string | null }>({
    day: null,
    block: null,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<DayTab>('day');
  const [people, setPeople] = useState<Person[]>([]);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [retry, setRetry] = useState(0);
  const [history, setHistory] = useState<{ past: Step[]; future: Step[] }>({
    past: [],
    future: [],
  });
  const phone = useIsPhone();
  const crew = useCrew(projectId);
  const [chosenView, setView] = useState<'week' | 'day'>('week');
  const view = phone ? 'day' : chosenView;
  const [focus, setFocus] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ day: string; block: string; rect: DOMRect } | null>(
    null,
  );
  const [sheet, setSheet] = useState<'queue' | 'day' | 'block' | null>(null);
  // A day dragged by its heading: the date it would land on, also marked in the month.
  const [dayTarget, setDayTarget] = useState<string | null>(null);
  const [movingDay, setMovingDay] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'day'; id: string } | { kind: 'block'; day: string; id: string } | null
  >(null);
  const path = `/boards/${boardId}/schedule`;
  const daysRef = useRef(days);
  daysRef.current = days;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

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

  // Shooting days are saved over the API, not in the live board: they are fetched again while
  // the tab is in view and after a conflict, so there is no manual reload.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the Retry button.
  useEffect(() => {
    let active = true;
    const fetchDays = (initial: boolean) => {
      if (initial) setLoading(true);
      const started = new Map(daysRef.current.map((day) => [day.id, day.revision]));
      api
        .get<Schedule>(path)
        .then((data) => {
          if (!active) return;
          // A GET that started before a save can answer after it: keep the newer revision.
          setDays((current) =>
            [
              ...data.items,
              ...current
                .filter(
                  (day) =>
                    !data.items.some((item) => item.id === day.id) &&
                    (day.revision === 0 ||
                      !started.has(day.id) ||
                      day.revision > (started.get(day.id) ?? 0) ||
                      draftsRef.current[day.id]),
                )
                .map((day) =>
                  draftsRef.current[day.id] &&
                  started.has(day.id) &&
                  day.revision === started.get(day.id)
                    ? { ...day, revision: 0, updatedBy: null }
                    : day,
                ),
            ]
              .map((item) => {
                const mine = current.find((day) => day.id === item.id);
                return mine &&
                  data.items.some((day) => day.id === item.id) &&
                  mine.revision > item.revision
                  ? mine
                  : item;
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
                saved.draft !== null &&
                sameInput(saved.draft, inputOf(item))
              ) {
                delete next[item.id];
                changed = true;
              }
            }
            return changed ? next : current;
          });
          if (initial) setLoadError(false);
        })
        .catch(() => {
          if (active && initial) setLoadError(true);
        })
        .finally(() => {
          if (active && initial) setLoading(false);
        });
    };
    fetchDays(refresh === 0);
    const stop = whileVisible(() => fetchDays(false));
    return () => {
      active = false;
      stop();
    };
  }, [path, refresh, attempt]);

  const drafted: CalendarDay[] = useMemo(
    () =>
      days
        .filter(
          (day) => drafts[day.id]?.draft !== null || drafts[day.id]?.revision !== day.revision,
        )
        .map((day, index) => {
          const saved = drafts[day.id];
          return {
            day,
            index,
            dirty: !!saved,
            stale: !!saved && saved.revision !== day.revision,
            draft: saved?.draft ?? inputOf(day),
          };
        }),
    [days, drafts],
  );
  const conflicts = useMemo(() => castConflicts(drafted.map((d) => d.draft)), [drafted]);
  const scheduled = new Set(
    drafted.flatMap((d) => d.draft.blocks.map((block) => block.shotId).filter(Boolean)),
  );
  const now = useMinute(true);
  const today = localDate(now);
  // The calendar opens on the day being shot, else the next shooting day, else the last one.
  // Picked once, when the days arrive: it must not move under someone reading it.
  if (focus === null && !loading) {
    const current = drafted.find((d) => nowOnDay(d.draft, plannedWrap(d.draft), now) !== null);
    const next = drafted.find((d) => d.draft.date >= today) ?? drafted.at(-1);
    setFocus((current ?? next)?.draft.date ?? today);
  }
  const focusDate = focus ?? today;
  const shootingDates = new Set(drafted.map((d) => d.draft.date));
  const dates = view === 'week' ? weekDates(focusDate, shootingDates) : [focusDate];
  const columns = dates.flatMap((date): CalendarColumn[] => {
    const on = drafted.filter((d) => d.draft.date === date);
    return on.length ? on.map((entry) => ({ date, entry })) : [{ date, entry: null }];
  });
  const selectedEntry =
    drafted.find((d) => d.day.id === selection.day) ??
    drafted.find((d) => d.draft.date === focusDate) ??
    null;
  const disabled = readOnly || busy;
  const dayLong = (date: string, options: Intl.DateTimeFormatOptions) => {
    const time = Date.parse(`${date}T00:00:00Z`);
    return Number.isNaN(time)
      ? date
      : new Intl.DateTimeFormat(i18n.language, { ...options, timeZone: 'UTC' }).format(time);
  };
  const dayName = (entry: CalendarDay) =>
    `${t('schedule.dayNumber', { n: entry.index + 1 })} · ${dayLong(entry.draft.date, { weekday: 'short', day: 'numeric', month: 'short' })}`;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // --- Edits, undo and redo -------------------------------------------------------------------

  /** Every edit of a day goes through here: one step of undo, saved on its own after a moment. */
  const commit = (changes: DayChange[], key?: string) => {
    if (readOnly || !changes.length) return;
    const current = draftsRef.current;
    const step: Step = {
      key,
      at: Date.now(),
      days: changes.map(({ day, next }) => ({
        id: day.id,
        day,
        before: day.revision === 0 ? null : (current[day.id]?.draft ?? inputOf(day)),
        after: next,
      })),
    };
    let next = current;
    for (const change of changes)
      next = withDraft(next, change.day, change.next, !!saving[change.day.id]);
    draftsRef.current = next;
    setDrafts(next);
    setHistory(({ past }) => {
      const last = past.at(-1);
      // Typing in one field is one step, from its first letter.
      if (
        key &&
        last?.key === key &&
        step.at - last.at < COALESCE_MS &&
        last.days.length === step.days.length
      ) {
        const merged = {
          ...last,
          at: step.at,
          days: last.days.map((d, i) => ({ ...d, after: step.days[i]?.after ?? d.after })),
        };
        return { past: [...past.slice(0, -1), merged], future: [] };
      }
      return { past: [...past, step].slice(-200), future: [] };
    });
  };
  const travel = (direction: 'undo' | 'redo') => {
    if (readOnly) return;
    const from = direction === 'undo' ? history.past : history.future;
    const step = from.at(-1);
    if (!step) return;
    const blocked = step.days.some((change) => {
      const day = daysRef.current.find((item) => item.id === change.id);
      const draft = draftsRef.current[change.id];
      if (day && draft && draft.revision !== day.revision) return true;
      const current = draft ? draft.draft : day ? inputOf(day) : null;
      return !sameInput(current, direction === 'undo' ? change.after : change.before);
    });
    if (blocked) {
      setError(t('schedule.conflict'));
      return;
    }
    let next = draftsRef.current;
    for (const change of step.days) {
      let day = daysRef.current.find((item) => item.id === change.id);
      if (!day) {
        day = { ...change.day, revision: 0 };
        const restored = day;
        setDays((current) => [...current, restored].sort(byDate));
      }
      // Undo must never silently rebase an unresolved conflict.
      if (next[day.id] && next[day.id]?.revision !== day.revision) return;
      next = withDraft(
        next,
        day,
        direction === 'undo' ? change.before : change.after,
        !!saving[day.id],
      );
    }
    draftsRef.current = next;
    setDrafts(next);
    setHistory(({ past, future }) =>
      direction === 'undo'
        ? { past: past.slice(0, -1), future: [...future, step] }
        : { past: [...past, step], future: future.slice(0, -1) },
    );
    setNotice(t(direction === 'undo' ? 'schedule.undone' : 'schedule.redone'));
  };
  const travelRef = useRef(travel);
  travelRef.current = travel;
  // Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) outside text fields, which keep their own undo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac() ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      travelRef.current(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- Saving on its own ----------------------------------------------------------------------

  const savingRef = useRef(false);
  const saveDays = async (ready: ShootingDay[]) => {
    if (savingRef.current) return;
    const changes = ready.flatMap((day) => {
      const entry = draftsRef.current[day.id];
      return entry ? [{ id: day.id, revision: entry.revision, input: entry.draft }] : [];
    });
    if (!changes.length) return;
    savingRef.current = true;
    setSaving(Object.fromEntries(changes.map((change) => [change.id, true])));
    try {
      const first = changes[0];
      const result =
        changes.length === 1 && first && first.revision > 0 && first.input
          ? {
              items: [
                await api.put<ShootingDay>(`${path}/${first.id}`, {
                  ...first.input,
                  revision: first.revision,
                }),
              ],
              deleted: [] as string[],
            }
          : await api.post<{ items: ShootingDay[]; deleted: string[] }>(`${path}/edit`, {
              changes,
            });
      setDays((current) => {
        const items = new Map(result.items.map((day) => [day.id, day]));
        return current
          .flatMap((day) => {
            if (result.deleted.includes(day.id)) {
              // Undo during an in-flight deletion recreates the day on the next save.
              const pending = draftsRef.current[day.id]?.draft;
              return pending ? [{ ...day, revision: 0 }] : [];
            }
            const saved = items.get(day.id);
            return [saved && saved.revision >= day.revision ? saved : day];
          })
          .sort(byDate);
      });
      setDrafts((current) => {
        const next = { ...current };
        for (const change of changes) {
          const entry = next[change.id];
          if (!entry) continue;
          if (sameInput(entry.draft, change.input)) delete next[change.id];
          else
            next[change.id] = {
              ...entry,
              revision: result.items.find((day) => day.id === change.id)?.revision ?? 0,
            };
        }
        draftsRef.current = next;
        return next;
      });
      setFailed({});
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof RequestError && err.status === 409) {
        setFailed({});
        setRefresh((n) => n + 1);
      } else setFailed(Object.fromEntries(changes.map((change) => [change.id, true])));
    } finally {
      savingRef.current = false;
      setSaving({});
    }
  };
  const saveRef = useRef(saveDays);
  saveRef.current = saveDays;
  const failedAny = Object.keys(failed).length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `retry` asks for an attempt now.
  useEffect(() => {
    if (readOnly || savingRef.current) return;
    const ready = days.filter((day) => drafts[day.id]);
    // One gesture may touch several dates: commit all drafts or none, including conflicts.
    if (
      !ready.length ||
      ready.some((day) => {
        const entry = drafts[day.id];
        return (
          !entry ||
          entry.revision !== day.revision ||
          (entry.draft !== null && !DaySchema.safeParse(entry.draft).success)
        );
      })
    )
      return;
    const delay = ready.some((day) => failed[day.id]) ? RETRY_DELAY : SAVE_DELAY;
    const timer = window.setTimeout(() => void saveRef.current(ready), delay);
    return () => window.clearTimeout(timer);
  }, [days, drafts, saving, failed, readOnly, retry]);
  // Back online: try again at once.
  useEffect(() => {
    const online = () => setFailed({});
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);
  const unsaved = Object.keys(drafts).length > 0;
  // Closing the tab with edits not yet on the server asks first.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const staleCount = drafted.filter((d) => d.stale).length;
  const savingAny = Object.keys(saving).length > 0;

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
  const dropDraft = (day: ShootingDay) => {
    setDrafts(({ [day.id]: _, ...rest }) => rest);
    if (day.revision === 0) setDays((current) => current.filter((item) => item.id !== day.id));
  };
  // "Keep mine": the draft is rebased on the server revision, so it is saved over it.
  const keepDraft = (day: ShootingDay) =>
    setDrafts((current) => {
      const saved = current[day.id];
      return saved ? { ...current, [day.id]: { ...saved, revision: day.revision } } : current;
    });
  const addDay = () =>
    write(async () => {
      const free = view === 'day' && !shootingDates.has(focusDate);
      const day = await api.post<ShootingDay>(path, {
        date: free ? focusDate : nextDate(days),
        callTime: '08:00',
        wrap: null,
        location: '',
        notes: '',
        blocks: [],
      });
      setDays((current) => [...current, day].sort(byDate));
      setSelection({ day: day.id, block: null });
      setFocus(day.date);
      setTab('day');
    });
  const findEntry = (id: string) => drafted.find((d) => d.day.id === id);
  /** A shot from the queue, at `minute` or at the end of the day. */
  const addShot = (target: CalendarDay | null, shotId: string, minute?: number) => {
    if (!target || disabled || scheduled.has(shotId)) return;
    const { day, draft, stale } = target;
    if (stale) {
      setError(t('schedule.staleBlocked', { day: dayName(target) }));
      return;
    }
    const frame = frames.find((item) => item.id === shotId);
    if (!frame) return;
    const block = { ...newScheduleBlock('shot', shotId), cast: frame.cast ?? [] };
    const next =
      minute === undefined || !Number.isFinite(minute)
        ? { ...draft, blocks: [...draft.blocks, block] }
        : placeBlock(draft, block, minute, false);
    commit([{ day, next }]);
    setSelection({ day: day.id, block: block.id });
    // The day may be off-screen: say where the shot went.
    setNotice(t('schedule.addedTo', { shot: labels.get(shotId) ?? '', day: dayName(target) }));
  };
  const dropOnFreeDay = (
    date: string,
    minute: number,
    fixed: boolean,
    fromId: string | null,
    blockId: string | null,
    payload?: string,
  ) => {
    if (disabled || shootingDates.has(date)) return;
    const from = fromId ? findEntry(fromId) : null;
    const shotId = payload
      ? resolveDroppedShot(
          payload,
          boardId,
          frames.map((frame) => frame.id),
          disabled,
        )
      : null;
    const block = from
      ? from.draft.blocks.find((item) => item.id === blockId)
      : shotId && !scheduled.has(shotId)
        ? {
            ...newScheduleBlock('shot', shotId),
            cast: frames.find((frame) => frame.id === shotId)?.cast ?? [],
          }
        : null;
    if (!block || from?.stale) return;
    createDay(date, minute, fixed, block, from ?? null);
    setNotice(
      t('schedule.addedTo', { shot: block.title || shotTitle(block.shotId ?? ''), day: date }),
    );
  };
  /**
   * A shooting day created by a drop or a drawn block on a free date, called when the block
   * starts. Creation and the source edit share one undo step (0089).
   */
  const createDay = (
    date: string,
    minute: number,
    fixed: boolean,
    block: ScheduleBlock,
    from: CalendarDay | null,
  ) => {
    const input: ShootingDayInput = {
      date,
      callTime: clockString(Math.max(0, Math.min(1439, minute))),
      wrap: null,
      location: '',
      notes: '',
      blocks: [],
    };
    const day: ShootingDay = {
      ...input,
      id: crypto.randomUUID(),
      projectId: projectId ?? '',
      boardId,
      revision: 0,
    };
    const next = placeBlock(input, block, Math.max(0, minute), fixed);
    setDays((current) => [...current, day].sort(byDate));
    commit([
      ...(from
        ? [
            {
              day: from.day,
              next: {
                ...from.draft,
                blocks: from.draft.blocks.filter((item) => item.id !== block.id),
              },
            },
          ]
        : []),
      { day, next },
    ]);
    setSelection({ day: day.id, block: block.id });
  };
  /** A block drawn on empty time (phase 2), of the type picked in the menu. */
  const createBlock = (
    entry: CalendarDay | null,
    date: string,
    start: number,
    end: number,
    type: ScheduleBlock['type'],
  ): string | null => {
    if (disabled) return null;
    if (entry?.stale) {
      setError(t('schedule.staleBlocked', { day: dayName(entry) }));
      return null;
    }
    const block = { ...newScheduleBlock(type), duration: end - start };
    if (entry) {
      commit([{ day: entry.day, next: insertDrawnBlock(entry.draft, block, start) }]);
      setSelection({ day: entry.day.id, block: block.id });
    } else createDay(date, start, false, block, null);
    setNotice(
      t('schedule.created', {
        type: t(`schedule.types.${type}`),
        start: clockLabel(start),
        end: clockLabel(end),
      }),
    );
    return block.id;
  };
  /** A whole day to another date with its blocks (phase 3); a day already there swaps. */
  const moveDayTo = (id: string, date: string) => {
    if (disabled || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const changes = moveDay(drafted, id, date);
    const stale = changes.find((change) => change.entry.stale);
    if (stale) {
      setError(t('schedule.staleBlocked', { day: dayName(stale.entry) }));
      return;
    }
    const moved = changes[0];
    if (!moved) return;
    commit(changes.map((change) => ({ day: change.entry.day, next: change.next })));
    setSelection({ day: id, block: null });
    setFocus(date);
    const from = dayLong(moved.entry.draft.date, { weekday: 'short', day: 'numeric' });
    const to = dayLong(date, { weekday: 'short', day: 'numeric' });
    setNotice(t(changes.length > 1 ? 'schedule.daysSwapped' : 'schedule.dayMoved', { from, to }));
  };
  const addBlock = (target: CalendarDay | null) => {
    if (!target || disabled) return;
    const block = newScheduleBlock('setup');
    commit([
      { day: target.day, next: { ...target.draft, blocks: [...target.draft.blocks, block] } },
    ]);
    setSelection({ day: target.day.id, block: block.id });
    setTab('block');
    if (phone) setSheet('block');
  };
  const removeBlock = (dayId: string, blockId: string, ask = true) => {
    const entry = findEntry(dayId);
    const block = entry?.draft.blocks.find((item) => item.id === blockId);
    if (!entry || !block || readOnly) return;
    // An empty block carries nothing to lose: drop it without asking.
    if (ask && (block.title.trim() || block.shotId)) {
      setPendingDelete({ kind: 'block', day: dayId, id: blockId });
      return;
    }
    commit([
      {
        day: entry.day,
        next: { ...entry.draft, blocks: entry.draft.blocks.filter((b) => b.id !== blockId) },
      },
    ]);
    setSelection({ day: dayId, block: null });
    setPopover(null);
    if (sheet === 'block') setSheet(null);
    setNotice(t('schedule.blockRemoved'));
  };
  const duplicate = (dayId: string, blockId: string) => {
    const entry = findEntry(dayId);
    if (!entry || readOnly) return;
    const { day: next, id } = duplicateBlock(entry.draft, blockId);
    if (!id) return;
    commit([{ day: entry.day, next }]);
    setSelection({ day: dayId, block: id });
    setNotice(t('schedule.duplicated'));
  };
  const moveToDay = (fromId: string, blockId: string, toId: string) => {
    const from = findEntry(fromId);
    const to = findEntry(toId);
    const block = from?.draft.blocks.find((item) => item.id === blockId);
    if (!from || !to || !block || from === to || readOnly) return;
    commit([
      {
        day: from.day,
        next: { ...from.draft, blocks: from.draft.blocks.filter((b) => b.id !== blockId) },
      },
      {
        day: to.day,
        next: { ...to.draft, blocks: [...to.draft.blocks, { ...block, start: null }] },
      },
    ]);
    setSelection({ day: toId, block: blockId });
    setFocus(to.draft.date);
    setPopover(null);
    setNotice(t('schedule.movedTo', { day: dayName(to) }));
  };

  const frameOf = (id: string | null) => (id ? frames.find((f) => f.id === id) : undefined);
  const shotTitle = (shotId: string) => {
    const frame = frameOf(shotId);
    const label = labels.get(shotId) ?? t('schedule.missingShot');
    return frame?.action ? `${label} · ${frame.action}` : label;
  };
  const sceneOf = (shotId: string | null) =>
    groups.find((g) => g.frames.some((f) => f.id === shotId))?.scene ?? null;
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
  const neededOf = (day: ShootingDayInput) => neededForDay(day, snap.byId.values());
  const boardAspect = useBoardAspect(store.doc);
  /** The scenes a day shoots, in order, with their frames and set plan (#335 round 6, i). */
  const scenesOf = (day: ShootingDayInput): SheetScene[] => {
    const ids: string[] = [];
    for (const block of day.blocks) {
      const frame = block.shotId ? snap.byId.get(block.shotId) : undefined;
      if (frame?.type === 'frame' && frame.parent && !ids.includes(frame.parent))
        ids.push(frame.parent);
    }
    return ids.flatMap((id) => {
      const scene = snap.byId.get(id);
      if (scene?.type !== 'scene') return [];
      const plan = plansOfScene(snap.byId.values(), id)[0];
      const base = plan?.variantOf ? snap.byId.get(plan.variantOf) : undefined;
      const shot = groups.find((g) => g.scene?.id === id)?.frames ?? [];
      return [
        {
          id,
          title: t('needed.sceneNumber', { number: scene.number }),
          heading: slugline(scene),
          frames: shot.slice(0, 3).map((frame) => ({
            id: frame.id,
            label: labels.get(frame.id) ?? '',
            frame,
          })),
          plan: plan && base?.type === 'plan' ? variantView(plan, base) : plan,
          boardAspect,
        },
      ];
    });
  };
  const sunOf = (draft: ShootingDayInput) => {
    const coords = locationCoords(draft.location);
    return coords ? sunTimes(draft.date, coords.lat, coords.lng) : null;
  };

  // --- Navigation -----------------------------------------------------------------------------

  const step = (direction: -1 | 1) => {
    if (view === 'day') setFocus(addDays(focusDate, direction));
    else setFocus(addDays(weekStart(focusDate), direction * 7));
    setPopover(null);
  };
  const rangeTitle = (() => {
    if (view === 'day')
      return dayLong(focusDate, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    const first = dates[0] ?? focusDate;
    const last = dates.at(-1) ?? focusDate;
    const sameMonth = first.slice(0, 7) === last.slice(0, 7);
    return `${dayLong(first, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' })} – ${dayLong(last, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  })();
  const openDay = (entry: CalendarDay | null, date: string) => {
    setSelection({ day: entry?.day.id ?? null, block: null });
    setFocus(date);
    setPopover(null);
    if (phone) {
      if (entry) setSheet('day');
    } else setView('day');
    setTab('day');
  };
  const openBlock = (dayId: string, blockId: string, rect: DOMRect | null) => {
    const entry = findEntry(dayId);
    setSelection({ day: dayId, block: blockId });
    if (entry) setFocus(entry.draft.date);
    if (phone) setSheet('block');
    else if (view === 'day') setTab('block');
    else if (rect) setPopover({ day: dayId, block: blockId, rect });
  };

  const unscheduled = frames.filter((frame) => !scheduled.has(frame.id));
  const statusText = staleCount
    ? t('schedule.statusConflict')
    : failedAny
      ? t('schedule.statusUnsaved')
      : savingAny || unsaved
        ? t('schedule.statusSaving')
        : savedAt
          ? t('schedule.statusSaved', { time: formatClock(localClock(savedAt)) })
          : '';
  const failedCount = Object.keys(failed).length;
  const popoverEntry = popover ? findEntry(popover.day) : undefined;
  const popoverBlock = popoverEntry?.draft.blocks.find((b) => b.id === popover?.block);
  const sheetBlock = selectedEntry?.draft.blocks.find((b) => b.id === selection.block);
  const movingEntry = movingDay ? findEntry(movingDay) : undefined;

  const editorFor = (
    entry: CalendarDay,
    blockId: string,
    variant: 'popover' | 'sheet' | 'panel',
  ) => (
    <BlockEditor
      key={`${entry.day.id}-${blockId}`}
      variant={variant}
      entry={entry}
      blockId={blockId}
      days={drafted}
      conflicts={conflicts}
      readOnly={readOnly}
      castSuggestions={castSuggestions}
      shotTitle={shotTitle}
      frameOf={frameOf}
      sceneOf={sceneOf}
      slugline={slugline}
      boardAspect={boardAspect}
      dayName={dayName}
      onChange={(next, key) => commit([{ day: entry.day, next }], key)}
      onMove={(toId) => moveToDay(entry.day.id, blockId, toId)}
      onDuplicate={() => duplicate(entry.day.id, blockId)}
      onRemove={() => removeBlock(entry.day.id, blockId)}
      onOpenScene={onOpenScene}
      onDetails={() => {
        setPopover(null);
        setSelection({ day: entry.day.id, block: blockId });
        setFocus(entry.draft.date);
        setView('day');
        setTab('block');
      }}
      onClose={() => {
        setPopover(null);
        if (variant === 'sheet') setSheet(null);
      }}
    />
  );

  const neededRows = selectedEntry ? neededOf(selectedEntry.draft) : [];
  const panel = selectedEntry && (
    <DayPanel
      key={selectedEntry.day.id}
      entry={selectedEntry}
      total={drafted.length}
      blockId={selection.block}
      tab={tab}
      onTab={setTab}
      readOnly={readOnly}
      busy={busy}
      sun={sunOf(selectedEntry.draft)}
      neededCount={neededRows.length}
      callsCount={
        crew.items
          ? dayCrew(selectedEntry.draft, crew.items, snap.byId).filter((e) => e.called).length
          : undefined
      }
      calls={
        <DayCallsPanel
          entry={selectedEntry}
          crew={crew}
          elements={snap.byId}
          readOnly={readOnly}
          blockLabel={(blockId) => {
            const block = selectedEntry.draft.blocks.find((b) => b.id === blockId);
            return (block?.shotId && labels.get(block.shotId)) || block?.title || '';
          }}
          onChange={(next, key) => commit([{ day: selectedEntry.day, next }], key)}
          onOpenTroupe={onOpenTroupe}
        />
      }
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
      block={(id) => editorFor(selectedEntry, id, 'panel')}
      onChange={(next, key) => {
        commit([{ day: selectedEntry.day, next }], key);
        // A new date moves the calendar with the day.
        if (next.date !== selectedEntry.draft.date && /^\d{4}-\d{2}-\d{2}$/.test(next.date))
          setFocus(next.date);
      }}
      onAddBlock={() => addBlock(selectedEntry)}
      onReload={() => dropDraft(selectedEntry.day)}
      onKeep={() => keepDraft(selectedEntry.day)}
      onDelete={() => setPendingDelete({ kind: 'day', id: selectedEntry.day.id })}
      onMoveDate={() => setMovingDay(selectedEntry.day.id)}
    />
  );
  const queue = (
    <ScheduleQueue
      groups={groups}
      labels={labels}
      scheduled={scheduled}
      totalFrames={frames.length}
      boardId={boardId}
      boardAspect={boardAspect}
      slugline={slugline}
      plansOf={(id) => plansOfScene(snap.byId.values(), id)}
      readOnly={readOnly}
      disabled={disabled || !selectedEntry}
      loading={loading}
      failed={loadError}
      focusDate={focusDate}
      today={today}
      shootingDates={shootingDates}
      visibleDates={new Set(dates)}
      dropDate={dayTarget}
      onPickDate={(date) => {
        setFocus(date);
        setPopover(null);
      }}
      onAdd={(shotId) => {
        addShot(selectedEntry, shotId);
        if (phone) setSheet(null);
      }}
    />
  );
  const phoneDates = phone
    ? [...new Set([...shootingDates, focusDate].flatMap((d) => weekDates(d, shootingDates)))].sort()
    : [];
  const nowIn = (entry: CalendarDay) => nowOnDay(entry.draft, plannedWrap(entry.draft), now);

  return (
    <section
      className={`schedule schedule--${view}`}
      aria-label={t('nav.schedule')}
      data-tour="schedule"
    >
      <div className="story__bar schedule__bar" data-chrome>
        {phone ? (
          <>
            <Button icon="list" data-tour="schedule-queue" onClick={() => setSheet('queue')}>
              {t('schedule.queueShort')}
              <span className="schedule__count">{unscheduled.length}</span>
            </Button>
            <span className="ink-header__spacer" />
            {statusText && (
              <span role="status" className="schedule__status">
                {statusText}
              </span>
            )}
            <IconButton
              icon="file"
              label={t('shells.callSheet')}
              data-tour="schedule-callsheet"
              disabled={loading || loadError}
              onClick={() => setCallSheetOpen(true)}
            />
          </>
        ) : (
          <>
            <Button disabled={loading} onClick={() => setFocus(today)}>
              {t('schedule.today')}
            </Button>
            <span className="schedule__arrows">
              <IconButton
                icon="chevronLeft"
                label={t(view === 'day' ? 'schedule.previousDay' : 'schedule.previousWeek')}
                onClick={() => step(-1)}
              />
              <IconButton
                icon="chevronRight"
                label={t(view === 'day' ? 'schedule.nextDay' : 'schedule.nextWeek')}
                onClick={() => step(1)}
              />
            </span>
            <h2 className="schedule__range">{rangeTitle}</h2>
            <Segmented
              label={t('schedule.viewLabel')}
              value={view}
              onChange={(value) => {
                setView(value);
                setPopover(null);
              }}
              options={[
                { value: 'day', label: t('schedule.viewDay') },
                { value: 'week', label: t('schedule.viewWeek') },
              ]}
            />
            <span className="ink-header__spacer" />
            {statusText && (
              <span
                role="status"
                className={`schedule__status${staleCount || failedAny ? ' is-alert' : ''}`}
              >
                {!staleCount && !failedAny && !savingAny && !unsaved && (
                  <Icon name="check" size={14} />
                )}
                {statusText}
              </span>
            )}
            {!readOnly && (
              <span className="schedule__history" data-tour="schedule-save">
                <IconButton
                  icon="undo"
                  label={`${t('board.palette.undo')} (${isMac() ? '⌘' : 'Ctrl+'}Z)`}
                  disabled={!history.past.length}
                  onClick={() => travel('undo')}
                />
                <IconButton
                  icon="undo"
                  className="schedule__redo"
                  label={`${t('board.palette.redo')} (${isMac() ? '⌘⇧' : 'Ctrl+Shift+'}Z)`}
                  disabled={!history.future.length}
                  onClick={() => travel('redo')}
                />
              </span>
            )}
            <Button
              icon="file"
              data-tour="schedule-callsheet"
              disabled={loading || loadError}
              onClick={() => setCallSheetOpen(true)}
            >
              {t('shells.callSheet')}
            </Button>
            {!readOnly && (
              <Button
                variant="primary"
                icon="plus"
                disabled={busy || loading || loadError}
                onClick={addDay}
              >
                {t('schedule.addDayShort')}
              </Button>
            )}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="schedule__error">
          {error}
        </p>
      )}
      {failedAny && !readOnly && (
        <div role="alert" className="schedule__offline">
          <p>
            {t(navigator.onLine ? 'schedule.saveFailed' : 'schedule.offline', {
              count: failedCount,
            })}
          </p>
          <Button
            onClick={() => {
              for (const id of Object.keys(failed)) {
                const day = days.find((item) => item.id === id);
                if (day) dropDraft(day);
              }
              setFailed({});
            }}
          >
            {t('schedule.discard')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setFailed({});
              setRetry((n) => n + 1);
            }}
          >
            {t('schedule.retryNow')}
          </Button>
        </div>
      )}
      <p role="status" aria-live="polite" className="schedule__notice ink-sr-only">
        {notice}
      </p>
      <div className="story__main schedule__main">
        {!phone && queue}
        <div className="schedule__body">
          {phone && !loading && !loadError && (
            <PhoneDays
              dates={phoneDates}
              selected={focusDate}
              today={today}
              shooting={shootingDates}
              onSelect={(date) => {
                setFocus(date);
                setSelection({ day: null, block: null });
              }}
            />
          )}
          {phone && selectedEntry && (
            <button
              type="button"
              className="schedule__summary-card"
              onClick={() => setSheet('day')}
            >
              <span>
                <b>
                  {[
                    t('schedule.dayShort', { n: selectedEntry.index + 1 }),
                    selectedEntry.draft.location.trim().split('\n')[0],
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </b>
                <span>{daySummary(selectedEntry.draft, t)}</span>
                <SunLine sun={sunOf(selectedEntry.draft)} />
              </span>
              <span className="schedule__summary-link">{t('schedule.details')}</span>
            </button>
          )}
          {loadError ? (
            <div className="board-state">
              <EmptyState
                icon="warning"
                title={t('schedule.loadErrorTitle')}
                actions={
                  <Button
                    onClick={() => {
                      setLoadError(false);
                      setAttempt((n) => n + 1);
                    }}
                  >
                    {t('schedule.retry')}
                  </Button>
                }
              >
                {t('schedule.loadErrorBody')}
              </EmptyState>
            </div>
          ) : loading ? (
            <div className="schedule__loading" role="status" aria-label={t('schedule.loading')}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="schedule__loading-column">
                  <span className="ink-skeleton" />
                  <span className="ink-skeleton" />
                  <span className="ink-skeleton" />
                </div>
              ))}
            </div>
          ) : !days.length ? (
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
            <ScheduleCalendar
              view={view}
              phone={phone}
              columns={columns}
              days={drafted}
              today={today}
              now={now}
              nowIn={nowIn}
              conflicts={conflicts}
              selectedDay={selection.day}
              selectedBlock={selection.block}
              readOnly={readOnly}
              shotTitle={shotTitle}
              frameOf={frameOf}
              boardAspect={boardAspect}
              sunOf={sunOf}
              onOpenDay={openDay}
              onOpenBlock={openBlock}
              onChange={commit}
              onRemove={(dayId, blockId) => removeBlock(dayId, blockId)}
              onDuplicate={duplicate}
              onAnnounce={setNotice}
              onDropFree={dropOnFreeDay}
              onCreate={createBlock}
              onMoveDay={moveDayTo}
              onDayTarget={setDayTarget}
              onDropShot={(entry, payload, minute) => {
                const id = resolveDroppedShot(
                  payload,
                  boardId,
                  frames.map((frame) => frame.id),
                  disabled,
                );
                if (id) addShot(entry, id, minute);
              }}
            />
          )}
          {phone && !loading && !loadError && days.length > 0 && !readOnly && (
            <div className="schedule__phone-foot">
              <p>{t('schedule.phoneHint')}</p>
              <Button
                variant="primary"
                icon="plus"
                disabled={!selectedEntry || disabled}
                onClick={() => addBlock(selectedEntry)}
              >
                {t('schedule.addBlockShort')}
              </Button>
            </div>
          )}
        </div>
        {!phone && view === 'day' && panel}
      </div>
      {popover && popoverEntry && popoverBlock && !phone && (
        <BlockPopover
          rect={popover.rect}
          onClose={() => setPopover(null)}
          label={t('schedule.block')}
        >
          {editorFor(popoverEntry, popoverBlock.id, 'popover')}
        </BlockPopover>
      )}
      {phone && sheet === 'queue' && (
        <div className="phone-sheet">
          <Dialog open title={t('schedule.queue')} onClose={() => setSheet(null)}>
            {queue}
            <DialogActions>
              <Button onClick={() => setSheet(null)}>{t('shells.close')}</Button>
            </DialogActions>
          </Dialog>
        </div>
      )}
      {phone && sheet === 'day' && selectedEntry && (
        <div className="phone-sheet">
          <Dialog open title={dayName(selectedEntry)} onClose={() => setSheet(null)}>
            {panel}
            <DialogActions>
              <Button onClick={() => setSheet(null)}>{t('shells.close')}</Button>
            </DialogActions>
          </Dialog>
        </div>
      )}
      {phone && sheet === 'block' && selectedEntry && sheetBlock && (
        <div className="phone-sheet">
          <Dialog open title={t('schedule.block')} onClose={() => setSheet(null)}>
            {editorFor(selectedEntry, sheetBlock.id, 'sheet')}
          </Dialog>
        </div>
      )}
      {movingEntry && (
        <MoveDayDialog
          entry={movingEntry}
          days={drafted}
          dayName={dayName}
          onClose={() => setMovingDay(null)}
          onMove={(date) => {
            setMovingDay(null);
            if (phone) setSheet(null);
            moveDayTo(movingEntry.day.id, date);
          }}
        />
      )}
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
            : t('schedule.deleteDayBody', {
                date: days.find((d) => d.id === pendingDelete?.id)?.date ?? '',
              })}
        </p>
        <DialogActions>
          {/* First focusable element: the native dialog focuses it on open, and Escape closes. */}
          <Button disabled={busy} onClick={() => setPendingDelete(null)}>
            {t('schedule.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              const target = pendingDelete;
              setPendingDelete(null);
              if (target?.kind === 'block') removeBlock(target.day, target.id, false);
              else if (target?.kind === 'day')
                void write(async () => {
                  const day = days.find((item) => item.id === target.id);
                  if (!day) return;
                  await api.delete(`${path}/${day.id}`, { revision: day.revision });
                  setDays((current) => current.filter((item) => item.id !== day.id));
                  dropDraft(day);
                  setSelection({ day: null, block: null });
                  setSheet(null);
                });
            }}
          >
            {t('schedule.delete')}
          </Button>
        </DialogActions>
      </Dialog>
      {callSheetOpen && (
        <CallSheetModal
          store={store}
          days={days}
          shots={callSheetShots}
          needed={neededOf}
          scenes={scenesOf}
          people={people}
          projectName={projectName}
          projectId={projectId}
          boardId={boardId}
          userId={userId}
          canManage={!readOnly}
          crew={crew.items ?? undefined}
          initialDayId={selectedEntry?.day.id}
          unsaved={unsaved}
          onClose={() => setCallSheetOpen(false)}
        />
      )}
    </section>
  );
}

const localClock = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** "07:00 – 16:10 · 9h 10 · 11 blocchi". */
export function daySummary(
  draft: ShootingDayInput,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const call = clockOf(draft.callTime);
  const end = plannedWrap(draft);
  return [
    end === null
      ? formatClock(draft.callTime)
      : `${formatClock(draft.callTime)} – ${clockText(end)}`,
    end !== null && end > call ? minutesLabel(end - call) : '',
    t('schedule.blocks', { count: draft.blocks.length }),
  ]
    .filter(Boolean)
    .join(' · ');
}
const clockOf = (time: string) => {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
};
function clockText(minutes: number) {
  const day = Math.floor(minutes / 1440);
  const local = minutes % 1440;
  const clock = `${String(Math.floor(local / 60)).padStart(2, '0')}:${String(local % 60).padStart(2, '0')}`;
  return `${formatClock(clock)}${day ? ` (+${day})` : ''}`;
}

/** The days of the weeks being shot, as a row of chips on a phone that shows one day. */
function PhoneDays({
  dates,
  selected,
  today,
  shooting,
  onSelect,
}: {
  dates: readonly string[];
  selected: string;
  today: string;
  shooting: ReadonlySet<string>;
  onSelect: (date: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const part = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.language, { ...options, timeZone: 'UTC' }).format(
      Date.parse(`${date}T00:00:00Z`),
    );
  const row = useRef<HTMLFieldSetElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the choice changes.
  useEffect(() => {
    row.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [selected]);
  return (
    <fieldset className="schedule__picker" ref={row}>
      <legend className="ink-sr-only">{t('schedule.pickDay')}</legend>
      {dates.map((date) => (
        <button
          key={date}
          type="button"
          className={`schedule__picker-day${shooting.has(date) ? ' has-shoot' : ''}${date === today ? ' is-today' : ''}`}
          aria-pressed={date === selected}
          aria-label={`${part(date, { weekday: 'long', day: 'numeric', month: 'long' })}${shooting.has(date) ? '' : ` · ${t('schedule.noShoot')}`}`}
          onClick={() => onSelect(date)}
        >
          <span>{part(date, { weekday: 'short' })}</span>
          <b>{part(date, { day: 'numeric' })}</b>
        </button>
      ))}
    </fieldset>
  );
}

/** The quick editor of a block, next to it; Escape or a press outside closes it. */
function BlockPopover({
  rect,
  label,
  onClose,
  children,
}: {
  rect: DOMRect;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const gap = 8;
    const right = rect.right + gap + width <= window.innerWidth - 8;
    const left = right ? rect.right + gap : Math.max(8, rect.left - gap - width);
    const top = Math.min(Math.max(8, rect.top), window.innerHeight - height - 8);
    setPlace({ left, top: Math.max(8, top) });
    el.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
  }, [rect]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (ref.current?.contains(target) || target?.closest?.('.ink-select__panel, dialog')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="schedule__popover ink-motion-pop"
      role="dialog"
      aria-label={label}
      data-scroll
      style={place ?? { left: -9999, top: 0 }}
    >
      {children}
    </div>
  );
}

/** The current minute, kept fresh; the first render reads the clock once. */
function useMinute(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}
