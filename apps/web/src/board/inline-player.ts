import { type RefObject, useEffect, useSyncExternalStore } from 'react';

/**
 * What plays on the board: a link card's video, an audio card (#327) or the viewer's media.
 * Only one at a time: starting another stops it.
 */
let active: string | null = null;
const listeners = new Set<() => void>();

export function playInline(id: string | null): void {
  if (active === id) return;
  active = id;
  for (const listener of listeners) listener();
}

/** Stops the player of this card, if it is the one playing. */
export function stopInline(id: string): void {
  if (active === id) playInline(null);
}

const KEEP_KEY = 'inkadra.video.keepPlayingOffscreen';
const KEEP_EVENT = 'inkadra-video-prefs';

/** Personal setting of this browser, like the theme: off by default, so a video that scrolls away stops. */
export function keepsPlayingOffscreen(): boolean {
  try {
    return localStorage.getItem(KEEP_KEY) === '1';
  } catch {
    return false;
  }
}

export function setKeepsPlayingOffscreen(on: boolean): void {
  try {
    localStorage.setItem(KEEP_KEY, on ? '1' : '0');
    window.dispatchEvent(new Event(KEEP_EVENT));
  } catch {}
}

export function useKeepsPlayingOffscreen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('storage', listener);
      window.addEventListener(KEEP_EVENT, listener);
      return () => {
        window.removeEventListener('storage', listener);
        window.removeEventListener(KEEP_EVENT, listener);
      };
    },
    keepsPlayingOffscreen,
    () => false,
  );
}

/** The card went far off-screen: stop its video unless this person asked to keep it playing. */
export function stopWhenOffscreen(id: string): void {
  if (!keepsPlayingOffscreen()) stopInline(id);
}

export const isPlayingInline = (id: string) => active === id;

export function subscribeInline(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInlinePlaying(id: string): boolean {
  return useSyncExternalStore(
    subscribeInline,
    () => isPlayingInline(id),
    () => false,
  );
}

/**
 * Puts a `<video>` or `<audio>` under the one-player rule as `id`: playing it takes the turn,
 * and it pauses as soon as something else does. Spread the handlers on the element.
 */
export function useInlineMedia(id: string, media: RefObject<HTMLMediaElement | null>) {
  useEffect(() => {
    const off = subscribeInline(() => {
      const el = media.current;
      if (el && !el.paused && !isPlayingInline(id)) el.pause();
    });
    return () => {
      off();
      stopInline(id);
    };
  }, [id, media]);
  return {
    onPlay: () => playInline(id),
    onPause: () => stopInline(id),
  };
}
