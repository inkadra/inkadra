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
/** A viewer player narrower than this on a desktop gets the compact row, never the phone one. */
export const VIEWER_COMPACT_WIDTH = 560;

export type PlayerVariant = 'card' | 'viewer';

/**
 * How the controls are laid out at `width` CSS pixels of the player. The phone layout (big
 * buttons in the middle, the Quality menu as a sheet) belongs to a phone, `onPhone`: a narrow
 * window or a touch screen. A narrow player on a desktop, such as a portrait video, keeps the
 * desktop controls and drops the ones that do not fit.
 */
export function playerLayout(width: number, variant: PlayerVariant, onPhone = false) {
  const phone = variant === 'viewer' && onPhone;
  const min = variant === 'card' ? COMPACT_WIDTH : VIEWER_COMPACT_WIDTH;
  return { compact: !phone && width > 0 && width < min, phone };
}

/** The short side of a picture: a portrait 1080×1920 copy is a 1080p one, as the server names rungs. */
export const shortSide = (size: { width?: number | null; height?: number | null }) =>
  size.width && size.height ? Math.min(size.width, size.height) : (size.height ?? size.width ?? 0);

/** `720p`, `4K`: how a rung (its name) or a short side is named. */
export const rungLabel = (side: number | string) =>
  Number(side) >= 2000 ? '4K' : `${Number(side)}p`;
