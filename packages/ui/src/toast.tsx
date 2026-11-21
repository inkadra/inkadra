// SPDX-License-Identifier: MPL-2.0
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { useExitFade } from './motion.ts';

/** How long a toast stays; the pointer or the focus on it pauses the count (#310). */
export const TOAST_MS = 6000;
/** A toast that offers Show or Undo stays longer: there is time to read it and then act. */
export const TOAST_ACTION_MS = 12_000;

/**
 * The words of the toast in the language of the app, and `report` when reporting a failure
 * is on: given the toast's text, it opens the report.
 */
export interface ToastTexts {
  show: string;
  undo: string;
  close: string;
  report: string;
  onReport?: ((text: string) => void) | undefined;
}
export const ToastTextsContext = createContext<ToastTexts>({
  show: 'Show',
  undo: 'Undo',
  close: 'Close',
  report: 'Report',
});

/** Undo history events, as a Yjs UndoManager sends them. */
type History = {
  on: (event: 'stack-item-added' | 'stack-item-popped', listener: () => void) => void;
  off: (event: 'stack-item-added' | 'stack-item-popped', listener: () => void) => void;
};

export function Toast({
  text,
  ok,
  warning,
  error,
  onShow,
  showLabel,
  onUndo,
  history,
  onClose,
}: {
  text: string;
  /** A check before the text: something was done. */
  ok?: boolean | undefined;
  /** A warning sign before the text, orange or red: something needs a look. */
  warning?: 'warn' | 'danger' | undefined;
  /** The words of the `onShow` button, "Show" by default. */
  showLabel?: string | undefined;
  /** Something failed: the toast offers to report it, when reporting is on. */
  error?: boolean | undefined;
  /** Brings what was added into view. */
  onShow?: (() => void) | undefined;
  onUndo?: (() => void) | undefined;
  /** The history `onUndo` belongs to: Undo leaves once another edit or ⌘Z changes it. */
  history?: History | undefined;
  onClose: () => void;
}) {
  const texts = useContext(ToastTextsContext);
  const ref = useExitFade<HTMLDivElement>();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stale, setStale] = useState(false);
  const time = onShow || onUndo ? TOAST_ACTION_MS : TOAST_MS;
  const left = useRef(time);
  const held = hovered || focused;
  useEffect(() => {
    if (held) return;
    const start = Date.now();
    const timer = setTimeout(onClose, left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - start;
    };
  }, [held, onClose]);
  useEffect(() => {
    if (!history) return;
    const done = () => setStale(true);
    history.on('stack-item-added', done);
    history.on('stack-item-popped', done);
    return () => {
      history.off('stack-item-added', done);
      history.off('stack-item-popped', done);
    };
  }, [history]);
  const report = error ? texts.onReport : undefined;
  const actions = !!onShow || !!onUndo || !!report;
  return (
    <div
      ref={ref}
      className="ink-toast ink-motion-rise"
      role="status"
      data-chrome
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      {ok && (
        <span className="ink-toast__ok" aria-hidden="true">
          <Icon name="check" size={11} />
        </span>
      )}
      {warning && (
        <span className={`ink-toast__warning ink-toast__warning--${warning}`} aria-hidden="true">
          <Icon name="warning" size={14} />
        </span>
      )}
      <span className="ink-toast__text">{text}</span>
      {report && (
        <button
          type="button"
          className="ink-toast__action"
          onClick={() => {
            report(text);
            onClose();
          }}
        >
          {texts.report}
        </button>
      )}
      {onShow && (
        <button type="button" className="ink-toast__action" onClick={onShow}>
          {showLabel ?? texts.show}
        </button>
      )}
      {onUndo && !stale && (
        <button
          type="button"
          className="ink-toast__action"
          onClick={() => {
            onUndo();
            onClose();
          }}
        >
          {texts.undo}
        </button>
      )}
      {actions && (
        <>
          <span className="ink-toast__divider" aria-hidden="true" />
          <button
            type="button"
            className="ink-toast__close"
            aria-label={texts.close}
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
          <span
            className="ink-toast__bar"
            aria-hidden="true"
            data-held={held || undefined}
            style={{ animationDuration: `${time}ms` }}
          />
        </>
      )}
    </div>
  );
}
