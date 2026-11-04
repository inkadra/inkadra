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

/** By the character, as the board's shortcuts: AltGr (Ctrl+Alt) types text and is left alone. */
export function isFeedbackKey(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key: string;
}) {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b';
}

/**
 * What the automatic screenshot leaves out: the report form itself, password and read-only fields
 * (they hold links and tokens to copy), and anything marked `data-feedback-secret`. Mark every new
 * place that shows a secret on screen.
 */
export function leftOutOfScreenshot(node: Node) {
  if (!(node instanceof Element)) return false;
  return (
    !!node.closest('[data-feedback-exclude],[data-feedback-secret]') ||
    (node instanceof HTMLInputElement && (node.type === 'password' || node.readOnly)) ||
    (node instanceof HTMLTextAreaElement && node.readOnly)
  );
}

export interface FeedbackDraft {
  title: string;
  description: string;
  type: 'bug' | 'idea' | 'question';
  /** Kept with the text: sending again after a reload cannot make a second report. */
  requestId: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readFeedbackDraft(key: string): Partial<FeedbackDraft> | null {
  try {
    const draft = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!draft || typeof draft !== 'object') return null;
    return {
      title: typeof draft.title === 'string' ? draft.title : '',
      description: typeof draft.description === 'string' ? draft.description : '',
      ...(['bug', 'idea', 'question'].includes(draft.type) ? { type: draft.type } : {}),
      ...(UUID.test(draft.requestId) ? { requestId: draft.requestId } : {}),
    };
  } catch {
    return null;
  }
}
