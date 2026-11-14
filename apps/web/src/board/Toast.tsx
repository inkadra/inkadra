import { Icon, useExitFade } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { openFeedback, useFeedbackStatus } from '../feedback/state.ts';
import './toast.css';

/** How long a toast stays; the pointer or the focus on it pauses the count (#310). */
export const TOAST_MS = 6000;
/** A toast that offers Show or Undo stays longer: there is time to read it and then act. */
export const TOAST_ACTION_MS = 12_000;

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
  /** The words of the `onShow` button, "Mostra" by default. */
  showLabel?: string | undefined;
  /** Something failed: the toast offers to report it, when reporting is on. */
  error?: boolean | undefined;
  /** Brings what was added into view. */
  onShow?: (() => void) | undefined;
  onUndo?: (() => void) | undefined;
  /** The history `onUndo` belongs to: Undo leaves once another edit or ⌘Z changes it. */
  history?: Pick<Y.UndoManager, 'on' | 'off'> | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
  const feedback = useFeedbackStatus();
  const canReport = !!error && !!feedback?.enabled;
  const actions = !!onShow || !!onUndo || canReport;
  return (
    <div
      ref={ref}
      className="toast ink-motion-rise"
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
        <span className="toast__ok" aria-hidden="true">
          <Icon name="check" size={11} />
        </span>
      )}
      {warning && (
        <span className={`toast__warning toast__warning--${warning}`} aria-hidden="true">
          <Icon name="warning" size={14} />
        </span>
      )}
      <span className="toast__text">{text}</span>
      {canReport && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            openFeedback({ title: text });
            onClose();
          }}
        >
          {t('feedback.report')}
        </button>
      )}
      {onShow && (
        <button type="button" className="toast__action" onClick={onShow}>
          {showLabel ?? t('board.show')}
        </button>
      )}
      {onUndo && !stale && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            onUndo();
            onClose();
          }}
        >
          {t('board.undo')}
        </button>
      )}
      {actions && (
        <>
          <span className="toast__divider" aria-hidden="true" />
          <button
            type="button"
            className="toast__close"
            aria-label={t('board.toastClose')}
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
          <span
            className="toast__bar"
            aria-hidden="true"
            data-held={held || undefined}
            style={{ animationDuration: `${time}ms` }}
          />
        </>
      )}
    </div>
  );
}
