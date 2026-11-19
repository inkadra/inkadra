// SPDX-License-Identifier: AGPL-3.0-only
import type { Asset } from '@inkadra/shared';
import { Icon, Slider } from '@inkadra/ui';
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type VideoHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { QualityMenu } from './QualityMenu.tsx';
import {
  clock,
  type PlayerAction,
  type PlayerVariant,
  playerAction,
  playerLayout,
  timecode,
} from './video-player.ts';
import type { QualityChoice } from './video-source.ts';

/** Controls go away after this long of playback without the pointer moving. */
const HIDE_AFTER_MS = 2000;
/** The speed chip goes round these. */
const RATES = [1, 1.5, 2, 0.5];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface PlayerQuality {
  asset: Asset;
  choice: QualityChoice;
  onChoose: (choice: QualityChoice) => void;
  /** Height playing on Auto, when the player says it. */
  playing: number | null;
}

/**
 * Inkadra's own video player (decision 0133), in place of the browser's controls on cards, in
 * the viewer and for guests: a dark bar over the video with the timeline, play, volume, time,
 * the Quality chip and, in the viewer, frame steps, speed, picture in picture and full screen.
 * The layout follows the player's own width (a card's depends on the board, not the window).
 * Position, buffer and time are painted straight into the page on every frame while playing,
 * so nothing around the player renders again.
 */
export function VideoPlayer({
  videoRef,
  variant,
  frameRate,
  durationMs,
  quality,
  onOpenViewer,
  onStep,
  hidden = false,
  tour,
  playLink,
  video,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  variant: PlayerVariant;
  frameRate?: number | null;
  /** What the asset says, until the video knows its own. */
  durationMs?: number | null;
  /** The Quality chip, when the video has copies to choose from (decision 0128). */
  quality?: PlayerQuality | null;
  /** The card's button that opens the viewer. */
  onOpenViewer?: () => void;
  /** One frame back or ahead while paused; a frame at `frameRate` (else 30) when absent. */
  onStep?: (direction: -1 | 1) => void;
  /** The video stays mounted but out of sight (a format the browser cannot play). */
  hidden?: boolean;
  tour?: string;
  playLink?: string;
  /** Attributes and handlers of the `<video>` itself. */
  video: VideoHTMLAttributes<HTMLVideoElement> & { className?: string };
}) {
  const { t, i18n } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const timeText = useRef<HTMLSpanElement>(null);
  const tipText = useRef<HTMLSpanElement>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [duration, setDuration] = useState(durationMs ? durationMs / 1000 : 0);
  const [layout, setLayout] = useState({ compact: false, phone: false });
  const [awake, setAwake] = useState(true);
  // Timecode in a wide viewer, m:ss on cards and phones, until the person clicks the time.
  const [clockChoice, setClockChoice] = useState<boolean | null>(null);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const scrub = useRef<number | null>(null);
  const seekFrame = useRef(0);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const awakeNow = useRef(true);
  const pointerType = useRef('mouse');
  const viewer = variant === 'viewer';
  const { compact, phone } = layout;
  const useClock = clockChoice ?? (variant === 'card' || phone || !frameRate);
  const format = (seconds: number) => (useClock ? clock(seconds) : timecode(seconds, frameRate));

  const length = () => {
    const v = videoRef.current;
    return v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : duration;
  };

  // Painted outside React: the bar's position, buffer, thumb and time, and the slider's value.
  const paint = useRef(() => {});
  paint.current = () => {
    const v = videoRef.current;
    const bar = timeline.current;
    if (!v || !bar) return;
    const d = length();
    const at = scrub.current ?? v.currentTime;
    bar.style.setProperty('--played', String(d > 0 ? clamp(at / d, 0, 1) : 0));
    let buffered = 0;
    for (let i = 0; i < v.buffered.length; i++)
      if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime)
        buffered = v.buffered.end(i);
    bar.style.setProperty('--buffered', String(d > 0 ? clamp(buffered / d, 0, 1) : 0));
    const text = format(at);
    if (timeText.current && timeText.current.textContent !== text)
      timeText.current.textContent = text;
    const value = `${clock(at)} / ${clock(d)}`;
    if (bar.getAttribute('aria-valuetext') !== value) {
      bar.setAttribute('aria-valuenow', String(Math.floor(at)));
      bar.setAttribute('aria-valuetext', value);
    }
  };
  // After every render: a remounted time keeps its text, a new format shows at once.
  useLayoutEffect(() => paint.current());

  // The state of the element, as it changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      setPaused(v.paused);
      setMuted(v.muted);
      setVolume(v.volume);
      setRate(v.playbackRate);
      if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
      paint.current();
    };
    const busy = () => setWaiting(!v.paused);
    const ready = () => setWaiting(false);
    const pictureIn = () => setPip(true);
    const pictureOut = () => setPip(false);
    const repaint = () => paint.current();
    const on: Array<[string, () => void]> = [
      ['play', sync],
      ['pause', sync],
      ['volumechange', sync],
      ['ratechange', sync],
      ['durationchange', sync],
      ['loadedmetadata', sync],
      ['waiting', busy],
      ['playing', ready],
      ['canplay', ready],
      ['pause', ready],
      ['seeked', ready],
      ['error', ready],
      ['timeupdate', repaint],
      ['progress', repaint],
      ['seeking', repaint],
      ['enterpictureinpicture', pictureIn],
      ['leavepictureinpicture', pictureOut],
    ];
    for (const [name, fn] of on) v.addEventListener(name, fn);
    sync();
    return () => {
      for (const [name, fn] of on) v.removeEventListener(name, fn);
    };
  }, [videoRef]);

  // Smooth time while playing: one paint per frame, not four `timeupdate` a second.
  useEffect(() => {
    if (paused) return;
    let frame = 0;
    const tick = () => {
      paint.current();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused]);

  // The player's own size picks the layout, and bounds the Quality menu.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (width: number, height: number) => {
      el.style.setProperty('--vplayer-h', `${Math.round(height)}px`);
      const next = playerLayout(width, variant);
      setLayout((prev) =>
        prev.compact === next.compact && prev.phone === next.phone ? prev : next,
      );
    };
    measure(el.offsetWidth, el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [variant]);

  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', change);
    return () => {
      document.removeEventListener('fullscreenchange', change);
      clearTimeout(sleepTimer.current);
      cancelAnimationFrame(seekFrame.current);
    };
  }, []);

  const sleep = () => {
    clearTimeout(sleepTimer.current);
    awakeNow.current = false;
    setAwake(false);
  };
  const wake = () => {
    if (!awakeNow.current) {
      awakeNow.current = true;
      setAwake(true);
    }
    clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(sleep, HIDE_AFTER_MS);
  };

  // Playback starts the countdown that hides the controls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: wake reads refs and setters only
  useEffect(() => {
    if (!paused) wake();
  }, [paused]);

  const play = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play()?.catch(() => {});
    else v.pause();
  };
  const seekTo = (seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clamp(seconds, 0, length() || 0);
    paint.current();
  };
  const step = (direction: -1 | 1) => {
    const v = videoRef.current;
    if (!v?.paused) return;
    if (onStep) onStep(direction);
    else seekTo(v.currentTime + direction / (frameRate || 30));
  };
  const toggleFullscreen = () => {
    const el = box.current;
    const v = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {});
    // iPhone: only the video element itself goes full screen, with the system's controls.
    else v?.webkitEnterFullscreen?.();
  };
  const togglePip = () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void v.requestPictureInPicture?.().catch(() => {});
  };
  const run = (action: PlayerAction) => {
    const v = videoRef.current;
    if (!v) return;
    if (action === 'toggle') play();
    else if (action === 'back5') seekTo(v.currentTime - 5);
    else if (action === 'forward5') seekTo(v.currentTime + 5);
    else if (action === 'back10') seekTo(v.currentTime - 10);
    else if (action === 'forward10') seekTo(v.currentTime + 10);
    else if (action === 'previousFrame') step(-1);
    else if (action === 'nextFrame') step(1);
    else if (action === 'mute') v.muted = !v.muted;
    else if (action === 'fullscreen') toggleFullscreen();
    else box.current?.querySelector<HTMLButtonElement>('.viewer-quality__button')?.click();
    wake();
  };

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    // The Quality menu walks its own items.
    if (target.closest('[role="menu"]')) return;
    const action = playerAction(e, videoRef.current?.paused ?? true);
    if (!action) return;
    // Space presses the focused button, the arrows move the volume: the browser does both.
    if (e.key === ' ' && target.matches('button')) return;
    if (e.key.startsWith('Arrow') && target.matches('input')) return;
    e.preventDefault();
    // The board pans with Space and moves cards with the arrows: neither while the player has them.
    e.stopPropagation();
    if (e.type !== 'keydown') return;
    if (e.repeat && !['back5', 'forward5', 'back10', 'forward10'].includes(action)) return;
    run(action);
  }

  const fractionAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return box.width > 0 ? clamp((e.clientX - box.left) / box.width, 0, 1) : 0;
  };
  // Seeks while dragging, at most once a frame: the bar follows the pointer meanwhile.
  const seekSoon = () => {
    if (seekFrame.current) return;
    seekFrame.current = requestAnimationFrame(() => {
      seekFrame.current = 0;
      const v = videoRef.current;
      if (v && scrub.current !== null) v.currentTime = scrub.current;
    });
  };
  const hover = (e: PointerEvent<HTMLDivElement>) => {
    const f = fractionAt(e);
    e.currentTarget.style.setProperty('--hover', String(f));
    if (tipText.current) tipText.current.textContent = format(f * length());
    return f;
  };

  const rateLabel = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(rate);
  const canPip =
    viewer && typeof document !== 'undefined' && document.pictureInPictureEnabled === true;
  const toggleLabel = t(paused ? 'viewer.player.play' : 'viewer.player.pause');
  const idle = !paused && !awake;

  const bar = (
    <div
      ref={timeline}
      className="vplayer__timeline"
      role="slider"
      tabIndex={0}
      aria-label={t('viewer.player.seek')}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      // A constant to React: paint() writes the real value, and React never sets it again.
      aria-valuenow={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        scrub.current = hover(e) * length();
        e.currentTarget.classList.add('is-scrubbing');
        paint.current();
        seekSoon();
      }}
      onPointerMove={(e) => {
        const f = hover(e);
        if (scrub.current === null) return;
        scrub.current = f * length();
        paint.current();
        seekSoon();
      }}
      onPointerUp={(e) => {
        if (scrub.current === null) return;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        e.currentTarget.classList.remove('is-scrubbing');
        const at = scrub.current;
        scrub.current = null;
        seekTo(at);
      }}
      onPointerCancel={(e) => {
        scrub.current = null;
        e.currentTarget.classList.remove('is-scrubbing');
        paint.current();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        e.stopPropagation();
        seekTo(e.key === 'Home' ? 0 : length());
      }}
    >
      <span className="vplayer__track" aria-hidden="true">
        <i className="vplayer__buffered" />
        <i className="vplayer__played" />
      </span>
      <span className="vplayer__thumb-track" aria-hidden="true">
        <i className="vplayer__thumb" />
      </span>
      <span className="vplayer__tip-track" aria-hidden="true">
        <span ref={tipText} className="vplayer__tip" />
      </span>
    </div>
  );

  const time = (
    <>
      <span ref={timeText} />
      {!compact && <span className="vplayer__total">{` / ${format(duration)}`}</span>}
    </>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys of the focused player (K, J, L, M, F, Q…); every control is also a button
    <div
      ref={box}
      className={[
        'vplayer',
        `vplayer--${variant}`,
        compact && 'vplayer--compact',
        phone && 'vplayer--phone',
        idle && 'vplayer--idle',
        paused && 'is-paused',
      ]
        .filter(Boolean)
        .join(' ')}
      style={hidden ? { display: 'none' } : undefined}
      data-video-player
      data-tour={tour}
      data-play-link={playLink}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') wake();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && scrub.current === null) sleep();
      }}
      onKeyDown={onKey}
      onKeyUp={onKey}
    >
      <video
        {...video}
        ref={videoRef}
        playsInline
        onPointerDown={(e) => {
          pointerType.current = e.pointerType;
        }}
        onClick={() => {
          // A finger shows and hides the controls; a mouse plays and pauses.
          if (pointerType.current === 'mouse') return play();
          if (awakeNow.current && !videoRef.current?.paused) sleep();
          else wake();
        }}
        onDoubleClick={() => viewer && pointerType.current === 'mouse' && toggleFullscreen()}
      />
      {waiting && !paused && (
        <span className="vplayer__spinner" role="img" aria-label={t('viewer.player.loading')} />
      )}
      <span className="vplayer__scrim" aria-hidden="true" />
      {phone && (
        <div className="vplayer__center">
          <button
            type="button"
            className="vplayer__btn vplayer__btn--round"
            aria-label={t('viewer.player.back10')}
            onClick={() => run('back10')}
          >
            <Icon name="back10" size={20} />
          </button>
          <button
            type="button"
            className="vplayer__btn vplayer__btn--round vplayer__btn--big vplayer__toggle"
            aria-label={toggleLabel}
            onClick={() => run('toggle')}
          >
            <Icon name={paused ? 'play' : 'pause'} size={24} />
          </button>
          <button
            type="button"
            className="vplayer__btn vplayer__btn--round"
            aria-label={t('viewer.player.forward10')}
            onClick={() => run('forward10')}
          >
            <Icon name="forward10" size={20} />
          </button>
        </div>
      )}
      <div className="vplayer__bar">
        {!phone && bar}
        <div className="vplayer__row">
          {!phone && (
            <button
              type="button"
              className="vplayer__btn vplayer__toggle"
              aria-label={toggleLabel}
              onClick={() => run('toggle')}
            >
              <Icon name={paused ? 'play' : 'pause'} size={18} />
            </button>
          )}
          {viewer && !phone && paused && (
            <>
              <button
                type="button"
                className="vplayer__btn"
                aria-label={t('viewer.player.previousFrame')}
                onClick={() => step(-1)}
              >
                <Icon name="framePrevious" size={18} />
              </button>
              <button
                type="button"
                className="vplayer__btn"
                aria-label={t('viewer.player.nextFrame')}
                onClick={() => step(1)}
              >
                <Icon name="frameNext" size={18} />
              </button>
            </>
          )}
          {!compact && !phone && (
            <button
              type="button"
              className="vplayer__btn"
              aria-label={t(muted ? 'viewer.player.unmute' : 'viewer.player.mute')}
              aria-pressed={muted}
              onClick={() => run('mute')}
            >
              <Icon name={muted || volume === 0 ? 'mute' : 'volume'} size={18} />
            </button>
          )}
          {viewer && !phone && !compact && (
            <Slider
              className="vplayer__volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label={t('viewer.player.volume')}
              onChange={(value) => {
                const v = videoRef.current;
                if (!v) return;
                v.volume = value;
                v.muted = value === 0;
              }}
            />
          )}
          {viewer && frameRate ? (
            <button
              type="button"
              className="vplayer__time vplayer__time--button"
              aria-label={t(useClock ? 'viewer.player.showTimecode' : 'viewer.player.showClock')}
              onClick={() => setClockChoice(!useClock)}
            >
              {time}
            </button>
          ) : (
            <span className="vplayer__time">{time}</span>
          )}
          <span className="vplayer__spacer" />
          {viewer && !phone && (
            <button
              type="button"
              className="vplayer__chip"
              aria-label={t('viewer.player.speed', { rate: rateLabel })}
              onClick={() => {
                const v = videoRef.current;
                if (v) v.playbackRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
              }}
            >
              {rateLabel}×
            </button>
          )}
          {quality && (
            <QualityMenu
              asset={quality.asset}
              choice={quality.choice}
              onChoose={quality.onChoose}
              playing={quality.playing}
              compact={compact}
            />
          )}
          {canPip && !phone && (
            <button
              type="button"
              className="vplayer__btn"
              aria-label={t('viewer.player.pip')}
              aria-pressed={pip}
              onClick={togglePip}
            >
              <Icon name="pictureInPicture" size={18} />
            </button>
          )}
          {viewer && (
            <button
              type="button"
              className="vplayer__btn"
              aria-label={t(
                fullscreen ? 'viewer.player.exitFullscreen' : 'viewer.player.fullscreen',
              )}
              onClick={toggleFullscreen}
            >
              <Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} size={18} />
            </button>
          )}
          {onOpenViewer && (
            <button
              type="button"
              className="vplayer__btn"
              aria-label={t('viewer.player.openViewer')}
              onClick={(e) => {
                e.stopPropagation();
                onOpenViewer();
              }}
            >
              <Icon name="expand" size={18} />
            </button>
          )}
        </div>
        {phone && bar}
      </div>
    </div>
  );
}
