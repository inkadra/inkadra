// SPDX-License-Identifier: AGPL-3.0-only
import { formatDuration } from '@inkadra/canvas-core';
import { Icon } from '@inkadra/ui';
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** The one audio playing on the board: starting another pauses it. */
let playing: HTMLAudioElement | null = null;

function claim(audio: HTMLAudioElement) {
  if (playing && playing !== audio) playing.pause();
  playing = audio;
}

function release(audio: HTMLAudioElement) {
  if (playing === audio) playing = null;
}

/** Tests only. */
export function resetAudioPlayers() {
  playing = null;
}

/** 0:48: whole seconds played, never ahead of the sound. */
const clock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * The themed mini player of an audio card: a round play button, a thin bar to scrub (flat
 * until the worker draws waveforms, #327) and the time in a chip. A hidden `<audio>` plays.
 * Space toggles while the player has focus; only one audio plays on a board at a time.
 */
export function AudioPlayer({
  src,
  name,
  durationMs,
}: {
  src: string;
  name: string;
  durationMs: number | null;
}) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationMs ? durationMs / 1000 : 0);
  const scrubbing = useRef(false);

  useEffect(() => {
    const el = audio.current;
    return () => {
      if (!el) return;
      el.pause();
      release(el);
    };
  }, []);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      claim(el);
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
        onPlay={(e) => {
          claim(e.currentTarget);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          setPlaying(false);
          release(e.currentTarget);
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
        className="fcard__scrub"
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
        <span className="fcard__scrub-track">
          <span className="fcard__scrub-fill" style={{ width: `${progress * 100}%` }} />
          <span className="fcard__scrub-knob" style={{ left: `${progress * 100}%` }} />
        </span>
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
