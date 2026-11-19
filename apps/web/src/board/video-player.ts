// SPDX-License-Identifier: AGPL-3.0-only
/** The pure parts of Inkadra's video player (decision 0133): time, keys and layout. */

const whole = (seconds: number) => Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));

/** `0:48`, `12:05`, `1:02:09`: whole seconds played, never ahead of the picture. */
export function clock(seconds: number): string {
  const total = whole(seconds);
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * `00:00:02:12`: hours, minutes, seconds and frames at `fps` (non-drop: 29.97 counts as 30),
 * as an editor reads it; m:ss without a frame rate.
 */
export function timecode(seconds: number, fps: number | null | undefined): string {
  const base = fps && fps > 0 ? Math.round(fps) : 0;
  if (!base) return clock(seconds);
  const frames = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * base + 1e-6);
  const two = (n: number) => String(n).padStart(2, '0');
  const total = Math.floor(frames / base);
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60, frames % base]
    .map(two)
    .join(':');
}

export type PlayerAction =
  | 'toggle'
  | 'back5'
  | 'forward5'
  | 'back10'
  | 'forward10'
  | 'previousFrame'
  | 'nextFrame'
  | 'mute'
  | 'fullscreen'
  | 'quality';

interface Key {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * What a key does to the focused player: Space/K play, ←/→ 5 s, J/L 10 s, `,` `.` (and ⇧←/→,
 * as in the viewer before) one frame while paused, M mute, F fullscreen, Q quality.
 * Null leaves the key to whoever else listens.
 */
export function playerAction(e: Key, paused: boolean): PlayerAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
    return paused ? (e.key === 'ArrowLeft' ? 'previousFrame' : 'nextFrame') : null;
  switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
    case ' ':
    case 'k':
      return 'toggle';
    case 'ArrowLeft':
      return 'back5';
    case 'ArrowRight':
      return 'forward5';
    case 'j':
      return 'back10';
    case 'l':
      return 'forward10';
    case ',':
      return paused ? 'previousFrame' : null;
    case '.':
      return paused ? 'nextFrame' : null;
    case 'm':
      return 'mute';
    case 'f':
      return 'fullscreen';
    case 'q':
      return 'quality';
    default:
      return null;
  }
}

/** A card under this width (its own, not the window's) loses volume and the total time. */
export const COMPACT_WIDTH = 360;
/** A viewer narrower than this gets the phone layout: big buttons in the middle. */
export const PHONE_WIDTH = 600;

export type PlayerVariant = 'card' | 'viewer';

/** How the controls are laid out at `width` CSS pixels of the player. */
export function playerLayout(width: number, variant: PlayerVariant) {
  return {
    compact: variant === 'card' && width > 0 && width < COMPACT_WIDTH,
    phone: variant === 'viewer' && width > 0 && width < PHONE_WIDTH,
  };
}
