// SPDX-License-Identifier: AGPL-3.0-only
import { useSyncExternalStore } from 'react';

/** Matches the mobile shell breakpoint in mobile-shell.css. */
const PHONE = '(width < 768px)';
/** A phone-sized window, or a touch screen with no mouse (a phone held sideways, a tablet). */
const PHONE_OR_TOUCH = `${PHONE}, (hover: none) and (pointer: coarse)`;

function useMedia(media: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const query = window.matchMedia(media);
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => (typeof window !== 'undefined' && window.matchMedia?.(media).matches) || false,
    () => false,
  );
}

export const useIsPhone = (): boolean => useMedia(PHONE);
export const useIsPhoneOrTouch = (): boolean => useMedia(PHONE_OR_TOUCH);
