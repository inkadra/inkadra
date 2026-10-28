// SPDX-License-Identifier: AGPL-3.0-only
import { useSyncExternalStore } from 'react';

/** Matches the mobile shell breakpoint in mobile-shell.css. */
const PHONE = '(width < 768px)';

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const query = window.matchMedia(PHONE);
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => (typeof window !== 'undefined' && window.matchMedia?.(PHONE).matches) || false,
    () => false,
  );
}
