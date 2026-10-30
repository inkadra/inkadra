// SPDX-License-Identifier: AGPL-3.0-only
import {
  type FrameElement,
  moveFrames,
  type SceneGroup,
  updateElement,
} from '@inkadra/canvas-core';
import { AnimaticAudio, type AspectRatio, roots, setAnimaticAudio } from '@inkadra/doc-schema';
import { Button, IconButton, KeyCap, Slider } from '@inkadra/ui';
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
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { useAsset } from '../assets.ts';
import { isTyping } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { startUpload } from '../uploads.ts';
import {
  AUDIO_DRIFT_MS,
  animaticTimeline,
  audioTime,
  DURATION_STEP_MS,
  entryAt,
  frameStep,
  MAX_DURATION_MS,
  neighbourTarget,
  reorderTarget,
  sceneSpans,
  snapDuration,
  type TimelineEntry,
  timecode,
} from './animatic.ts';
import { FramePicture } from './FramePicture.tsx';

/** 1.25 s: a duration to the quarter second the handle snaps to, in the reader's numbers. */
export const seconds = (ms: number) =>
  `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;

const SPEEDS = [0.5, 1, 2] as const;
const SEEK_MS = 1000;
/** Pointer travel that turns a press on a block into a drag that reorders it. */
const DRAG_PX = 6;

/** A viewer's own choice, kept in the browser: muting, looping, the shot overlay. */
function usePreference(key: string, initial: boolean) {
  const storageKey = `inkadra.animatic.${key}`;
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {}
    },
    [storageKey],
  );
  return [value, set] as const;
}

/** The sound track of the storyboard, from `meta.animaticAudio`. */
export function useAnimaticAudio(doc: Y.Doc): AnimaticAudio | null {
  const raw = useSyncExternalStore(
    (listener) => {
      const { meta } = roots(doc);
      meta.observe(listener);
      return () => meta.unobserve(listener);
    },
    () => JSON.stringify(roots(doc).meta.get('animaticAudio') ?? null),
  );
  return useMemo(() => {
    const parsed = AnimaticAudio.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }, [raw]);
}

/**
 * The frames played in order, each for its duration, over the existing pictures and drawings,
 * with the storyboard's sound track. Inline it sits in the storyboard over its time line;
 * `present` shows the same player full screen in a modal dialog.
 */
export function Animatic({
  store,
  frames,
  groups,
  labels,
  boardAspect,
  readOnly,
  present = false,
  suspended = false,
  upload,
  onClose,
}: {
  store: BoardStore;
  frames: readonly FrameElement[];
  /** Scenes of the frames: their cuts are marked and frames can be moved across them. */
  groups?: readonly SceneGroup[];
  labels: Map<string, string>;
  boardAspect: AspectRatio;
  readOnly: boolean;
  present?: boolean;
  /** Paused and kept still while something else (the Present dialog) plays. */
  suspended?: boolean;
  /** Where an uploaded sound track goes; without it the track can be played, not changed. */
  upload?: { projectId: string; boardId: string };
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const timeline = useMemo(() => animaticTimeline(frames), [frames]);
  const total = timeline.at(-1)?.end ?? 0;
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = usePreference('loop', false);
  const [overlay, setOverlay] = usePreference('overlay', true);
  const time = Math.min(position, total);
  const active = entryAt(timeline, time);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLElement>(null);
  const track = useRef<HTMLFieldSetElement>(null);
  const hintId = useId();
  const audio = useAnimaticAudio(store.doc);

  const seek = useCallback((ms: number) => setPosition(Math.max(0, Math.min(total, ms))), [total]);
  const seekBy = (ms: number) => setPosition((p) => Math.max(0, Math.min(total, p + ms)));
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
    if (!playing || position < total) return;
    if (loop && total > 0) setPosition(position % total);
    else {
      setPlaying(false);
      setPosition(total);
    }
  }, [playing, position, total, loop]);
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
    if (e.target instanceof Element && e.target.closest('button, [role="slider"], input, select'))
      return;
    if (e.key === ' ' || e.key === 'k') toggle();
    else if (e.key === 'ArrowRight' && e.shiftKey) seekBy(SEEK_MS);
    else if (e.key === 'ArrowLeft' && e.shiftKey) seekBy(-SEEK_MS);
    else if (e.key === 'l') seekBy(SEEK_MS);
    else if (e.key === 'j') seekBy(-SEEK_MS);
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') seek(frameStep(timeline, time, 1));
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') seek(frameStep(timeline, time, -1));
    else if (e.key === 'Home') seek(0);
    else if (e.key === 'End') seek(total);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  const label = useCallback((entry: TimelineEntry) => labels.get(entry.frame.id) ?? '', [labels]);
  const sceneLabel = useMemo(() => {
    const byId = new Map(
      (groups ?? []).flatMap((g) => (g.scene ? [[g.scene.id, g.scene] as const] : [])),
    );
    return (sceneId: string | null) => {
      const scene = sceneId ? byId.get(sceneId) : undefined;
      if (!scene) return t('film.loose');
      const title = scene.title || scene.location;
      return title
        ? t('film.playback.sceneTitle', { number: scene.number, title })
        : t('film.scene.heading', { number: scene.number });
    };
  }, [groups, t]);
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
            {overlay && (
              <figcaption className="animatic__caption">
                <strong className="animatic__shot">{label(active)}</strong>
                {active.frame.action && <span>{active.frame.action}</span>}
                {active.frame.dialogue && (
                  <span className="animatic__dialogue">{active.frame.dialogue}</span>
                )}
              </figcaption>
            )}
          </div>
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
        <Slider
          className="animatic__scrub"
          min={0}
          max={total || 1}
          step={100}
          value={time}
          disabled={!total}
          aria-label={t('film.playback.seek')}
          aria-valuetext={timecode(time)}
          onChange={seek}
        />
        <div className="animatic__toggles">
          <IconButton
            icon="repeat"
            label={t('film.playback.loop')}
            aria-pressed={loop}
            onClick={() => setLoop(!loop)}
          />
          <IconButton
            icon="captions"
            label={t('film.playback.overlay')}
            aria-pressed={overlay}
            onClick={() => setOverlay(!overlay)}
          />
          <fieldset className="story__modes animatic__speed" aria-label={t('film.playback.speed')}>
            {SPEEDS.map((s) => (
              <button
                type="button"
                key={s}
                className="story__mode"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
              >
                {s.toLocaleString()}×
              </button>
            ))}
          </fieldset>
        </div>
        {present && onClose && (
          <IconButton icon="close" label={t('film.playback.close')} onClick={onClose} />
        )}
      </div>
      {total > 0 && (
        <div className="animatic__timeline">
          <div className="animatic__timeline-head">
            <span className="animatic__runtime">
              {t('film.playback.runtime', { count: timeline.length, duration: timecode(total) })}
            </span>
            <SoundTrack
              store={store}
              audio={audio}
              playing={playing && !suspended}
              time={time}
              speed={speed}
              readOnly={readOnly || !upload}
              upload={upload}
            />
          </div>
          <div className="animatic__scenes" aria-hidden="true">
            {sceneSpans(timeline).map((span) => (
              <span
                key={`${span.sceneId ?? 'loose'}-${span.start}`}
                className={`animatic__scene${span.sceneId ? '' : ' is-loose'}`}
                style={{ flexGrow: span.end - span.start }}
                title={sceneLabel(span.sceneId)}
              >
                {sceneLabel(span.sceneId)}
              </span>
            ))}
          </div>
          <fieldset ref={track} className="animatic__track" aria-label={t('film.playback.track')}>
            <TrackBlocks
              store={store}
              track={track}
              timeline={timeline}
              groups={groups}
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
        </div>
      )}
      <Shortcuts id={hintId} readOnly={readOnly} />
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
 * The player's keys: one line with the main ones, the rest behind a small button. The full
 * list is also the stage's description for screen readers.
 */
function Shortcuts({ id, readOnly }: { id: string; readOnly: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes the list first, before the player or the Present dialog sees it.
    const close = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', close, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', close, true);
    };
  }, [open]);
  const keys: Array<[string[], string]> = [
    [[t('film.playback.keys.space')], t('film.playback.keys.play')],
    [['←', '→'], t('film.playback.keys.frame')],
    [['⇧ ←', '⇧ →'], t('film.playback.keys.second')],
    [['Home', 'End'], t('film.playback.keys.ends')],
    ...(readOnly ? [] : [[['Alt ←', 'Alt →'], t('film.playback.keys.move')] as [string[], string]]),
  ];
  return (
    <div ref={root} className="animatic__keys">
      <span className="animatic__keys-line" aria-hidden="true">
        <KeyCap>{t('film.playback.keys.space')}</KeyCap> {t('film.playback.keys.play')}
        <KeyCap>←</KeyCap>
        <KeyCap>→</KeyCap> {t('film.playback.keys.frame')}
      </span>
      <IconButton
        icon="keyboard"
        label={t('film.playback.keys.title')}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      />
      <div id={id} className="animatic__keys-pop" role="note" hidden={!open}>
        <dl>
          {keys.map(([caps, text]) => (
            <div key={text}>
              <dt>
                {caps.map((c) => (
                  <KeyCap key={c}>{c}</KeyCap>
                ))}
              </dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <p>
          {readOnly
            ? t('film.playback.defaultDurationReadOnly')
            : t('film.playback.defaultDuration')}
        </p>
      </div>
    </div>
  );
}

/**
 * The sound track: played in step with the picture (put back in place when it drifts), at the
 * team's volume unless this viewer mutes it. Editors upload, replace or remove the file.
 */
function SoundTrack({
  store,
  audio,
  playing,
  time,
  speed,
  readOnly,
  upload,
}: {
  store: BoardStore;
  audio: AnimaticAudio | null;
  playing: boolean;
  time: number;
  speed: number;
  readOnly: boolean;
  upload: { projectId: string; boardId: string } | undefined;
}) {
  const { t } = useTranslation();
  const asset = useAsset(audio?.assetId);
  const file = asset && asset !== 'missing' ? asset : null;
  const element = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [muted, setMuted] = usePreference('muted', false);
  // Viewers who cannot edit change the level for themselves only.
  const [ownVolume, setOwnVolume] = useState<number | null>(null);
  const volume = ownVolume ?? audio?.volume ?? 1;
  const [uploading, setUploading] = useState(false);
  const src = file?.url;

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted]);
  useEffect(() => {
    const el = element.current;
    if (el) el.playbackRate = speed;
  }, [speed]);
  // Follow the picture: seek when paused or drifting, play while it plays and has sound.
  useEffect(() => {
    const el = element.current;
    if (!el || !src) return;
    const duration = Number.isFinite(el.duration) ? el.duration * 1000 : null;
    const at = audioTime(time, duration);
    if (at === null) {
      if (!el.paused) el.pause();
      return;
    }
    if (Math.abs(el.currentTime - at) * 1000 > AUDIO_DRIFT_MS) {
      try {
        el.currentTime = at;
      } catch {}
    }
    if (playing && el.paused) el.play()?.catch(() => {});
    else if (!playing && !el.paused) el.pause();
  }, [time, playing, src]);

  const setVolume = (next: number) => {
    if (readOnly || !audio) setOwnVolume(next);
    else setAnimaticAudio(store.doc, { ...audio, volume: next }, LOCAL);
  };

  if (!audio && readOnly) return null;
  return (
    <fieldset className="animatic__sound" aria-label={t('film.playback.sound')}>
      {audio && src && (
        // biome-ignore lint/a11y/useMediaCaption: a temp track or voice-over timed to the frames
        <audio ref={element} src={src} preload="auto" />
      )}
      {audio ? (
        <>
          <IconButton
            icon={muted ? 'mute' : 'volume'}
            label={t(muted ? 'film.playback.unmute' : 'film.playback.mute')}
            aria-pressed={muted}
            onClick={() => setMuted(!muted)}
          />
          <Slider
            className="animatic__volume"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            disabled={muted}
            aria-label={t('film.playback.volume')}
            aria-valuetext={`${Math.round(volume * 100)}%`}
            onChange={setVolume}
          />
          <span className="animatic__sound-name" title={file?.filename}>
            {asset === 'missing' ? t('film.playback.soundMissing') : (file?.filename ?? '…')}
          </span>
        </>
      ) : (
        <span className="animatic__sound-name ink-muted">{t('film.playback.noSound')}</span>
      )}
      {!readOnly && upload && (
        <>
          <Button
            icon="upload"
            variant="ghost"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            {t(audio ? 'film.playback.replaceSound' : 'film.playback.addSound')}
          </Button>
          {audio && (
            <IconButton
              icon="trash"
              label={t('film.playback.removeSound')}
              onClick={() => setAnimaticAudio(store.doc, null, LOCAL)}
            />
          )}
          <input
            ref={input}
            type="file"
            accept="audio/*"
            hidden
            aria-label={t('film.playback.addSound')}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (!picked) return;
              setUploading(true);
              startUpload({
                file: picked,
                projectId: upload.projectId,
                boardId: upload.boardId,
                onAsset: (assetId) =>
                  setAnimaticAudio(store.doc, { assetId, volume: audio?.volume ?? 1 }, LOCAL),
                onComplete: () => setUploading(false),
                onFailed: () => setUploading(false),
              });
            }}
          />
        </>
      )}
    </fieldset>
  );
}

type Drag =
  | { kind: 'duration'; id: string; x: number; ms: number; msPerPx: number; last?: number }
  | { kind: 'move'; id: string; x: number; moved: boolean };

/**
 * Frame blocks as wide as their duration; the edge of a block is a handle for its duration and
 * the block itself can be dragged to another place (Alt + arrows from the keyboard).
 * Memoized apart from the playhead so playback does not re-render every block on each tick.
 * A drag shows the change locally and writes it once, as one undo step, on release.
 */
const TrackBlocks = memo(function TrackBlocks({
  store,
  track,
  timeline,
  groups,
  total,
  active,
  label,
  readOnly,
  onSeek,
}: {
  store: BoardStore;
  track: RefObject<HTMLFieldSetElement | null>;
  timeline: readonly TimelineEntry[];
  groups: readonly SceneGroup[] | undefined;
  total: number;
  active: TimelineEntry | null;
  label: (entry: TimelineEntry) => string;
  readOnly: boolean;
  onSeek: (ms: number) => void;
}) {
  const { t } = useTranslation();
  const drag = useRef<Drag | null>(null);
  // The click that ends a drag must not also seek.
  const dragged = useRef(false);
  const [draft, setDraft] = useState<{ id: string; ms: number } | null>(null);
  const [drop, setDrop] = useState<{ moving: string; target: string; after: boolean } | null>(null);
  const canMove = !readOnly && !!groups;

  const setDuration = (frame: FrameElement, ms: number) => {
    const next = snapDuration(ms);
    if (next === frame.durationMs) return;
    store.undo.stopCapturing();
    updateElement(store.doc, frame.id, { durationMs: next }, LOCAL);
    store.undo.stopCapturing();
  };
  const move = (to: { sceneId: string; index: number } | null, id: string) => {
    if (!to) return;
    store.undo.stopCapturing();
    moveFrames(store.doc, [id], to.sceneId, to.index, LOCAL);
    store.undo.stopCapturing();
  };

  /** The block under a point of the track, and whether the point is in its right half. */
  function dropAt(clientX: number) {
    const blocks = track.current?.querySelectorAll<HTMLElement>('[data-frame]') ?? [];
    for (const block of blocks) {
      const r = block.getBoundingClientRect();
      if (clientX < r.right || block === blocks[blocks.length - 1]) {
        const id = block.dataset.frame ?? '';
        return { target: id, after: clientX > r.left + r.width / 2 };
      }
    }
    return null;
  }

  function onHandleDown(e: PointerEvent, entry: TimelineEntry) {
    const width = track.current?.getBoundingClientRect().width;
    if (!width || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      kind: 'duration',
      id: entry.frame.id,
      x: e.clientX,
      ms: entry.end - entry.start,
      msPerPx: total / width,
    };
  }
  function onHandleMove(e: PointerEvent, entry: TimelineEntry) {
    const d = drag.current;
    if (d?.kind !== 'duration' || d.id !== entry.frame.id) return;
    const ms = snapDuration(d.ms + (e.clientX - d.x) * d.msPerPx);
    d.last = ms;
    if (ms !== draft?.ms) setDraft({ id: d.id, ms });
  }
  function onHandleUp(entry: TimelineEntry) {
    const d = drag.current;
    drag.current = null;
    setDraft(null);
    if (d?.kind === 'duration' && d.last !== undefined && d.id === entry.frame.id)
      setDuration(entry.frame, d.last);
  }

  function onBlockDown(e: PointerEvent, entry: TimelineEntry) {
    if (!canMove || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'move', id: entry.frame.id, x: e.clientX, moved: false };
  }
  function onBlockMove(e: PointerEvent) {
    const d = drag.current;
    if (d?.kind !== 'move') return;
    if (!d.moved && Math.abs(e.clientX - d.x) < DRAG_PX) return;
    d.moved = true;
    const at = dropAt(e.clientX);
    if (at && (drop?.target !== at.target || drop.after !== at.after))
      setDrop({ moving: d.id, ...at });
  }
  function onBlockUp(e: PointerEvent, entry: TimelineEntry) {
    const d = drag.current;
    drag.current = null;
    setDrop(null);
    if (d?.kind !== 'move' || !d.moved) return;
    dragged.current = true;
    const at = dropAt(e.clientX);
    if (at && groups) move(reorderTarget(groups, entry.frame.id, at.target, at.after), d.id);
  }
  function onCancel() {
    drag.current = null;
    setDraft(null);
    setDrop(null);
  }

  function onHandleKey(e: KeyboardEvent, entry: TimelineEntry) {
    const length = entry.end - entry.start;
    const step = e.key.startsWith('Page') ? 4 * DURATION_STEP_MS : DURATION_STEP_MS;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp')
      setDuration(entry.frame, length + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown')
      setDuration(entry.frame, length - step);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  function onBlockKey(e: KeyboardEvent, entry: TimelineEntry) {
    if (!canMove || !groups || !e.altKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const id = entry.frame.id;
    move(neighbourTarget(groups, timeline, id, e.key === 'ArrowRight' ? 1 : -1), id);
    // The block is drawn again in its new place: keep the keyboard on it.
    requestAnimationFrame(() =>
      track.current?.querySelector<HTMLElement>(`[data-frame="${id}"] button`)?.focus(),
    );
  }

  return timeline.map((entry, i) => {
    const length = draft?.id === entry.frame.id ? draft.ms : entry.end - entry.start;
    const sceneStart =
      i > 0 && (timeline[i - 1]?.frame.parent ?? null) !== (entry.frame.parent ?? null);
    const marker =
      drop && drop.moving !== entry.frame.id && drop.target === entry.frame.id
        ? drop.after
          ? ' drop-after'
          : ' drop-before'
        : '';
    return (
      <div
        key={entry.frame.id}
        data-frame={entry.frame.id}
        className={`animatic__block${entry === active ? ' is-active' : ''}${entry.frame.durationMs === undefined && draft?.id !== entry.frame.id ? ' is-preview' : ''}${sceneStart ? ' is-scene-start' : ''}${drop?.moving === entry.frame.id ? ' is-moving' : ''}${marker}`}
        style={{ flexGrow: length }}
      >
        <button
          type="button"
          className="animatic__block-seek"
          aria-current={entry === active ? 'true' : undefined}
          aria-label={t('film.playback.block', {
            label: label(entry),
            duration: seconds(length),
          })}
          aria-keyshortcuts={canMove ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
          onClick={() => {
            if (!dragged.current) onSeek(entry.start);
            dragged.current = false;
          }}
          onPointerDown={(e) => onBlockDown(e, entry)}
          onPointerMove={onBlockMove}
          onPointerUp={(e) => onBlockUp(e, entry)}
          onPointerCancel={onCancel}
          onKeyDown={(e) => onBlockKey(e, entry)}
        >
          <span className="animatic__block-label">{label(entry)}</span>
          <span className="animatic__block-time">{seconds(length)}</span>
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
            aria-valuetext={seconds(length)}
            onPointerDown={(e) => onHandleDown(e, entry)}
            onPointerMove={(e) => onHandleMove(e, entry)}
            onPointerUp={() => onHandleUp(entry)}
            onPointerCancel={onCancel}
            onKeyDown={(e) => onHandleKey(e, entry)}
          />
        )}
      </div>
    );
  });
});
