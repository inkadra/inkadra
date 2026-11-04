import type { FeedbackStatus } from '@inkadra/shared';
import { useSyncExternalStore } from 'react';

/** Light on purpose: the board's toasts and menus read it without loading the report form. */
let status: FeedbackStatus | null = null;
const listeners = new Set<() => void>();

export function setFeedbackStatus(next: FeedbackStatus | null) {
  status = next;
  for (const listener of listeners) listener();
}
export function useFeedbackStatus() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}

export interface FeedbackPrefill {
  /** Becomes the title; the details go to the log the person reviews. */
  title?: string;
  details?: string;
  errorId?: string;
}
const OPEN = 'inkadra:feedback';
export function openFeedback(prefill?: FeedbackPrefill) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: prefill }));
}
export function onOpenFeedback(listener: (prefill?: FeedbackPrefill) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<FeedbackPrefill>).detail);
  window.addEventListener(OPEN, handler);
  return () => window.removeEventListener(OPEN, handler);
}
export const STATUS_CHANGED = 'inkadra:feedback-configured';
