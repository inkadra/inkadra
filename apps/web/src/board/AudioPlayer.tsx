// SPDX-License-Identifier: AGPL-3.0-only
import { formatDuration } from '@inkadra/canvas-core';
import { AudioWaveform } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInlineMedia } from './inline-player.ts';

/** Tests only. */
export function resetAudioPlayers() {
  waveforms.clear();
}

/** Waveforms by URL, fetched once per page: they never change. */
const waveforms = new Map<string, Promise<number[] | null>>();

/** The peaks the worker read for an audio file (#327); null until they arrive, or without. */
export function useWaveform(url: string | null): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!url) return;
    let live = true;
    let load = waveforms.get(url);
    if (!load) {
      load = fetch(url, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => AudioWaveform.safeParse(json).data?.peaks ?? null)
        .catch(() => null);
      waveforms.set(url, load);
    }
    void load.then((p) => {
      // A failed fetch is tried again the next time a card asks.
      if (!p) waveforms.delete(url);
      if (live) setPeaks(p);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return peaks;
}

/** `count` bars of `peaks` (0–100), each the loudest of its slice; none without peaks. */
export function waveformBars(peaks: readonly number[], count: number): number[] {
  if (peaks.length === 0 || count <= 0) return [];
  const n = Math.min(count, peaks.length);
  return Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * peaks.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / n));
    return Math.max(...peaks.slice(from, to));
  });
}

/** 0:48: whole seconds played, never ahead of the sound. */
const clock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * The themed mini player of an audio card: a round play button, the waveform to scrub (a thin
 * bar until the worker has read it, or without ffmpeg) and the time in a chip. A hidden
 * `<audio>` plays. Space toggles while the player has focus; only one sound plays on a board
 * at a time, with link card videos and the viewer (inline-player.ts).
 */
export function AudioPlayer({
  id,
  src,
  name,
  durationMs,
  peaks = null,
  bars = 32,
}: {
  /** The card's element id: its turn in the one-player rule. */
  id: string;
  src: string;
  name: string;
  durationMs: number | null;
  peaks?: readonly number[] | null;
  /** Bars the waveform is drawn with, from the width of the card. */
  bars?: number;
}) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationMs ? durationMs / 1000 : 0);
  const scrubbing = useRef(false);
  const turn = useInlineMedia(id, audio);

  useEffect(() => {
    const el = audio.current;
    return () => el?.pause();
  }, []);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      void el.play()?.catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }

  function seekTo(seconds: number) {
    const el = audio.current;
    if (!el || !(duration > 0)) return;
    const next = clamp(seconds, 0, duration);
    el.currentTime = next;
    setTime(next);
  }

  function seekAt(e: PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    seekTo(((e.clientX - box.left) / box.width) * duration);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== ' ') return;
    // The board pans with Space, and a focused button would click on key up: neither here.
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'keydown' && !e.repeat) toggle();
  }

  const progress = duration > 0 ? clamp(time / duration, 0, 1) : 0;
  const wave = peaks ? waveformBars(peaks, bars) : [];
  const label = t(isPlaying ? 'board.file.pause' : 'board.file.play', { name });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Space for the whole player, as on the play button
    <div
      className={`fcard__player${isPlaying ? ' is-playing' : ''}`}
      data-no-drag
      onKeyDown={onKey}
      onKeyUp={onKey}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: people's own recordings have no captions */}
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        hidden
        onPlay={() => {
          turn.onPlay();
          setPlaying(true);
        }}
        onPause={() => {
          turn.onPause();
          setPlaying(false);
        }}
        onTimeUpdate={(e) => {
          if (!scrubbing.current) setTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
      />
      <div
        className={`fcard__scrub${wave.length > 0 ? ' fcard__scrub--wave' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label={t('board.file.seek', { name })}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${clock(time)} / ${formatDuration(duration * 1000)}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          scrubbing.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          seekAt(e);
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) seekAt(e);
        }}
        onPointerUp={(e) => {
          scrubbing.current = false;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={() => {
          scrubbing.current = false;
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 5;
          if (e.key === 'ArrowRight') seekTo(time + step);
          else if (e.key === 'ArrowLeft') seekTo(time - step);
          else if (e.key === 'Home') seekTo(0);
          else if (e.key === 'End') seekTo(duration);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {wave.length > 0 ? (
          <span className="fcard__wave" aria-hidden="true">
            {wave.map((h, i) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: bars are positions in time
                key={i}
                className={(i + 0.5) / wave.length <= progress ? 'is-played' : undefined}
                style={{ height: `${Math.max(8, h)}%` }}
              />
            ))}
          </span>
        ) : (
          <span className="fcard__scrub-track">
            <span className="fcard__scrub-fill" style={{ width: `${progress * 100}%` }} />
            <span className="fcard__scrub-knob" style={{ left: `${progress * 100}%` }} />
          </span>
        )}
      </div>
      <button
        type="button"
        className="card__play fcard__audio-play"
        aria-label={label}
        aria-pressed={isPlaying}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <Icon name={isPlaying ? 'pause' : 'play'} size={12} />
      </button>
      <span className="card__duration fcard__audio-time">
        {clock(time)} / {formatDuration(duration * 1000)}
      </span>
    </div>
  );
}
