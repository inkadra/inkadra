// SPDX-License-Identifier: AGPL-3.0-only
import { type FrameElement, updateElement } from '@inkadra/canvas-core';
import type { AspectRatio } from '@inkadra/doc-schema';
import { Button, IconButton } from '@inkadra/ui';
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { isTyping } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import {
  animaticTimeline,
  DURATION_STEP_MS,
  entryAt,
  MAX_DURATION_MS,
  snapDuration,
  type TimelineEntry,
  timecode,
} from './animatic.ts';
import { FramePicture } from './FramePicture.tsx';

const SPEEDS = [0.5, 1, 1.5, 2] as const;
const SEEK_MS = 1000;

/**
 * The frames played in order, each for its duration, over the existing pictures and drawings.
 * Inline it sits in the storyboard; `present` shows it full screen in a modal dialog.
 */
export function Animatic({
  store,
  frames,
  labels,
  boardAspect,
  readOnly,
  present = false,
  suspended = false,
  onClose,
}: {
  store: BoardStore;
  frames: readonly FrameElement[];
  labels: Map<string, string>;
  boardAspect: AspectRatio;
  readOnly: boolean;
  present?: boolean;
  /** Paused and kept still while something else (the Present dialog) plays. */
  suspended?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const timeline = useMemo(() => animaticTimeline(frames), [frames]);
  const total = timeline.at(-1)?.end ?? 0;
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const time = Math.min(position, total);
  const active = entryAt(timeline, time);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLElement>(null);
  const track = useRef<HTMLFieldSetElement>(null);
  const hintId = useId();

  const clamp = (ms: number) => Math.max(0, Math.min(total, ms));
  const seek = useCallback((ms: number) => setPosition(Math.max(0, Math.min(total, ms))), [total]);
  const seekBy = (ms: number) => setPosition((p) => clamp(Math.min(p, total) + ms));
  const toggle = () => {
    if (!total) return;
    if (!playing && time >= total) setPosition(0);
    setPlaying(!playing);
  };

  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const delta = (now - previous) * speed;
      previous = now;
      setPosition((p) => p + delta);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);
  useEffect(() => {
    if (playing && position >= total) {
      setPlaying(false);
      setPosition(total);
    }
  }, [playing, position, total]);
  useEffect(() => {
    if (suspended) setPlaying(false);
  }, [suspended]);

  useEffect(() => {
    if (!present) return;
    const el = dialog.current;
    // Focus goes back to whatever opened the presentation once it closes.
    const opener = document.activeElement;
    if (el && !el.open) el.showModal();
    stage.current?.focus();
    return () => {
      if (el?.open) el.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [present]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Text fields and controls keep their own keys: Space presses a button, arrows move a slider.
    if (isTyping(e.target)) return;
    if (e.target instanceof Element && e.target.closest('button, [role="slider"]')) return;
    if (e.key === ' ' || e.key === 'k') toggle();
    else if (e.key === 'ArrowRight' || e.key === 'l') seekBy(SEEK_MS);
    else if (e.key === 'ArrowLeft' || e.key === 'j') seekBy(-SEEK_MS);
    else if (e.key === 'Home') seek(0);
    else if (e.key === 'End') seek(total);
    else if (e.key === 'PageDown' && active) {
      const next = timeline[timeline.indexOf(active) + 1];
      if (next) seek(next.start);
    } else if (e.key === 'PageUp' && active) {
      const prev = timeline[timeline.indexOf(active) - 1];
      seek(prev && time - active.start < 500 ? prev.start : active.start);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  const label = useCallback((entry: TimelineEntry) => labels.get(entry.frame.id) ?? '', [labels]);
  const body = (
    <section
      className={`animatic${present ? ' animatic--present' : ''}`}
      aria-label={t('film.playback.animatic')}
      onKeyDown={onKeyDown}
    >
      <figure
        ref={stage}
        className="animatic__stage"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the stage takes the player's keys
        tabIndex={0}
        aria-describedby={hintId}
        aria-label={
          active
            ? t('film.playback.now', { label: label(active), time: timecode(time) })
            : t('film.playback.animatic')
        }
      >
        {active ? (
          <>
            <div className="animatic__picture">
              <FramePicture
                assetId={active.frame.assetId}
                aspect={active.frame.aspect}
                boardAspect={boardAspect}
                strokes={active.frame.strokes}
                shapes={active.frame.shapes}
                referenceOpacity={active.frame.referenceOpacity}
                pixels={present ? 1920 : 1200}
              />
            </div>
            <figcaption className="animatic__caption">
              <strong>{label(active)}</strong>
              {active.frame.action && <span>{active.frame.action}</span>}
              {active.frame.dialogue && (
                <span className="animatic__dialogue">{active.frame.dialogue}</span>
              )}
            </figcaption>
          </>
        ) : (
          <p className="animatic__empty">{t('film.playback.empty')}</p>
        )}
      </figure>
      <div className="animatic__controls">
        <Button
          variant="primary"
          icon={playing ? undefined : 'play'}
          onClick={toggle}
          disabled={!total}
        >
          {t(playing ? 'film.playback.pause' : 'film.playback.play')}
        </Button>
        <output className="animatic__time" aria-label={t('film.playback.time')}>
          {timecode(time)} / {timecode(total)}
        </output>
        <input
          className="animatic__scrub"
          type="range"
          min={0}
          max={total || 1}
          step={100}
          value={time}
          disabled={!total}
          aria-label={t('film.playback.seek')}
          aria-valuetext={timecode(time)}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <label className="story__aspect">
          <span>{t('film.playback.speed')}</span>
          <select
            className="ink-input"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        {present && onClose && (
          <IconButton icon="close" label={t('film.playback.close')} onClick={onClose} />
        )}
      </div>
      {total > 0 && (
        <fieldset ref={track} className="animatic__track" aria-label={t('film.playback.track')}>
          <TrackBlocks
            store={store}
            track={track}
            timeline={timeline}
            total={total}
            active={active}
            label={label}
            readOnly={readOnly}
            onSeek={seek}
          />
          <span
            className="animatic__playhead"
            style={{ left: `${(time / total) * 100}%` }}
            aria-hidden="true"
          />
        </fieldset>
      )}
      <p id={hintId} className="animatic__hint">
        {t('film.playback.keyboard')} {t('film.playback.defaultDuration')}
      </p>
    </section>
  );
  if (!present) return body;
  return (
    <dialog
      ref={dialog}
      className="animatic-dialog"
      aria-label={t('film.playback.present')}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      {body}
    </dialog>
  );
}

/**
 * Frame blocks as wide as their duration; the edge of a block is a handle for its duration.
 * Memoized apart from the playhead so playback does not re-render every block on each tick.
 * A drag shows the new duration locally and writes it once, as one undo step, on release.
 */
const TrackBlocks = memo(function TrackBlocks({
  store,
  track,
  timeline,
  total,
  active,
  label,
  readOnly,
  onSeek,
}: {
  store: BoardStore;
  track: RefObject<HTMLFieldSetElement | null>;
  timeline: readonly TimelineEntry[];
  total: number;
  active: TimelineEntry | null;
  label: (entry: TimelineEntry) => string;
  readOnly: boolean;
  onSeek: (ms: number) => void;
}) {
  const { t } = useTranslation();
  const drag = useRef<{ id: string; x: number; ms: number; msPerPx: number; last?: number } | null>(
    null,
  );
  const [draft, setDraft] = useState<{ id: string; ms: number } | null>(null);

  const setDuration = (frame: FrameElement, ms: number) => {
    const next = snapDuration(ms);
    if (next === frame.durationMs) return;
    store.undo.stopCapturing();
    updateElement(store.doc, frame.id, { durationMs: next }, LOCAL);
    store.undo.stopCapturing();
  };

  function onPointerDown(e: PointerEvent, entry: TimelineEntry) {
    const width = track.current?.getBoundingClientRect().width;
    if (!width || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      id: entry.frame.id,
      x: e.clientX,
      ms: entry.end - entry.start,
      msPerPx: total / width,
    };
  }
  function onPointerMove(e: PointerEvent, entry: TimelineEntry) {
    const d = drag.current;
    if (!d || d.id !== entry.frame.id) return;
    const ms = snapDuration(d.ms + (e.clientX - d.x) * d.msPerPx);
    d.last = ms;
    if (ms !== draft?.ms) setDraft({ id: d.id, ms });
  }
  function onPointerUp(entry: TimelineEntry) {
    const d = drag.current;
    drag.current = null;
    setDraft(null);
    if (d?.last !== undefined && d.id === entry.frame.id) setDuration(entry.frame, d.last);
  }
  function onPointerCancel() {
    drag.current = null;
    setDraft(null);
  }
  function onHandleKey(e: KeyboardEvent, entry: TimelineEntry) {
    const length = entry.end - entry.start;
    const step = e.key.startsWith('Page') ? 10 * DURATION_STEP_MS : DURATION_STEP_MS;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp')
      setDuration(entry.frame, length + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown')
      setDuration(entry.frame, length - step);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  return timeline.map((entry) => {
    const length = draft?.id === entry.frame.id ? draft.ms : entry.end - entry.start;
    return (
      <div
        key={entry.frame.id}
        className={`animatic__block${entry === active ? ' is-active' : ''}${entry.frame.durationMs === undefined && draft?.id !== entry.frame.id ? ' is-preview' : ''}`}
        style={{ flexGrow: length }}
      >
        <button
          type="button"
          className="animatic__block-seek"
          aria-current={entry === active ? 'true' : undefined}
          aria-label={t('film.playback.block', {
            label: label(entry),
            duration: timecode(length),
          })}
          onClick={() => onSeek(entry.start)}
        >
          {label(entry)}
        </button>
        {!readOnly && (
          <div
            className="animatic__handle"
            role="slider"
            tabIndex={0}
            aria-label={t('film.playback.resize', { label: label(entry) })}
            aria-valuemin={DURATION_STEP_MS / 1000}
            aria-valuemax={MAX_DURATION_MS / 1000}
            aria-valuenow={length / 1000}
            aria-valuetext={timecode(length)}
            onPointerDown={(e) => onPointerDown(e, entry)}
            onPointerMove={(e) => onPointerMove(e, entry)}
            onPointerUp={() => onPointerUp(entry)}
            onPointerCancel={onPointerCancel}
            onKeyDown={(e) => onHandleKey(e, entry)}
          />
        )}
      </div>
    );
  });
});
