// SPDX-License-Identifier: AGPL-3.0-only
import type { FrameElement } from '@inkadra/canvas-core';
import type { AspectRatio } from '@inkadra/doc-schema';
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
import { isMac } from '../shortcuts.ts';
import {
  addDays,
  gapsBeforeFixed,
  layoutLanes,
  MINUTE_PX,
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
import { plannedWrap } from './call-sheet.ts';
import { FramePicture } from './FramePicture.tsx';
import { clockLabel, clockMinutes, scheduleTimes } from './schedule.ts';

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

/** Shortest drawn block: a 5-minute block still has room for one line. */
const MIN_HEIGHT = 20;
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

const blockName = (block: ScheduleBlock, shotTitle: (id: string) => string, fallback: string) =>
  block.shotId ? shotTitle(block.shotId) : block.title || fallback;

export function ScheduleCalendar({
  view,
  phone,
  columns,
  days,
  today,
  now,
  nowIn,
  conflicts,
  selectedDay,
  selectedBlock,
  readOnly,
  shotTitle,
  frameOf,
  boardAspect,
  sunOf,
  onOpenDay,
  onOpenBlock,
  onChange,
  onRemove,
  onDuplicate,
  onAnnounce,
  onDropShot,
  onDropFree,
}: {
  view: 'week' | 'day';
  phone: boolean;
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
  shotTitle: (id: string) => string;
  frameOf: (id: string | null) => FrameElement | undefined;
  boardAspect: AspectRatio;
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
}) {
  const { t, i18n } = useTranslation();
  const grid = useRef<HTMLDivElement>(null);
  const columnRefs = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const [dropAt, setDropAt] = useState<{ day: string; minute: number } | null>(null);

  const entries = columns.flatMap((c) => (c.entry ? [c.entry] : []));
  const typeName = (type: ScheduleBlock['type']) => t(`schedule.types.${type}`);
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
  const shownKey = columns.map((c) => c.date).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the dates change.
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (firstCall - 30) * MINUTE_PX);
    setViewport({ top: el.scrollTop, height: el.clientHeight });
  }, [shownKey]);

  const announce = (entry: CalendarDay, draft: ShootingDayInput, blockId: string) => {
    const slot = scheduleTimes(draft).find((s) => s.block.id === blockId);
    if (!slot) return;
    onAnnounce(
      t('schedule.announce', {
        block: blockName(slot.block, shotTitle, typeName(slot.block.type)),
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
    const pointerMinute = (event.clientY - column.top) / MINUTE_PX;
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
      const duration = Math.min(1440, Math.max(1, snap(current.base + dy / MINUTE_PX, step)));
      update({ ...current, active: true, duration });
      return;
    }
    const column = (!phone && columnAt(event.clientX)) || {
      id: current.dayId,
      top: columnRefs.current.get(current.dayId)?.getBoundingClientRect().top ?? 0,
    };
    const minute = snap((event.clientY - column.top) / MINUTE_PX - current.grab);
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
  const cancel = useCallback(() => {
    window.clearTimeout(pressTimer.current);
    update(null);
  }, [update]);
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
  // A finger that picked a block up must not also scroll the plan.
  useEffect(() => {
    const el = grid.current;
    if (!el || !drag?.active || !drag.touch) return;
    const stop = (event: TouchEvent) => event.preventDefault();
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, [drag?.active, drag?.touch]);

  // --- Keyboard ---------------------------------------------------------------------------------

  const focusBlock = (id: string) =>
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLElement>(`[data-block="${CSS.escape(id)}"]`)?.focus(),
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
    if (key === 'Enter' || key === ' ') {
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
    return snap((event.clientY - top) / MINUTE_PX - 15);
  };

  const hours = Array.from({ length: rangeEnd / 60 + 1 }, (_, h) => h * 60);
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const yesterday = addDays(today, -1);
  const bottom = (viewport.top + viewport.height) / MINUTE_PX;
  const annotations = (() => {
    const bounds = grid.current?.getBoundingClientRect();
    if (!drag?.active || !bounds) return [];
    const cards = columns.flatMap(({ date, entry }) => {
      const column = columnRefs.current.get(entry?.day.id ?? date)?.getBoundingClientRect();
      if (!column || !entry) return [];
      const slots = scheduleTimes(shown(entry));
      const lanes = layoutLanes(
        slots
          .filter((slot) => slot.block.id !== drag.blockId)
          .map((slot) => ({ id: slot.block.id, start: slot.start, end: slot.end })),
      );
      return slots.map((slot, index) => {
        const primary = slot.block.id === drag.blockId;
        const lane = primary
          ? { lane: 0, lanes: 1 }
          : (lanes.get(slot.block.id) ?? { lane: 0, lanes: 1 });
        const original = scheduleTimes(entry.draft).find((item) => item.block.id === slot.block.id);
        const delta = original ? slot.start - original.start : 0;
        const previous = slots[index - 1];
        const after = previous
          ? t('schedule.after', {
              block: blockName(previous.block, shotTitle, typeName(previous.block.type)).split(
                ' · ',
              )[0],
            })
          : t('schedule.afterCall');
        const text = primary
          ? drag.kind === 'resize'
            ? t('schedule.resizeLabel', {
                duration: minutesLabel(slot.block.duration),
                end: clockLabel(slot.end),
              })
            : `${dateLabel(date, { weekday: 'short', day: 'numeric' })} · ${clockLabel(slot.start)} – ${clockLabel(slot.end)} · ${after}`
          : delta
            ? `${delta > 0 ? '+' : '−'}${minutesLabel(Math.abs(delta))}`
            : '';
        return {
          id: slot.block.id,
          name: blockName(slot.block, shotTitle, typeName(slot.block.type)),
          column: entry.day.id,
          text,
          primary,
          rect: {
            left: column.left + (column.width * lane.lane) / lane.lanes + 4,
            top: column.top + slot.start,
            width: column.width / lane.lanes - 8,
            height: Math.max(MIN_HEIGHT, slot.end - slot.start),
          },
        };
      });
    });
    if (
      drag.kind === 'move' &&
      columns.some((column) => !column.entry && column.date === drag.target)
    ) {
      const column = columnRefs.current.get(drag.target)?.getBoundingClientRect();
      const block = days
        .find((day) => day.day.id === drag.dayId)
        ?.draft.blocks.find((item) => item.id === drag.blockId);
      if (column && block) {
        const start = Math.max(0, drag.minute);
        cards.push({
          id: block.id,
          name: blockName(block, shotTitle, typeName(block.type)),
          column: drag.target,
          primary: true,
          text: `${dateLabel(drag.target, { weekday: 'short', day: 'numeric' })} · ${clockLabel(start)} – ${clockLabel(start + block.duration)}`,
          rect: {
            left: column.left + 4,
            top: column.top + start,
            width: column.width - 8,
            height: Math.max(40, block.duration),
          },
        });
      }
    }
    const occupied = cards.map((card) => card.rect);
    return cards
      .filter(
        (card) =>
          card.text &&
          card.rect.top < bounds.bottom &&
          card.rect.top + card.rect.height > bounds.top,
      )
      .map((card) => {
        const width = card.primary ? 240 : 72;
        const size = {
          width,
          height: Math.max(24, Math.ceil((card.text.length * 10) / (width - 14)) * 16 + 8),
        };
        const position = placeAnnotation(card.rect, size, bounds, occupied);
        if (position) occupied.push({ ...position, ...size });
        return { ...card, position, size };
      });
  })();

  return (
    <section
      aria-label={t('schedule.calendarLabel')}
      className="schedule__calendar"
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
      data-tour="schedule-days"
      style={{ '--schedule-columns': columns.length } as CSSProperties}
    >
      <div className="schedule__heads">
        <span className="schedule__gutter" aria-hidden="true" />
        {columns.map(({ date, entry }) => (
          <DayHead
            key={entry?.day.id ?? date}
            date={date}
            entry={entry}
            today={today}
            view={view}
            phone={phone}
            selected={!!entry && entry.day.id === selectedDay}
            conflicts={entry ? entry.draft.blocks.filter((b) => conflicts.has(b.id)).length : 0}
            sun={entry ? sunOf(entry.draft) : null}
            onOpen={() => onOpenDay(entry, date)}
          />
        ))}
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
        <div className="schedule__canvas" style={{ height: rangeEnd * MINUTE_PX }}>
          <div className="schedule__gutter" aria-hidden="true">
            {hours.map((minute) => (
              <span key={minute} className="schedule__hour" style={{ top: minute * MINUTE_PX }}>
                {minute > 0 && minute < rangeEnd
                  ? `${clockLabel(minute % 1440)}${minute === 1440 ? ' (+1)' : ''}`
                  : ''}
              </span>
            ))}
          </div>
          {columns.map(({ date, entry }) => {
            if (!entry)
              return (
                <section
                  key={date}
                  aria-label={t('schedule.day', { date })}
                  className="schedule__column is-free"
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
                      snap((event.clientY - top) / MINUTE_PX),
                      event.altKey,
                      null,
                      null,
                      event.dataTransfer.getData(SHOT_DRAG_TYPE),
                    );
                  }}
                >
                  <p className="schedule__free" style={{ top: (firstCall + 240) * MINUTE_PX }}>
                    <b>{t('schedule.noShoot')}</b>
                    <br />
                    {t('schedule.freeDrop')}
                  </p>
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
                            top: start,
                            height: Math.max(40, block.duration),
                            left: 4,
                            right: 4,
                          }}
                        >
                          <div className="schedule__block-select">
                            <span className="schedule__block-text">
                              <span className="schedule__block-time">
                                {clockLabel(start)} – {clockLabel(start + block.duration)}
                              </span>
                              <span className="schedule__block-title">
                                {blockName(block, shotTitle, typeName(block.type))}
                              </span>
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  {date === today && <NowLine minute={nowMinute} />}
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
            const above = slots.filter((s) => s.end <= viewport.top / MINUTE_PX);
            const below = slots.filter((s) => s.start * MINUTE_PX >= bottom * MINUTE_PX - 4);
            const isTarget = drag?.active && drag.kind === 'move' && drag.target === entry.day.id;
            return (
              <section
                key={entry.day.id}
                ref={(el) => {
                  if (el) columnRefs.current.set(entry.day.id, el);
                  else columnRefs.current.delete(entry.day.id);
                }}
                className={`schedule__column schedule__day${entry.stale ? ' is-stale' : ''}${isTarget || dropAt?.day === entry.day.id ? ' is-drop' : ''}`}
                aria-label={t('schedule.day', { date: draft.date })}
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
                  style={{ top: 0, height: call * MINUTE_PX }}
                  aria-hidden="true"
                />
                {wrap !== null && (
                  <span
                    className="schedule__off"
                    style={{ top: wrap * MINUTE_PX, height: (rangeEnd - wrap) * MINUTE_PX }}
                    aria-hidden="true"
                  />
                )}
                <span className="schedule__mark" style={{ top: call * MINUTE_PX }}>
                  <span>{t('schedule.callAt', { time: formatClock(draft.callTime) })}</span>
                </span>
                {wrap !== null && (
                  <span className="schedule__mark is-wrap" style={{ top: wrap * MINUTE_PX }}>
                    <span>{t('schedule.wrapAt', { time: clockLabel(wrap) })}</span>
                  </span>
                )}
                {sun?.sunrise != null && (
                  <span className="schedule__sunline" style={{ top: sun.sunrise * MINUTE_PX }}>
                    {view === 'day' && (
                      <span>{t('schedule.sunrise', { time: clockLabel(sun.sunrise) })}</span>
                    )}
                  </span>
                )}
                {sun?.sunset != null && (
                  <span className="schedule__sunline" style={{ top: sun.sunset * MINUTE_PX }}>
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
                      top: gap.start * MINUTE_PX,
                      height: (gap.end - gap.start) * MINUTE_PX,
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
                    style={{ top: dropAt.minute * MINUTE_PX, height: 30 * MINUTE_PX }}
                  />
                )}
                {slots.map(({ block, start, end }) => {
                  const lane =
                    drag?.active && drag.blockId === block.id
                      ? { lane: 0, lanes: 1 }
                      : (lanes.get(block.id) ?? { lane: 0, lanes: 1 });
                  const height = Math.max(MIN_HEIGHT, (end - start) * MINUTE_PX);
                  const dragging = drag?.active && drag.blockId === block.id;
                  const frame = frameOf(block.shotId);
                  const name = blockName(block, shotTitle, typeName(block.type));
                  const time = `${clockLabel(start)} – ${clockLabel(end)}`;
                  const tall = height >= TWO_LINES;
                  const roomy = view === 'day' && height >= 56;
                  const conflict = conflicts.has(block.id);
                  return (
                    <div
                      key={block.id}
                      className={`schedule__block schedule__block--${block.type}${conflict ? ' has-conflict' : ''}${selectedBlock === block.id ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${tall ? '' : ' is-short'}`}
                      style={{
                        top: start * MINUTE_PX,
                        height,
                        left: `calc(${(lane.lane / lane.lanes) * 100}% + 4px)`,
                        width: `calc(${100 / lane.lanes}% - 8px)`,
                      }}
                    >
                      <button
                        type="button"
                        data-block={block.id}
                        className="schedule__block-select"
                        aria-pressed={selectedBlock === block.id}
                        aria-label={[
                          name,
                          time,
                          typeName(block.type),
                          block.start !== null ? t('schedule.fixed') : '',
                          conflict ? t('schedule.castFlag') : '',
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        aria-keyshortcuts="Enter Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Shift+ArrowUp Shift+ArrowDown Delete"
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
                        {roomy && frame && (
                          <span className="schedule__block-pic" aria-hidden="true">
                            <FramePicture
                              assetId={frame.assetId}
                              aspect={frame.aspect}
                              boardAspect={boardAspect}
                              strokes={frame.strokes}
                              shapes={frame.shapes}
                              referenceOpacity={frame.referenceOpacity}
                              pixels={160}
                            />
                          </span>
                        )}
                        <span className="schedule__block-text">
                          <span className="schedule__block-time">
                            {block.start !== null && <Icon name="pin" size={11} />}
                            {tall ? time : clockLabel(start)}
                          </span>
                          <span className="schedule__block-title">{name}</span>
                          {roomy && (
                            <span className="schedule__block-meta">
                              {[
                                typeName(block.type),
                                block.cast.join(', '),
                                minutesLabel(block.duration),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </span>
                        {conflict && (
                          <span className="schedule__block-warn">
                            <Icon name="warning" size={12} />
                          </span>
                        )}
                      </button>
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
                {nowAt !== null && <NowLine minute={nowAt} />}
                {above.length > 0 && !phone && !drag?.active && (
                  <button
                    type="button"
                    className="schedule__more"
                    style={{ top: viewport.top + 4 }}
                    onClick={() => {
                      const last = above.at(-1);
                      if (last && grid.current)
                        grid.current.scrollTop = Math.max(0, last.start - 30);
                    }}
                  >
                    <Icon name="chevronDown" className="schedule__up" size={12} />
                    {t('schedule.moreAbove', { count: above.length })}
                  </button>
                )}
                {below.length > 0 && !phone && !drag?.active && (
                  <button
                    type="button"
                    className="schedule__more"
                    style={{ top: (bottom - 4) * MINUTE_PX, transform: 'translateY(-100%)' }}
                    onClick={() => {
                      const first = below[0];
                      if (first && grid.current)
                        grid.current.scrollTop = (first.start - 60) * MINUTE_PX;
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
          style={{ '--schedule-columns': columns.length } as CSSProperties}
        >
          <span />
          {columns.map(({ date, entry }) => (
            <div key={date} className="schedule__annotation-cell">
              {annotations
                .filter((note) => !note.position && note.column === (entry?.day.id ?? date))
                .map((note) => (
                  <span key={note.id} className={note.primary ? 'is-primary' : ''}>
                    {note.primary ? note.text : `${note.name} · ${note.text}`}
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
                width: note.size.width,
                minHeight: note.size.height,
              }}
            >
              {note.text}
            </span>
          ),
      )}
      {phone &&
        !drag?.active &&
        entries.map((entry) => {
          const slots = scheduleTimes(shown(entry));
          const above = slots.filter((slot) => slot.end <= viewport.top / MINUTE_PX);
          const below = slots.filter((slot) => slot.start >= bottom - 4);
          if (!above.length && !below.length) return null;
          return (
            <div key={entry.day.id} className="schedule__edge-notices">
              {above.length > 0 && (
                <button
                  type="button"
                  className="schedule__edge-button"
                  onClick={() => {
                    const last = above.at(-1);
                    if (last && grid.current) grid.current.scrollTop = Math.max(0, last.start - 30);
                  }}
                >
                  <Icon name="chevronDown" className="schedule__up" size={12} />
                  {t('schedule.moreAbove', { count: above.length })}
                </button>
              )}
              {below.length > 0 && (
                <button
                  type="button"
                  className="schedule__edge-button"
                  onClick={() => {
                    const first = below[0];
                    if (first && grid.current)
                      grid.current.scrollTop = Math.max(0, first.start - 30);
                  }}
                >
                  <Icon name="chevronDown" size={12} />
                  {t('schedule.moreBelow', {
                    count: below.length,
                    time: clockLabel(Math.max(...slots.map((slot) => slot.end))),
                  })}
                </button>
              )}
            </div>
          );
        })}
    </section>
  );
}

function NowLine({ minute }: { minute: number }) {
  const { t } = useTranslation();
  return (
    <span className="schedule__now" style={{ top: minute * MINUTE_PX }}>
      <span className="ink-sr-only">{t('schedule.now', { time: clockLabel(minute % 1440) })}</span>
    </span>
  );
}

function DayHead({
  date,
  entry,
  today,
  view,
  phone,
  selected,
  conflicts,
  sun,
  onOpen,
}: {
  date: string;
  entry: CalendarDay | null;
  today: string;
  view: 'week' | 'day';
  phone: boolean;
  selected: boolean;
  conflicts: number;
  sun: Sun;
  onOpen: () => void;
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
  return (
    <button
      type="button"
      className={`schedule__head${selected ? ' is-selected' : ''}${entry?.stale ? ' is-stale' : ''}`}
      aria-label={[
        part({ weekday: 'long', day: 'numeric', month: 'long' }),
        entry ? t('schedule.dayNumber', { n: entry.index + 1 }) : t('schedule.noShoot'),
        view === 'week' && entry ? t('schedule.openDay') : '',
      ]
        .filter(Boolean)
        .join(' · ')}
      aria-pressed={view === 'day' ? undefined : selected}
      onClick={onOpen}
    >
      <span className="schedule__head-top">
        <span className="schedule__head-weekday">{part({ weekday: 'short' })}</span>
        <span className={`schedule__head-number${date === today ? ' is-today' : ''}`}>
          {part({ day: 'numeric' })}
        </span>
        <span className="ink-header__spacer" />
        {night && <span className="schedule__tag">{t('schedule.night')}</span>}
        {conflicts > 0 && (
          <span className="schedule__tag is-danger">
            {t('schedule.conflictTag', { count: conflicts })}
          </span>
        )}
        {entry?.stale && <span className="schedule__tag is-danger">{t('schedule.staleFlag')}</span>}
      </span>
      {entry && draft ? (
        <>
          <span className="schedule__head-title schedule__day-sub">
            {[t('schedule.dayShort', { n: entry.index + 1 }), draft.location.trim().split('\n')[0]]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="schedule__head-meta">
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
          {sun && (sun.sunrise !== null || sun.sunset !== null) && (
            <span className="schedule__head-meta schedule__sun">
              <Icon name="sun" size={12} />
              <span className="schedule__sun-text">
                {[
                  sun.sunrise !== null && t('schedule.sunrise', { time: clockLabel(sun.sunrise) }),
                  sun.sunset !== null && t('schedule.sunset', { time: clockLabel(sun.sunset) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          )}
        </>
      ) : (
        <span className="schedule__head-title is-muted">{t('schedule.freeDay')}</span>
      )}
    </button>
  );
}
