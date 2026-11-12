// SPDX-License-Identifier: AGPL-3.0-only
import type { ScheduleBlock, ShootingDay, ShootingDayInput } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { formatClock } from '../../lib/datetime.ts';
import { ContextMenu } from '../chrome.tsx';
import { insideDialog, isMac, isTyping } from '../shortcuts.ts';
import {
  addDays,
  blockBox,
  blockDetail,
  drawnRange,
  gapsBeforeFixed,
  layoutLanes,
  minutesLabel,
  moveBlock,
  moveBlockToDay,
  placeAnnotation,
  resizeBlock,
  SHOT_DRAG_TYPE,
  SNAP,
  shiftBlock,
  snap,
} from './calendar.ts';
import { locationsOfDay, plannedWrap } from './call-sheet.ts';
import { FramePicture } from './FramePicture.tsx';
import { clockLabel, clockMinutes, scheduleTimes } from './schedule.ts';
import type { BlockLook } from './schedule-sources.tsx';

export interface CalendarDay {
  day: ShootingDay;
  /** Position among all shooting days, for "G1". */
  index: number;
  draft: ShootingDayInput;
  dirty: boolean;
  stale: boolean;
}
export interface CalendarColumn {
  date: string;
  /** Null for a date without shooting. */
  entry: CalendarDay | null;
}
export interface DayChange {
  day: ShootingDay;
  next: ShootingDayInput;
}
type Sun = { sunrise: number | null; sunset: number | null } | null;

/** Keep short blocks inside their time slot; the accessible name retains all details. */
const MIN_HEIGHT = 1;
/** Below this a block is one line: time and title side by side. */
const TWO_LINES = 40;
/** A long press that picks a block up on a touch screen. */
const LONG_PRESS = 400;

interface Drag {
  kind: 'move' | 'resize';
  pointerId: number;
  dayId: string;
  blockId: string;
  x: number;
  y: number;
  /** Minutes between the block's top and the pointer. */
  grab: number;
  base: number;
  touch: boolean;
  active: boolean;
  target: string;
  minute: number;
  fixed: boolean;
  duration: number;
  bounds: { top: number; left: number } | null;
}

/** A new block drawn on empty time, while the pointer is down (phase 2). */
interface Draw {
  pointerId: number;
  /** The column: a day's id, or the date of a column without shooting. */
  column: string;
  from: number;
  to: number;
  x: number;
  y: number;
  active: boolean;
}
/** The type menu of a new block, after the drag or the N key. */
interface Creating {
  column: string;
  start: number;
  end: number;
  left: number;
  top: number;
  /** Where Escape puts the focus back. */
  origin: HTMLElement | null;
}
/** A whole day dragged by its heading (phase 3). */
interface DayDrag {
  pointerId: number;
  id: string;
  date: string;
  x: number;
  y: number;
  active: boolean;
  /** The date under the pointer: a column, a heading or a day of the month. */
  target: string | null;
  /** Where the pointer is now, for the label beside it. */
  px: number;
  py: number;
  /** The heading, which keeps the pointer once the drag starts. */
  el: HTMLElement;
}
/** The order of the type menu; keys 1 to 5 pick them. */
const NEW_TYPES = ['shot', 'setup', 'break', 'move', 'note'] as const;
/** About the height of the type menu, to open it above the block near the bottom. */
const MENU_HEIGHT = 200;

export function ScheduleCalendar({
  view,
  phone,
  scale,
  hotDay,
  notesOf,
  onHotDay,
  columns,
  days,
  today,
  now,
  nowIn,
  conflicts,
  selectedDay,
  selectedBlock,
  readOnly,
  blockTitle,
  look,
  sunOf,
  onOpenDay,
  onOpenBlock,
  onChange,
  onRemove,
  onDuplicate,
  onAnnounce,
  onDropShot,
  onDropFree,
  onCreate,
  onMoveDay,
  onDayTarget,
}: {
  view: 'week' | 'day';
  phone: boolean;
  /** Pixels per minute of the hour grid: the density the person chose. */
  scale: number;
  /** The day whose conflicts are shown, after a press on its "N conflicts". */
  hotDay: string | null;
  /** One line per double booking of a day, for the note under its "N conflicts". */
  notesOf: (entry: CalendarDay) => string[];
  onHotDay: (dayId: string | null) => void;
  columns: CalendarColumn[];
  /** Every shooting day, for moving a block to the next one with the keys. */
  days: CalendarDay[];
  today: string;
  now: Date;
  nowIn: (entry: CalendarDay) => number | null;
  conflicts: Set<string>;
  selectedDay: string | null;
  selectedBlock: string | null;
  readOnly: boolean;
  /** The name of a block: its frame or scene, read from its own storyboard, else its title. */
  blockTitle: (block: ScheduleBlock) => string;
  /** The frame or scene a block plans, with the dot of its storyboard (decision 0123). */
  look: (block: ScheduleBlock) => BlockLook | null;
  sunOf: (draft: ShootingDayInput) => Sun;
  onOpenDay: (entry: CalendarDay | null, date: string) => void;
  onOpenBlock: (dayId: string, blockId: string, rect: DOMRect | null) => void;
  onChange: (changes: DayChange[], key?: string) => void;
  onRemove: (dayId: string, blockId: string) => void;
  onDuplicate: (dayId: string, blockId: string) => void;
  onAnnounce: (text: string) => void;
  onDropFree: (
    date: string,
    minute: number,
    fixed: boolean,
    fromId: string | null,
    blockId: string | null,
    payload?: string,
  ) => void;
  onDropShot: (entry: CalendarDay, payload: string, minute: number) => void;
  /** A block drawn on empty time; returns its id. A date without shooting gets a day first. */
  onCreate: (
    entry: CalendarDay | null,
    date: string,
    start: number,
    end: number,
    type: ScheduleBlock['type'],
  ) => string | null;
  /** A whole day to another date; a day already there takes its date. */
  onMoveDay: (dayId: string, date: string) => void;
  /** The date a dragged day would land on, for the month in the queue. */
  onDayTarget: (date: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const grid = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const columnRefs = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  /** A drag dropped with Escape: its release must not click what is under it. */
  const cancelled = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const [dropAt, setDropAt] = useState<{ day: string; minute: number } | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const drawRef = useRef<Draw | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [dayDrag, setDayDrag] = useState<DayDrag | null>(null);
  const dayDragRef = useRef<DayDrag | null>(null);

  const entries = columns.flatMap((c) => (c.entry ? [c.entry] : []));
  /** A free day of the week is a narrow column (option 1); the Day view keeps it whole. */
  const narrow = (column: CalendarColumn) => view === 'week' && !column.entry;
  const template = columns
    .map((column) => (narrow(column) ? 'var(--schedule-narrow)' : 'var(--schedule-column)'))
    .join(' ');
  /** Scrolls the first double-booked block of a day into view, with room for its note above. */
  const revealConflicts = (entry: CalendarDay) => {
    const first = scheduleTimes(entry.draft).find((slot) => conflicts.has(slot.block.id));
    const el = grid.current;
    if (!first || !el) return;
    const y = first.start * scale;
    if (y - 90 < el.scrollTop || y + 40 > el.scrollTop + el.clientHeight)
      el.scrollTop = Math.max(0, y - 120);
  };
  const typeName = (type: ScheduleBlock['type']) => t(`schedule.types.${type}`);
  /** A block's accessible name, also its tooltip: title, storyboard, whole range, type, flags. */
  const blockLabel = (
    block: ScheduleBlock,
    start: number,
    end: number,
    conflict: boolean,
    seen: BlockLook | null,
  ) =>
    [
      blockTitle(block),
      seen?.dot?.name ?? '',
      `${clockLabel(start)} – ${clockLabel(end)}`,
      typeName(block.type),
      block.start !== null ? t('schedule.fixed') : '',
      conflict ? t('schedule.castFlag') : '',
    ]
      .filter(Boolean)
      .join(', ');
  const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.language, { ...options, timeZone: 'UTC' }).format(
      Date.parse(`${date}T00:00:00Z`),
    );

  // The edit a drag would make, drawn live: the blocks after it move as they will.
  const preview = (() => {
    if (!drag?.active) return new Map<string, ShootingDayInput>();
    const from = days.find((d) => d.day.id === drag.dayId);
    if (!from) return new Map<string, ShootingDayInput>();
    if (drag.kind === 'resize')
      return new Map([[from.day.id, resizeBlock(from.draft, drag.blockId, drag.duration)]]);
    if (drag.target === drag.dayId)
      return new Map([[from.day.id, moveBlock(from.draft, drag.blockId, drag.minute, drag.fixed)]]);
    const to = days.find((d) => d.day.id === drag.target);
    if (!to) return new Map<string, ShootingDayInput>();
    const moved = moveBlockToDay(from.draft, to.draft, drag.blockId, drag.minute, drag.fixed);
    return new Map([
      [from.day.id, moved.from],
      [to.day.id, moved.to],
    ]);
  })();
  const shown = (entry: CalendarDay) => preview.get(entry.day.id) ?? entry.draft;

  // The grid runs from midnight to the end of the latest night shoot on screen.
  const lastEnd = Math.max(
    1440,
    ...entries.map((entry) => {
      const draft = shown(entry);
      return Math.max(plannedWrap(draft) ?? 0, ...scheduleTimes(draft).map((s) => s.end));
    }),
  );
  const rangeEnd = Math.ceil(lastEnd / 60) * 60;
  // A week without shooting opens on the morning.
  const firstCall = entries.length
    ? Math.min(...entries.map((e) => clockMinutes(e.draft.callTime)))
    : 8 * 60;
  // Open on the earliest call of what is on screen, once per week or day shown.
  // A new density keeps the same morning in view.
  const shownKey = `${columns.map((c) => c.date).join()}|${scale}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the dates change.
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    // Half a label above the first line: an hour's label is centred on its line.
    el.scrollTop = Math.max(0, (firstCall - 30) * scale - 10);
    setViewport({ top: el.scrollTop, height: el.clientHeight });
  }, [shownKey]);

  const announce = (entry: CalendarDay, draft: ShootingDayInput, blockId: string) => {
    const slot = scheduleTimes(draft).find((s) => s.block.id === blockId);
    if (!slot) return;
    onAnnounce(
      t('schedule.announce', {
        block: blockTitle(slot.block),
        start: clockLabel(slot.start),
        end: clockLabel(slot.end),
        day: dateLabel(draft.date, { weekday: 'long', day: 'numeric' }),
        n: entry.index + 1,
      }),
    );
  };

  // --- Pointer: drag to reorder or move, Alt for a fixed time; the bottom edge resizes -----------

  const columnAt = (x: number) => {
    for (const [id, el] of columnRefs.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return { id, top: r.top };
    }
    return null;
  };
  const update = useCallback((next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);
  const begin = (
    event: PointerEvent<HTMLElement>,
    kind: Drag['kind'],
    entry: CalendarDay,
    block: ScheduleBlock,
    blockStart: number,
  ) => {
    if (readOnly || entry.stale || event.button !== 0) return;
    const column = columnRefs.current.get(entry.day.id)?.getBoundingClientRect();
    if (!column) return;
    const touch = event.pointerType === 'touch';
    if (!touch) event.preventDefault();
    const pointerMinute = (event.clientY - column.top) / scale;
    const next: Drag = {
      kind,
      pointerId: event.pointerId,
      dayId: entry.day.id,
      blockId: block.id,
      x: event.clientX,
      y: event.clientY,
      grab: pointerMinute - blockStart,
      base: block.duration,
      touch,
      active: false,
      target: entry.day.id,
      minute: blockStart,
      fixed: false,
      duration: block.duration,
      bounds: null,
    };
    if (kind === 'resize') {
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      update({ ...next, active: true });
      return;
    }
    update(next);
    if (touch) {
      // A finger scrolls the plan; holding it still on a block picks the block up.
      window.clearTimeout(pressTimer.current);
      pressTimer.current = window.setTimeout(() => {
        const current = dragRef.current;
        if (!current || current.blockId !== block.id) return;
        navigator.vibrate?.(10);
        update({ ...current, active: true });
      }, LONG_PRESS);
    }
  };
  const autoScroll = (y: number) => {
    const el = grid.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (y < r.top + 32) el.scrollTop -= 12;
    else if (y > r.bottom - 32) el.scrollTop += 12;
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const drawing = drawRef.current;
    if (drawing && event.pointerId === drawing.pointerId) {
      const column = columnRefs.current.get(drawing.column);
      if (!column) return;
      if (!drawing.active) {
        if (Math.hypot(event.clientX - drawing.x, event.clientY - drawing.y) < 4) return;
        column.setPointerCapture?.(event.pointerId);
      }
      autoScroll(event.clientY);
      const top = column.getBoundingClientRect().top;
      updateDraw({ ...drawing, active: true, to: (event.clientY - top) / scale });
      return;
    }
    const moving = dayDragRef.current;
    if (moving && event.pointerId === moving.pointerId) {
      if (!moving.active) {
        if (Math.hypot(event.clientX - moving.x, event.clientY - moving.y) < 4) return;
        moving.el.setPointerCapture?.(event.pointerId);
      }
      const target =
        document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>('[data-day-drop]')?.dataset.dayDrop ?? null;
      if (target !== moving.target) onDayTarget(target);
      updateDayDrag({
        ...moving,
        active: true,
        target,
        px: event.clientX,
        py: event.clientY,
      });
      return;
    }
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.active) {
      if (current.touch) {
        // Moving before the long press is a scroll.
        if (Math.hypot(dx, dy) > 8) {
          window.clearTimeout(pressTimer.current);
          update(null);
        }
        return;
      }
      if (Math.hypot(dx, dy) < 4) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    autoScroll(event.clientY);
    if (current.kind === 'resize') {
      const step = event.shiftKey ? 1 : SNAP;
      const duration = Math.min(1440, Math.max(1, snap(current.base + dy / scale, step)));
      update({ ...current, active: true, duration });
      return;
    }
    const column = (!phone && columnAt(event.clientX)) || {
      id: current.dayId,
      top: columnRefs.current.get(current.dayId)?.getBoundingClientRect().top ?? 0,
    };
    const minute = snap((event.clientY - column.top) / scale - current.grab);
    update({
      ...current,
      active: true,
      target: column.id,
      minute,
      fixed: event.altKey,
      bounds: { top: event.clientY, left: event.clientX },
    });
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    if (cancelled.current === event.pointerId) {
      cancelled.current = null;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      });
    }
    const drawing = drawRef.current;
    if (drawing && event.pointerId === drawing.pointerId) {
      updateDraw(null);
      const column = columnRefs.current.get(drawing.column)?.getBoundingClientRect();
      if (!drawing.active || !column) return;
      const { start, end } = drawnRange(drawing.from, drawing.to);
      openCreating(
        drawing.column,
        start,
        end,
        {
          left: column.left + 12,
          top: column.top + start * scale,
          bottom: column.top + end * scale,
        },
        null,
      );
      return;
    }
    const moving = dayDragRef.current;
    if (moving && event.pointerId === moving.pointerId) {
      updateDayDrag(null);
      onDayTarget(null);
      if (!moving.active) return;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      });
      if (moving.target && moving.target !== moving.date) onMoveDay(moving.id, moving.target);
      return;
    }
    const current = dragRef.current;
    window.clearTimeout(pressTimer.current);
    if (!current || event.pointerId !== current.pointerId) return;
    update(null);
    if (!current.active) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    });
    const from = days.find((d) => d.day.id === current.dayId);
    if (!from) return;
    if (current.kind === 'resize') {
      if (current.duration === current.base) return;
      const next = resizeBlock(from.draft, current.blockId, current.duration);
      onChange([{ day: from.day, next }]);
      announce(from, next, current.blockId);
      return;
    }
    const to = days.find((d) => d.day.id === current.target);
    if (!to) {
      const column = columns.find((item) => item.date === current.target && !item.entry);
      if (column)
        onDropFree(column.date, current.minute, current.fixed, from.day.id, current.blockId);
      return;
    }
    if (to.stale) return;
    if (to === from) {
      const next = moveBlock(from.draft, current.blockId, current.minute, current.fixed);
      onChange([{ day: from.day, next }]);
      announce(from, next, current.blockId);
    } else {
      const moved = moveBlockToDay(
        from.draft,
        to.draft,
        current.blockId,
        current.minute,
        current.fixed,
      );
      onChange([
        { day: from.day, next: moved.from },
        { day: to.day, next: moved.to },
      ]);
      announce(to, moved.to, current.blockId);
    }
  };
  const updateDraw = useCallback((next: Draw | null) => {
    drawRef.current = next;
    setDraw(next);
  }, []);
  const updateDayDrag = useCallback((next: DayDrag | null) => {
    dayDragRef.current = next;
    setDayDrag(next);
  }, []);
  const cancel = useCallback(() => {
    window.clearTimeout(pressTimer.current);
    const active = [dragRef.current, drawRef.current, dayDragRef.current].find((d) => d?.active);
    cancelled.current = active ? active.pointerId : null;
    update(null);
    updateDraw(null);
    if (dayDragRef.current) onDayTarget(null);
    updateDayDrag(null);
  }, [update, updateDraw, updateDayDrag, onDayTarget]);
  useEffect(() => () => window.clearTimeout(pressTimer.current), []);
  // Escape drops a drag where it started.
  useEffect(() => {
    if (!drag?.active) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
      // Alt pressed or released while still: show the fixed time at once.
      if (event.key === 'Alt') {
        const current = dragRef.current;
        if (current?.kind === 'move') update({ ...current, fixed: event.type === 'keydown' });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [drag?.active, cancel, update]);
  // Escape also drops a new block being drawn and a day being moved.
  useEffect(() => {
    if (!draw?.active && !dayDrag?.active) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draw?.active, dayDrag?.active, cancel]);
  // A finger that picked a block up must not also scroll the plan.
  useEffect(() => {
    const el = grid.current;
    if (!el || !drag?.active || !drag.touch) return;
    const stop = (event: TouchEvent) => event.preventDefault();
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, [drag?.active, drag?.touch]);

  // --- A new block drawn on empty time, then its type (phase 2) ----------------------------------

  const columnKey = (column: CalendarColumn) => column.entry?.day.id ?? column.date;
  const beginDraw = (event: PointerEvent<HTMLElement>, column: CalendarColumn) => {
    // Phones have the "+ Block" button; a finger on the grid scrolls it.
    if (readOnly || phone || column.entry?.stale || event.button !== 0) return;
    if (event.pointerType === 'touch') return;
    if ((event.target as Element).closest('.schedule__block, button')) return;
    const top = event.currentTarget.getBoundingClientRect().top;
    const minute = (event.clientY - top) / scale;
    event.preventDefault();
    setCreating(null);
    updateDraw({
      pointerId: event.pointerId,
      column: columnKey(column),
      from: minute,
      to: minute,
      x: event.clientX,
      y: event.clientY,
      active: false,
    });
  };
  /** The type menu under the new block, or above it near the bottom of the window. */
  const openCreating = (
    column: string,
    start: number,
    end: number,
    rect: { left: number; top: number; bottom: number },
    origin: HTMLElement | null,
  ) => {
    // The phone's list adds blocks with its "+ Block" button.
    if (phone) return;
    const below = rect.bottom + 6;
    const top =
      below + MENU_HEIGHT > window.innerHeight - 8
        ? Math.max(8, rect.top - 6 - MENU_HEIGHT)
        : below;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 218));
    setCreating({ column, start, end, left, top, origin });
  };
  const create = (type: ScheduleBlock['type']) => {
    const current = creating;
    setCreating(null);
    const column = current && columns.find((item) => columnKey(item) === current.column);
    if (!current || !column) return;
    const id = onCreate(column.entry, column.date, current.start, current.end, type);
    if (id) focusBlock(id);
  };
  const createRef = useRef(create);
  createRef.current = create;
  // Keys 1 to 5 pick the type while the menu is open.
  useEffect(() => {
    if (!creating) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const type = NEW_TYPES[Number(event.key) - 1];
      if (!type || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      createRef.current(type);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating]);
  /** The new block being drawn, or waiting for its type, in `column`. */
  const pending = (column: string) => {
    if (draw?.active && draw.column === column) return drawnRange(draw.from, draw.to);
    return creating?.column === column ? creating : null;
  };
  /** Scrolls the grid so that `minute` is in view, for a block added with the keys. */
  const reveal = (minute: number) => {
    const el = grid.current;
    if (!el) return;
    const y = minute * scale;
    if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - 60)
      el.scrollTop = Math.max(0, y - 60);
  };

  // --- A whole day moved by its heading (phase 3) -------------------------------------------------

  const beginDayDrag = (event: PointerEvent<HTMLElement>, entry: CalendarDay | null) => {
    if (!entry || readOnly || phone || entry.stale || event.button !== 0) return;
    if (event.pointerType === 'touch') return;
    updateDayDrag({
      pointerId: event.pointerId,
      id: entry.day.id,
      date: entry.draft.date,
      x: event.clientX,
      y: event.clientY,
      px: event.clientX,
      py: event.clientY,
      active: false,
      target: null,
      el: event.currentTarget,
    });
  };
  const focusHead = (id: string) =>
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>(`[data-day-head="${CSS.escape(id)}"]`)?.focus(),
    );
  /** N: a new block after the last one of `column`, through the same type menu as a drag. */
  const newBlockIn = (column: CalendarColumn, anchor: HTMLElement) => {
    const { entry } = column;
    if (entry?.stale) return;
    const start = entry
      ? Math.max(
          clockMinutes(entry.draft.callTime),
          ...scheduleTimes(entry.draft).map((slot) => slot.end),
        )
      : firstCall;
    reveal(start);
    openCreating(columnKey(column), start, start + 30, anchor.getBoundingClientRect(), anchor);
  };
  const onHeadKey = (event: KeyboardEvent<HTMLElement>, column: CalendarColumn) => {
    const { entry } = column;
    if (readOnly || event.ctrlKey || event.metaKey) return;
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      if (!entry || entry.stale) return;
      onMoveDay(entry.day.id, addDays(entry.draft.date, event.key === 'ArrowLeft' ? -1 : 1));
      focusHead(entry.day.id);
    } else if (event.key.toLowerCase() === 'n' && !event.altKey) {
      event.preventDefault();
      newBlockIn(column, event.currentTarget);
    }
  };
  // N anywhere in the schedule, not only on a block or a heading: after the selected day's last
  // block, else the first day on screen. Blocks and headings handle it first (defaultPrevented).
  const keyN = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  keyN.current = (event) => {
    if (readOnly || creating || event.defaultPrevented || event.key.toLowerCase() !== 'n') return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (isTyping(event.target) || insideDialog(event.target)) return;
    const view = root.current?.closest<HTMLElement>('.schedule');
    // A view kept mounted behind another one is inert.
    if (!view || view.closest('[inert]')) return;
    const target = event.target;
    if (target !== document.body && !(target instanceof Node && view.contains(target))) return;
    // A block or a day's heading opens its own menu.
    if (target instanceof Element && target.closest('[data-block], [data-day-head]')) return;
    const column =
      columns.find((c) => c.entry && c.entry.day.id === selectedDay) ??
      columns.find((c) => c.entry) ??
      columns[0];
    if (!column) return;
    const anchor =
      (column.entry &&
        root.current?.querySelector<HTMLElement>(
          `[data-day-head="${CSS.escape(column.entry.day.id)}"]`,
        )) ||
      columnRefs.current.get(columnKey(column));
    if (!anchor) return;
    event.preventDefault();
    newBlockIn(column, anchor);
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => keyN.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const movingEntry = dayDrag?.active ? days.find((d) => d.day.id === dayDrag.id) : undefined;
  const dayTarget =
    movingEntry && dayDrag?.target !== movingEntry.draft.date ? (dayDrag?.target ?? null) : null;
  /** Where the blocks of the moved day, or of the day it swaps with, would land. */
  const ghosts = (column: CalendarColumn) => {
    if (!movingEntry || !dayTarget) return [];
    if (column.date === dayTarget) return scheduleTimes(movingEntry.draft);
    if (column.entry?.day.id === movingEntry.day.id)
      return days.filter((d) => d.draft.date === dayTarget).flatMap((d) => scheduleTimes(d.draft));
    return [];
  };
  const short = (date: string) => {
    const text = dateLabel(date, { weekday: 'short', day: 'numeric' });
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
  };
  const dayMoveLabel =
    movingEntry &&
    (dayTarget
      ? t(
          days.some((d) => d.draft.date === dayTarget)
            ? 'schedule.swapDayLabel'
            : 'schedule.moveDayLabel',
          { from: short(movingEntry.draft.date), to: short(dayTarget) },
        )
      : short(movingEntry.draft.date));

  /**
   * Where the label of a dragged day goes, clear of the headings' text: at the top of the target
   * column, just under its heading; under the month when the target is a date there; beside the
   * pointer while it is over nothing.
   */
  const dayLabelAt = (() => {
    if (!dayDrag?.active) return null;
    const column = dayTarget ? columns.find((item) => item.date === dayTarget) : undefined;
    const target = column && columnRefs.current.get(columnKey(column))?.getBoundingClientRect();
    const bounds = grid.current?.getBoundingClientRect();
    if (target && bounds) {
      // One line, as wide as its text, kept inside the calendar near the right edge.
      const width = (dayMoveLabel?.length ?? 0) * 7 + 16;
      const left = Math.min(target.left + 4, bounds.right - width - 4);
      return { left, top: bounds.top + 4, whiteSpace: 'nowrap' as const };
    }
    const month = document.querySelector('.schedule__month-grid')?.getBoundingClientRect();
    if (dayTarget && month) return { left: month.left, top: month.bottom + 6 };
    return { left: Math.min(dayDrag.px + 14, window.innerWidth - 200), top: dayDrag.py + 14 };
  })();

  // --- Keyboard ---------------------------------------------------------------------------------

  const focusBlock = (id: string) =>
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>(`[data-block="${CSS.escape(id)}"]`)?.focus(),
    );
  const onKey = (event: KeyboardEvent, entry: CalendarDay, block: ScheduleBlock) => {
    const mod = isMac() ? event.metaKey : event.ctrlKey;
    const order = scheduleTimes(entry.draft)
      .slice()
      .sort((a, b) => a.start - b.start);
    const at = order.findIndex((s) => s.block.id === block.id);
    const key = event.key;
    const edit = (next: ShootingDayInput, change = entry, merge?: string) => {
      event.preventDefault();
      if (readOnly || entry.stale) return;
      onChange([{ day: change.day, next }], merge);
      announce(change, next, block.id);
      focusBlock(block.id);
    };
    if (key.toLowerCase() === 'n' && !mod && !event.altKey && !event.shiftKey) {
      // A new block right after this one, through the same type menu as a drag.
      event.preventDefault();
      const slot = order[at];
      if (readOnly || entry.stale || !slot) return;
      openCreating(
        entry.day.id,
        slot.end,
        slot.end + 30,
        event.currentTarget.getBoundingClientRect(),
        event.currentTarget as HTMLElement,
      );
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      onOpenBlock(entry.day.id, block.id, event.currentTarget.getBoundingClientRect());
    } else if (mod && key.toLowerCase() === 'd') {
      event.preventDefault();
      if (!readOnly) onDuplicate(entry.day.id, block.id);
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      if (!readOnly) onRemove(entry.day.id, block.id);
    } else if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      edit(shiftBlock(entry.draft, block.id, key === 'ArrowUp' ? -1 : 1));
    } else if (event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      const to = days[days.indexOf(entry) + (key === 'ArrowLeft' ? -1 : 1)];
      if (!to || readOnly || entry.stale || to.stale) return;
      const slot = order[at];
      const moved = moveBlockToDay(entry.draft, to.draft, block.id, slot?.start ?? 0, false);
      onChange([
        { day: entry.day, next: moved.from },
        { day: to.day, next: moved.to },
      ]);
      announce(to, moved.to, block.id);
      onOpenDay(null, to.draft.date);
      focusBlock(block.id);
    } else if (event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      const step = key === 'ArrowUp' ? -SNAP : SNAP;
      edit(
        resizeBlock(entry.draft, block.id, Math.max(1, block.duration + step)),
        entry,
        `resize:${block.id}`,
      );
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      const next = order[at + (key === 'ArrowUp' ? -1 : 1)];
      if (next) focusBlock(next.block.id);
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      const index = entries.indexOf(entry) + (key === 'ArrowLeft' ? -1 : 1);
      const first = entries[index]?.draft.blocks[0];
      if (first) focusBlock(first.id);
    }
  };

  // --- Drops from the queue ---------------------------------------------------------------------

  const dropMinute = (event: DragEvent, entry: CalendarDay) => {
    const top = columnRefs.current.get(entry.day.id)?.getBoundingClientRect().top ?? 0;
    return snap((event.clientY - top) / scale - 15);
  };

  const hours = Array.from({ length: rangeEnd / 60 + 1 }, (_, h) => h * 60);
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const yesterday = addDays(today, -1);
  const bottom = (viewport.top + viewport.height) / scale;
  const annotations = (() => {
    const bounds = grid.current?.getBoundingClientRect();
    const moving = drag?.active ? drag : null;
    const drawing = draw?.active ? draw : null;
    if ((!moving && !drawing) || !bounds) return [];
    const cards = columns.flatMap(({ date, entry }) => {
      const column = columnRefs.current.get(entry?.day.id ?? date)?.getBoundingClientRect();
      if (!column || !entry) return [];
      const slots = scheduleTimes(shown(entry));
      const lanes = layoutLanes(
        slots
          .filter((slot) => slot.block.id !== moving?.blockId)
          .map((slot) => ({ id: slot.block.id, start: slot.start, end: slot.end })),
      );
      return slots.map((slot, index) => {
        const primary = slot.block.id === moving?.blockId;
        const lane = primary
          ? { lane: 0, lanes: 1 }
          : (lanes.get(slot.block.id) ?? { lane: 0, lanes: 1 });
        const previous = slots[index - 1];
        const after = previous
          ? t('schedule.after', {
              block: blockTitle(previous.block).split(' · ')[0],
            })
          : t('schedule.afterCall');
        // Only the moved block gets a label beside it; the blocks that shift show it inside.
        const text = !primary
          ? ''
          : moving?.kind === 'resize'
            ? t('schedule.resizeLabel', {
                duration: minutesLabel(slot.block.duration),
                end: clockLabel(slot.end),
              })
            : `${dateLabel(date, { weekday: 'short', day: 'numeric' })} · ${clockLabel(slot.start)} – ${clockLabel(slot.end)} · ${after}`;
        return {
          id: slot.block.id,
          column: entry.day.id,
          text,
          primary,
          rect: {
            left: column.left + (column.width * lane.lane) / lane.lanes + 4,
            top: column.top + slot.start * scale,
            width: column.width / lane.lanes - 8,
            height: Math.max(MIN_HEIGHT, (slot.end - slot.start) * scale),
          },
        };
      });
    });
    if (
      moving?.kind === 'move' &&
      columns.some((column) => !column.entry && column.date === moving.target)
    ) {
      const column = columnRefs.current.get(moving.target)?.getBoundingClientRect();
      const block = days
        .find((day) => day.day.id === moving.dayId)
        ?.draft.blocks.find((item) => item.id === moving.blockId);
      if (column && block) {
        const start = Math.max(0, moving.minute);
        cards.push({
          id: block.id,
          column: moving.target,
          primary: true,
          text: `${dateLabel(moving.target, { weekday: 'short', day: 'numeric' })} · ${clockLabel(start)} – ${clockLabel(start + block.duration)}`,
          rect: {
            left: column.left + 4,
            top: column.top + start * scale,
            width: column.width - 8,
            height: Math.max(40, block.duration * scale),
          },
        });
      }
    }
    if (drawing) {
      // The new block: its time beside it, the other blocks are what it must not cover.
      const column = columnRefs.current.get(drawing.column)?.getBoundingClientRect();
      const { start, end } = drawnRange(drawing.from, drawing.to);
      if (column)
        cards.push({
          id: 'new-block',
          column: drawing.column,
          primary: true,
          text: `${clockLabel(start)} – ${clockLabel(end)}`,
          rect: {
            left: column.left + 4,
            top: column.top + start * scale,
            width: column.width - 8,
            height: Math.max(MIN_HEIGHT, (end - start) * scale),
          },
        });
    }
    const gutter = grid.current?.querySelector('.schedule__gutter')?.getBoundingClientRect();
    const left = gutter?.right ?? bounds.left;
    const noteBounds = { left, top: bounds.top, width: bounds.right - left, height: bounds.height };
    const occupied = cards.map((card) => card.rect);
    return cards
      .filter(
        (card) =>
          card.text &&
          card.rect.top < bounds.bottom &&
          card.rect.top + card.rect.height > bounds.top,
      )
      .map((card) => {
        const width = 240;
        const size = {
          width,
          height: Math.max(24, Math.ceil((card.text.length * 10) / (width - 14)) * 16 + 8),
        };
        const position = placeAnnotation(card.rect, size, noteBounds, occupied);
        if (position) occupied.push({ ...position, ...size });
        return { ...card, position, size };
      });
  })();

  // On a phone the day is a list in time order (mockup option 8): every block readable, each
  // opens its sheet, which moves it earlier, later or to another day.
  if (phone) {
    const column = columns[0];
    const entry = column?.entry;
    const draft = entry ? shown(entry) : null;
    const wrap = draft ? plannedWrap(draft) : null;
    const slots = draft ? scheduleTimes(draft).sort((a, b) => a.start - b.start) : [];
    return (
      <section
        ref={root}
        aria-label={t('schedule.calendarLabel')}
        className="schedule__calendar schedule__list"
        data-scroll
        data-tour="schedule-days"
      >
        {entry && draft ? (
          <>
            {hotDay === entry.day.id && (
              <ConflictNote dayId={entry.day.id} lines={notesOf(entry)} />
            )}
            <p className="schedule__list-mark">
              {t('schedule.callAt', { time: formatClock(draft.callTime) })}
            </p>
            <ol className="schedule__rows">
              {slots.map(({ block, start, end }) => {
                const seen = look(block);
                const conflict = conflicts.has(block.id);
                const label = blockLabel(block, start, end, conflict, seen);
                return (
                  <li key={block.id}>
                    <button
                      type="button"
                      data-block={block.id}
                      className={`schedule__row schedule__block--${block.type}${seen?.dot ? ' has-source' : ''}${conflict ? ' has-conflict' : ''}${conflict && hotDay === entry.day.id ? ' is-hot' : ''}`}
                      style={
                        seen?.dot ? ({ '--source': seen.dot.color } as CSSProperties) : undefined
                      }
                      aria-pressed={selectedBlock === block.id}
                      aria-label={label}
                      aria-keyshortcuts="Enter Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Shift+ArrowUp Shift+ArrowDown Delete"
                      onClick={(event) =>
                        onOpenBlock(entry.day.id, block.id, event.currentTarget.getBoundingClientRect())
                      }
                      onKeyDown={(event) => onKey(event, entry, block)}
                    >
                      <span className="schedule__block-time">
                        {clockLabel(start)}
                        {block.start !== null && <Icon name="pin" size={11} />}
                      </span>
                      <span className="schedule__row-title">{blockTitle(block)}</span>
                      <span className="schedule__block-meta">
                        {[block.cast.join(', '), minutesLabel(block.duration)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {conflict && (
                        <span className="schedule__row-warn" aria-hidden="true">
                          <Icon name="warning" size={14} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
            {wrap !== null && (
              <p className="schedule__list-mark">
                {t('schedule.wrapAt', { time: clockLabel(wrap) })}
              </p>
            )}
          </>
        ) : (
          <p className="schedule__list-free">{t('schedule.noShoot')}</p>
        )}
      </section>
    );
  }

  return (
    <section
      ref={root}
      aria-label={t('schedule.calendarLabel')}
      className="schedule__calendar"
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
      // The hours stay in view while the days scroll sideways: the grid scrolls only up and down.
      onScroll={(event) =>
        event.currentTarget.style.setProperty(
          '--schedule-scroll-x',
          `${event.currentTarget.scrollLeft}px`,
        )
      }
      data-tour="schedule-days"
      style={
        {
          '--schedule-template': template,
          '--schedule-hour': `${60 * scale}px`,
        } as CSSProperties
      }
    >
      <div className="schedule__heads">
        <span className="schedule__gutter" aria-hidden="true" />
        {columns.map((column) => {
          const { date, entry } = column;
          return (
            <DayHead
              key={entry?.day.id ?? date}
              date={date}
              entry={entry}
              today={today}
              view={view}
              phone={phone}
              narrow={narrow(column)}
              readOnly={readOnly}
              selected={!!entry && entry.day.id === selectedDay}
              moving={!!movingEntry && movingEntry.day.id === entry?.day.id}
              dropTarget={dayTarget === date}
              conflicts={entry ? entry.draft.blocks.filter((b) => conflicts.has(b.id)).length : 0}
              hot={!!entry && hotDay === entry.day.id}
              onHot={(open) => {
                onHotDay(open && entry ? entry.day.id : null);
                if (open && entry) revealConflicts(entry);
              }}
              sun={entry ? sunOf(entry.draft) : null}
              onOpen={() => {
                if (!suppressClick.current) onOpenDay(entry, date);
              }}
              onPointerDown={(event) => beginDayDrag(event, entry)}
              onKeyDown={(event) => onHeadKey(event, column)}
            />
          );
        })}
      </div>
      <div
        ref={grid}
        className="schedule__grid"
        data-scroll
        onScroll={(event) =>
          setViewport({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight,
          })
        }
      >
        <div className="schedule__canvas" style={{ height: rangeEnd * scale }}>
          <div className="schedule__gutter" aria-hidden="true">
            {hours.map((minute) => (
              <span key={minute} className="schedule__hour" style={{ top: minute * scale }}>
                {minute > 0 && minute < rangeEnd
                  ? `${clockLabel(minute % 1440)}${minute === 1440 ? ' (+1)' : ''}`
                  : ''}
              </span>
            ))}
          </div>
          {columns.map((column) => {
            const { date, entry } = column;
            const fresh = pending(columnKey(column));
            const ghostSlots = ghosts(column);
            const extras = (
              <>
                {fresh && (
                  <span
                    className="schedule__placeholder is-new"
                    style={{
                      top: fresh.start * scale,
                      height: (fresh.end - fresh.start) * scale,
                    }}
                  />
                )}
                {ghostSlots.map((slot) => (
                  <span
                    key={`ghost-${slot.block.id}`}
                    className="schedule__placeholder"
                    style={{
                      top: slot.start * scale,
                      height: Math.max(MIN_HEIGHT, (slot.end - slot.start) * scale),
                    }}
                  />
                ))}
              </>
            );
            if (!entry)
              return (
                <section
                  key={date}
                  aria-label={t('schedule.day', { date })}
                  className={`schedule__column is-free${narrow(column) ? ' is-narrow' : ''}${dayTarget === date ? ' is-drop' : ''}`}
                  data-day-drop={date}
                  onPointerDown={(event) => beginDraw(event, column)}
                  ref={(el) => {
                    if (el) columnRefs.current.set(date, el);
                    else columnRefs.current.delete(date);
                  }}
                  onDragOver={(event) => {
                    if (!readOnly && event.dataTransfer.types.includes(SHOT_DRAG_TYPE))
                      event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (readOnly) return;
                    const top = event.currentTarget.getBoundingClientRect().top;
                    onDropFree(
                      date,
                      snap((event.clientY - top) / scale),
                      event.altKey,
                      null,
                      null,
                      event.dataTransfer.getData(SHOT_DRAG_TYPE),
                    );
                  }}
                >
                  {narrow(column) ? (
                    <span className="schedule__vertical" aria-hidden="true">
                      {t('schedule.freeShort')}
                    </span>
                  ) : (
                    <p className="schedule__free" style={{ top: (firstCall + 240) * scale }}>
                      <b>{t('schedule.noShoot')}</b>
                      {!readOnly && (
                        <span>
                          {t(view === 'day' ? 'schedule.freeDrop' : 'schedule.freeDropWeek')}
                        </span>
                      )}
                    </p>
                  )}
                  {drag?.active &&
                    drag.kind === 'move' &&
                    drag.target === date &&
                    (() => {
                      const from = days.find((item) => item.day.id === drag.dayId);
                      const block = from?.draft.blocks.find((item) => item.id === drag.blockId);
                      if (!block) return null;
                      const start = Math.max(0, drag.minute);
                      return (
                        <div
                          className={`schedule__block schedule__block--${block.type} is-dragging`}
                          style={{
                            top: start * scale,
                            height: Math.max(40, block.duration * scale),
                            left: 4,
                            right: 6,
                          }}
                        >
                          <div className="schedule__block-select">
                            <span className="schedule__block-text">
                              <span className="schedule__block-time">
                                {clockLabel(start)} – {clockLabel(start + block.duration)}
                              </span>
                              <span className="schedule__block-title">{blockTitle(block)}</span>
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  {extras}
                  {date === today && <NowLine minute={nowMinute} scale={scale} />}
                </section>
              );
            const draft = shown(entry);
            const slots = scheduleTimes(draft);
            const lanes = layoutLanes(
              slots
                .filter((s) => !(drag?.active && drag.blockId === s.block.id))
                .map((s) => ({ id: s.block.id, start: s.start, end: s.end })),
            );
            const call = clockMinutes(draft.callTime);
            const wrap = plannedWrap(draft);
            const sun = sunOf(draft);
            const nowAt =
              date === today || date === yesterday
                ? (nowIn(entry) ?? (date === today ? nowMinute : null))
                : null;
            const above = slots.filter((s) => s.end <= viewport.top / scale);
            const below = slots.filter((s) => s.start * scale >= bottom * scale - 4);
            const isTarget = drag?.active && drag.kind === 'move' && drag.target === entry.day.id;
            const before = drag?.active
              ? new Map(scheduleTimes(entry.draft).map((s) => [s.block.id, s.start]))
              : null;
            return (
              <section
                key={entry.day.id}
                ref={(el) => {
                  if (el) columnRefs.current.set(entry.day.id, el);
                  else columnRefs.current.delete(entry.day.id);
                }}
                className={`schedule__column schedule__day${entry.stale ? ' is-stale' : ''}${isTarget || dropAt?.day === entry.day.id || dayTarget === date ? ' is-drop' : ''}${dayTarget === date ? ' is-day-drop' : ''}`}
                aria-label={t('schedule.day', { date: draft.date })}
                data-day-drop={date}
                onPointerDown={(event) => beginDraw(event, column)}
                onDragOver={(event) => {
                  if (readOnly) return;
                  event.preventDefault();
                  setDropAt({ day: entry.day.id, minute: dropMinute(event, entry) });
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDropAt(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropAt(null);
                  onDropShot(
                    entry,
                    event.dataTransfer.getData(SHOT_DRAG_TYPE),
                    dropMinute(event, entry),
                  );
                }}
              >
                <span
                  className="schedule__off"
                  style={{ top: 0, height: call * scale }}
                  aria-hidden="true"
                />
                {wrap !== null && (
                  <span
                    className="schedule__off"
                    style={{ top: wrap * scale, height: (rangeEnd - wrap) * scale }}
                    aria-hidden="true"
                  />
                )}
                <span className="schedule__mark" style={{ top: call * scale }}>
                  <span>{t('schedule.callAt', { time: formatClock(draft.callTime) })}</span>
                </span>
                {wrap !== null && (
                  <span className="schedule__mark is-wrap" style={{ top: wrap * scale }}>
                    <span>{t('schedule.wrapAt', { time: clockLabel(wrap) })}</span>
                  </span>
                )}
                {sun?.sunrise != null && (
                  <span
                    className="schedule__sunline"
                    style={{ top: sun.sunrise * scale }}
                    data-ink-tooltip={t('schedule.sunrise', { time: clockLabel(sun.sunrise) })}
                  >
                    {view === 'day' && (
                      <span>{t('schedule.sunrise', { time: clockLabel(sun.sunrise) })}</span>
                    )}
                  </span>
                )}
                {sun?.sunset != null && (
                  <span
                    className="schedule__sunline"
                    style={{ top: sun.sunset * scale }}
                    data-ink-tooltip={t('schedule.sunset', { time: clockLabel(sun.sunset) })}
                  >
                    {view === 'day' && (
                      <span>{t('schedule.sunset', { time: clockLabel(sun.sunset) })}</span>
                    )}
                  </span>
                )}
                {gapsBeforeFixed(draft).map((gap) => (
                  <span
                    key={`gap-${gap.before}`}
                    className="schedule__gap"
                    style={{
                      top: gap.start * scale,
                      height: (gap.end - gap.start) * scale,
                    }}
                  >
                    {gap.end - gap.start >= 20 && (
                      <span>{t('schedule.free', { time: minutesLabel(gap.end - gap.start) })}</span>
                    )}
                  </span>
                ))}
                {dropAt?.day === entry.day.id && (
                  <span
                    className="schedule__placeholder"
                    style={{ top: dropAt.minute * scale, height: 30 * scale }}
                  />
                )}
                {slots.map(({ block, start, end }) => {
                  const lane =
                    drag?.active && drag.blockId === block.id
                      ? { lane: 0, lanes: 1 }
                      : (lanes.get(block.id) ?? { lane: 0, lanes: 1 });
                  const { top, height } = blockBox(start, end, scale);
                  const dragging = drag?.active && drag.blockId === block.id;
                  const seen = look(block);
                  const frame = seen?.frame;
                  const name = blockTitle(block);
                  const time = `${clockLabel(start)} – ${clockLabel(end)}`;
                  const tall = height >= TWO_LINES;
                  const detail = blockDetail(view, height, phone, lane.lanes);
                  const conflict = conflicts.has(block.id);
                  const delta = before && !dragging ? start - (before.get(block.id) ?? start) : 0;
                  const label = blockLabel(block, start, end, conflict, seen);
                  const castAndLength = [block.cast.join(', '), minutesLabel(block.duration)]
                    .filter(Boolean)
                    .join(' · ');
                  // The week as in its mockup (option 3): start and title on one line, then
                  // cast and duration; side by side, the title first. The card is 3 px shorter
                  // than its slot; from 56 px its title may take two lines.
                  const week = view === 'week';
                  const wrapTitle = week ? tall && (lane.lanes > 1 || height - 3 >= 56) : detail.wrap;
                  const startTime = (
                    <span className="schedule__block-time">
                      {week || !tall || !detail.range ? clockLabel(start) : time}
                      {block.start !== null && <Icon name="pin" size={11} />}
                    </span>
                  );
                  const title = <span className="schedule__block-title">{name}</span>;
                  return (
                    <div
                      key={block.id}
                      className={`schedule__block schedule__block--${block.type}${conflict ? ' has-conflict' : ''}${conflict && hotDay === entry.day.id ? ' is-hot' : ''}${selectedBlock === block.id ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${tall ? '' : ' is-short'}${wrapTitle ? ' is-wrap' : ''}`}
                      style={{
                        top,
                        height,
                        // 4 px from the left edge, 6 px from the right one, 2 px between lanes.
                        left: lane.lane ? `calc(${(lane.lane / lane.lanes) * 100}% + 1px)` : 4,
                        right:
                          lane.lane < lane.lanes - 1
                            ? `calc(${((lane.lanes - 1 - lane.lane) / lane.lanes) * 100}% + 1px)`
                            : 6,
                      }}
                    >
                      <button
                        type="button"
                        data-block={block.id}
                        className={`schedule__block-select${seen?.dot ? ' has-source' : ''}`}
                        // The storyboard's bar on the left edge (decision 0123); its name is in
                        // the label, which the tooltip shows whole.
                        style={seen?.dot ? ({ '--source': seen.dot.color } as CSSProperties) : undefined}
                        aria-pressed={selectedBlock === block.id}
                        aria-label={label}
                        data-ink-tooltip={label}
                        aria-keyshortcuts="Enter Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Shift+ArrowUp Shift+ArrowDown Delete N"
                        onPointerDown={(event) => begin(event, 'move', entry, block, start)}
                        onContextMenu={(event) => {
                          if (dragRef.current?.touch) event.preventDefault();
                        }}
                        onClick={(event) => {
                          if (suppressClick.current) return;
                          onOpenBlock(
                            entry.day.id,
                            block.id,
                            event.currentTarget.getBoundingClientRect(),
                          );
                        }}
                        onKeyDown={(event) => onKey(event, entry, block)}
                      >
                        {detail.picture && frame && (
                          <span className="schedule__block-pic" aria-hidden="true">
                            <FramePicture
                              assetId={frame.assetId}
                              aspect={frame.aspect}
                              boardAspect={seen?.aspect ?? '16:9'}
                              strokes={frame.strokes}
                              shapes={frame.shapes}
                              referenceOpacity={frame.referenceOpacity}
                              pixels={160}
                            />
                          </span>
                        )}
                        {week && tall ? (
                          <span className="schedule__block-text">
                            {lane.lanes > 1 ? (
                              <>
                                {title}
                                <span className="schedule__block-meta">
                                  <span className="schedule__block-time">
                                    {clockLabel(start)}
                                    {block.start !== null && <Icon name="pin" size={11} />}
                                  </span>
                                  {castAndLength && ` · ${castAndLength}`}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="schedule__block-line">
                                  {startTime}
                                  {title}
                                </span>
                                <span className="schedule__block-meta">{castAndLength}</span>
                              </>
                            )}
                          </span>
                        ) : (
                        <span className="schedule__block-text">
                          {startTime}
                          {title}
                          {!week && detail.meta && (
                            <span className="schedule__block-meta">
                              {[
                                detail.type ? typeName(block.type) : '',
                                block.cast.join(', '),
                                minutesLabel(block.duration),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </span>
                        )}
                        {conflict && (
                          <span className="schedule__block-warn">
                            <Icon name="warning" size={14} />
                          </span>
                        )}
                      </button>
                      {delta !== 0 && (
                        <span
                          className={`schedule__block-delta${conflict ? ' has-conflict' : ''}`}
                          aria-hidden="true"
                        >
                          {`${delta > 0 ? '+' : '−'}${minutesLabel(Math.abs(delta))}`}
                        </span>
                      )}
                      {!readOnly && !entry.stale && (
                        <span
                          className="schedule__resize"
                          aria-hidden="true"
                          onPointerDown={(event) => begin(event, 'resize', entry, block, start)}
                        />
                      )}
                    </div>
                  );
                })}
                {extras}
                {hotDay === entry.day.id &&
                  (() => {
                    const first = slots.find((slot) => conflicts.has(slot.block.id));
                    if (!first) return null;
                    // Above the first double-booked block, or under it near the top of the day.
                    const y = first.start * scale;
                    const onTop = y >= 90;
                    return (
                      <ConflictNote
                        dayId={entry.day.id}
                        lines={notesOf(entry)}
                        style={
                          onTop
                            ? { top: y - 6, transform: 'translateY(-100%)' }
                            : { top: first.end * scale + 6 }
                        }
                      />
                    );
                  })()}
                {nowAt !== null && <NowLine minute={nowAt} scale={scale} />}
                {above.length > 0 && !phone && !drag?.active && !dayDrag?.active && (
                  <button
                    type="button"
                    className="schedule__more"
                    style={{ top: viewport.top + 4 }}
                    onClick={() => {
                      const last = above.at(-1);
                      if (last && grid.current)
                        grid.current.scrollTop = Math.max(0, (last.start - 30) * scale);
                    }}
                  >
                    <Icon name="chevronDown" className="schedule__up" size={12} />
                    {t('schedule.moreAbove', { count: above.length })}
                  </button>
                )}
                {below.length > 0 && !phone && !drag?.active && !dayDrag?.active && (
                  <button
                    type="button"
                    className="schedule__more"
                    style={{ top: (bottom - 4) * scale, transform: 'translateY(-100%)' }}
                    onClick={() => {
                      const first = below[0];
                      if (first && grid.current)
                        grid.current.scrollTop = (first.start - 60) * scale;
                    }}
                  >
                    <Icon name="chevronDown" size={12} />
                    {t('schedule.moreBelow', {
                      count: below.length,
                      time: clockLabel(Math.max(...slots.map((s) => s.end))),
                    })}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>
      {annotations.some((note) => !note.position) && (
        <div
          className="schedule__annotation-band"
        >
          <span />
          {columns.map(({ date, entry }) => (
            <div key={date} className="schedule__annotation-cell">
              {annotations
                .filter((note) => !note.position && note.column === (entry?.day.id ?? date))
                .map((note) => (
                  <span key={note.id} className="is-primary">
                    {note.text}
                  </span>
                ))}
            </div>
          ))}
        </div>
      )}
      {annotations.map(
        (note) =>
          note.position && (
            <span
              key={note.id}
              className={`schedule__floating-note${note.primary ? ' is-primary' : ''}`}
              style={{
                left: note.position.left,
                top: note.position.top,
                maxWidth: note.size.width,
              }}
            >
              {note.text}
            </span>
          ),
      )}
      {dayMoveLabel && dayLabelAt && (
        <span className="schedule__floating-note is-primary" style={dayLabelAt}>
          {dayMoveLabel}
        </span>
      )}
      {creating && (
        <ContextMenu
          className="schedule__create-menu"
          style={{ left: creating.left, top: creating.top }}
          label={t('schedule.newBlockMenu')}
          items={[
            {
              heading: t('schedule.newBlock', {
                time: `${clockLabel(creating.start)} – ${clockLabel(creating.end)}`,
              }),
            },
            ...NEW_TYPES.map((type, index) => ({
              label: typeName(type),
              shortcut: String(index + 1),
              content: (
                <>
                  <span
                    className={`schedule__type-dot schedule__block--${type}`}
                    aria-hidden="true"
                  />
                  {typeName(type)}
                </>
              ),
              action: () => createRef.current(type),
            })),
          ]}
          onClose={(reason) => {
            if (reason === 'item') return;
            setCreating(null);
            if (reason === 'escape') creating.origin?.focus();
          }}
        />
      )}
    </section>
  );
}

function NowLine({ minute, scale }: { minute: number; scale: number }) {
  const { t } = useTranslation();
  return (
    <span className="schedule__now" style={{ top: minute * scale }}>
      <span className="ink-sr-only">{t('schedule.now', { time: clockLabel(minute % 1440) })}</span>
    </span>
  );
}

/** The id of the note a day's "N conflicts" shows. */
export const conflictNoteId = (dayId: string) => `schedule-conflicts-${dayId}`;

/**
 * "N conflicts" as a button (mockup option 7): it shows who is double-booked under it and marks
 * those blocks; a second press or Escape closes it. Read-only members can use it too.
 */
export function ConflictTag({
  dayId,
  count,
  open,
  onToggle,
}: {
  dayId: string;
  count: number;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || insideDialog(event.target)) return;
      onToggle(false);
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onToggle]);
  return (
    <button
      ref={ref}
      type="button"
      className="schedule__tag is-danger schedule__conflict-tag"
      aria-expanded={open}
      aria-controls={open ? conflictNoteId(dayId) : undefined}
      onClick={() => onToggle(!open)}
      // The heading under it moves the day; this press only opens the note.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {t('schedule.conflictTag', { count })}
    </button>
  );
}

/** Who is double-booked on a day, one line per pair of blocks. */
export function ConflictNote({
  dayId,
  lines,
  style,
}: {
  dayId: string;
  lines: readonly string[];
  style?: CSSProperties;
}) {
  return (
    <div id={conflictNoteId(dayId)} className="schedule__conflict-note" role="note" style={style}>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

function DayHead({
  date,
  entry,
  today,
  view,
  phone,
  narrow,
  readOnly,
  selected,
  moving,
  dropTarget,
  conflicts,
  hot,
  onHot,
  sun,
  onOpen,
  onPointerDown,
  onKeyDown,
}: {
  date: string;
  entry: CalendarDay | null;
  today: string;
  view: 'week' | 'day';
  phone: boolean;
  /** A free day of the week, drawn as a narrow column: weekday and number only. */
  narrow: boolean;
  readOnly: boolean;
  selected: boolean;
  /** Its day is being dragged to another date. */
  moving: boolean;
  /** A dragged day would land here. */
  dropTarget: boolean;
  conflicts: number;
  /** Its conflicts are shown. */
  hot: boolean;
  onHot: (open: boolean) => void;
  sun: Sun;
  onOpen: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const { t, i18n } = useTranslation();
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.language, { ...options, timeZone: 'UTC' }).format(
      Date.parse(`${date}T00:00:00Z`),
    );
  if (phone) return null;
  const draft = entry?.draft;
  const slots = draft ? scheduleTimes(draft) : [];
  const wrap = draft ? plannedWrap(draft) : null;
  const night = wrap !== null && wrap > 1440;
  const shots = draft?.blocks.filter((b) => b.type === 'shot').length ?? 0;
  const call = draft ? clockMinutes(draft.callTime) : 0;
  const sunText =
    sun && (sun.sunrise !== null || sun.sunset !== null)
      ? [
          sun.sunrise !== null && t('schedule.sunrise', { time: clockLabel(sun.sunrise) }),
          sun.sunset !== null && t('schedule.sunset', { time: clockLabel(sun.sunset) }),
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
  // The week leaves sunrise and sunset to the dashed line and to this tooltip (option 4).
  const sunInHead = view === 'day' && sunText;
  return (
    // The whole heading is one button underneath; "N conflicts" is a second one above it.
    <div
      className={`schedule__head${entry ? '' : ' is-free'}${narrow ? ' is-narrow' : ''}${selected ? ' is-selected' : ''}${entry?.stale ? ' is-stale' : ''}${moving ? ' is-moving' : ''}${dropTarget ? ' is-drop' : ''}`}
      data-tour="schedule-day-head"
    >
      <button
        type="button"
        className="schedule__head-hit"
        aria-label={[
          part({ weekday: 'long', day: 'numeric', month: 'long' }),
          entry ? t('schedule.dayNumber', { n: entry.index + 1 }) : t('schedule.freeDay'),
          view === 'week' && entry ? t('schedule.openDay') : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        data-ink-tooltip={view === 'week' && sunText ? sunText : undefined}
        aria-pressed={view === 'day' ? undefined : selected}
        aria-keyshortcuts={readOnly ? undefined : entry ? 'Alt+ArrowLeft Alt+ArrowRight N' : 'N'}
        data-day-head={entry?.day.id}
        data-day-drop={date}
        onClick={onOpen}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <span className="schedule__head-top">
        <span className="schedule__head-weekday" aria-hidden="true">
          {part({ weekday: 'short' })}
        </span>
        <span
          className={`schedule__head-number${date === today ? ' is-today' : ''}`}
          aria-hidden="true"
        >
          {part({ day: 'numeric' })}
        </span>
        {!narrow && <span className="ink-header__spacer" />}
        {night && (
          <span className="schedule__tag" aria-hidden="true">
            {t('schedule.night')}
          </span>
        )}
        {entry && conflicts > 0 && (
          <ConflictTag dayId={entry.day.id} count={conflicts} open={hot} onToggle={onHot} />
        )}
        {entry?.stale && (
          <span className="schedule__tag is-danger" aria-hidden="true">
            {t('schedule.staleFlag')}
          </span>
        )}
      </span>
      {narrow ? null : entry && draft ? (
        <>
          <span className="schedule__head-title schedule__day-sub" aria-hidden="true">
            {[
              t('schedule.dayShort', { n: entry.index + 1 }),
              // The place's name: its map link opens from the call sheet, not from here.
              locationsOfDay({ ...draft, blocks: [] }, new Map())[0]?.name,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="schedule__head-meta" aria-hidden="true">
            {[
              wrap === null
                ? formatClock(draft.callTime)
                : `${formatClock(draft.callTime)} – ${clockLabel(wrap)}`,
              wrap !== null && wrap > call ? minutesLabel(wrap - call) : '',
              slots.length ? t('schedule.shotsShort', { count: shots }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {sunInHead && (
            <span className="schedule__head-meta schedule__sun" aria-hidden="true">
              <Icon name="sun" size={12} />
              <span className="schedule__sun-text">{sunText}</span>
            </span>
          )}
        </>
      ) : (
        <>
          <span className="schedule__head-title is-muted" aria-hidden="true">
            {t('schedule.freeDay')}
          </span>
          {!readOnly && (
            <span className="schedule__head-meta" aria-hidden="true">
              {t('schedule.freeHeadHint')}
            </span>
          )}
        </>
      )}
    </div>
  );
}
