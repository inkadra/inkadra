// SPDX-License-Identifier: MPL-2.0
import {
  createContext,
  type PointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Button } from './components.tsx';
import { cx } from './cx.ts';

/** True for a pointer or click event on the `::backdrop` of a modal <dialog>, not on its content. */
function onBackdrop(e: PointerEvent<HTMLDialogElement> | ReactMouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false;
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

/**
 * Props for a modal <dialog> that asks to close when a click lands on its backdrop. The press
 * must also have started there: selecting text and letting go outside does not close it, nor
 * does a click made with the keyboard.
 */
export function useBackdropClick(onClick: (dialog: HTMLDialogElement) => void) {
  const pressed = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLDialogElement>) => {
      pressed.current = onBackdrop(e);
    },
    onClick: (e: ReactMouseEvent<HTMLDialogElement>) => {
      const hit = pressed.current && onBackdrop(e);
      pressed.current = false;
      if (hit) onClick(e.currentTarget);
    },
  };
}

/** The words of the confirmation a dirty dialog asks before it closes; the app provides its own. */
export interface DialogTexts {
  title: string;
  discard: string;
  keep: string;
}
export const DialogTextsContext = createContext<DialogTexts>({
  title: 'Discard changes?',
  discard: 'Discard',
  keep: 'Keep editing',
});

/** What a dirty `Dialog` tells its `DialogActions`: the row turns into the question. */
const DialogConfirmContext = createContext<{
  confirming: boolean;
  texts: DialogTexts;
  discard: () => void;
  keep: () => void;
  register: () => () => void;
} | null>(null);

function ConfirmButtons({
  texts,
  discard,
  keep,
}: {
  texts: DialogTexts;
  discard: () => void;
  keep: () => void;
}) {
  return (
    <>
      <span className="ink-dialog__confirm-text">{texts.title}</span>
      <Button variant="ghost" onClick={discard}>
        {texts.discard}
      </Button>
      {/* The question takes focus, and the safe answer has it. */}
      <Button variant="primary" autoFocus onClick={keep}>
        {texts.keep}
      </Button>
    </>
  );
}

/** What a `Dialog` hands to its `ref`. */
export interface DialogHandle {
  /** Closes like Escape or a click on the backdrop: asks first when the dialog is `dirty`. */
  requestClose: () => void;
}

/** `env(safe-area-inset-bottom)` in pixels: CSS has it, scripts don't. */
function safeAreaBottom(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;height:env(safe-area-inset-bottom)';
  document.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

/**
 * How far the keyboard reaches over the page. Android Chrome drawn edge to edge (seen on a Pixel 11,
 * Chrome 156) zeroes the bottom safe area while the keyboard is up, and its visual viewport then
 * ends that much below the keyboard's top. iOS keeps the safe area and its viewport is exact.
 */
export function keyboardInset(covered: number, safe: number, safeWithoutKeyboard: number): number {
  return covered > 0 ? covered + Math.max(0, safeWithoutKeyboard - safe) : 0;
}

/** Height of the on-screen keyboard, from the visual viewport; 0 without one. */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    // shortcut: opened with the keyboard already up, there is no reading until it closes once.
    let safeWithoutKeyboard = 0;
    const update = () => {
      const covered = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      );
      const safe = safeAreaBottom();
      if (covered === 0) safeWithoutKeyboard = safe;
      setInset(keyboardInset(covered, safe, safeWithoutKeyboard));
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [enabled]);
  return inset;
}

/**
 * Modal dialog on the native <dialog> element (focus trap and Escape for free). A click on the
 * backdrop closes it like Escape does: `onCancel` can still keep it open.
 *
 * With `dirty` (unsaved input) Escape, the backdrop and `ref.current.requestClose()` (for the
 * Cancel and close buttons) ask "Discard changes?" first, with Keep editing focused; Escape on
 * that question keeps editing. Anything that closes `open` from outside does not ask.
 */
export function Dialog({
  open,
  title,
  onClose,
  onCancel,
  dirty = false,
  ref: handle,
  children,
}: {
  open: boolean;
  title: string;
  /** Runs whenever the dialog has closed, also after Escape. */
  onClose: () => void;
  /** Runs on Escape before the dialog closes; `preventDefault()` asks the browser to keep it open. */
  onCancel?: (event: SyntheticEvent<HTMLDialogElement>) => void;
  /** Unsaved input: closing it by hand asks for confirmation. */
  dirty?: boolean;
  ref?: Ref<DialogHandle>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const texts = useContext(DialogTextsContext);
  const [confirming, setConfirming] = useState(false);
  // Rows of actions inside: the question takes the place of the first, else it has a bar.
  const [actionRows, setActionRows] = useState(0);
  const register = useCallback(() => {
    setActionRows((n) => n + 1);
    return () => setActionRows((n) => n - 1);
  }, []);
  const requestClose = () => {
    const el = ref.current;
    if (!el) return;
    const cancel = new Event('cancel', { cancelable: true });
    el.dispatchEvent(cancel);
    if (!cancel.defaultPrevented) el.close();
  };
  useImperativeHandle(handle, () => ({ requestClose }));
  const backdrop = useBackdropClick(requestClose);
  const inset = useKeyboardInset(open);
  // Centred, a dialog's actions end up under the keyboard: keep it in what is left of the screen.
  const top = inset > 0 ? (window.visualViewport?.offsetTop ?? 0) + 8 : 0;
  useEffect(() => {
    if (!open || !dirty) setConfirming(false);
  }, [open, dirty]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
    // Closing before removal lets the browser restore the element that opened the dialog.
    return () => {
      if (el.open) el.close();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ink-dialog"
      aria-labelledby={titleId}
      style={
        inset > 0
          ? {
              top,
              bottom: 'auto',
              margin: '0 auto',
              maxHeight: window.innerHeight - inset - top - 8,
            }
          : undefined
      }
      {...backdrop}
      // A second Escape in a row cannot be cancelled by the browser: take Escape first.
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (
          event.target instanceof Element &&
          event.target.closest('dialog') !== event.currentTarget
        )
          return;
        event.stopPropagation();
        if (!dirty && !confirming) return;
        event.preventDefault();
        if (confirming) setConfirming(false);
        else requestClose();
      }}
      // React hands a dialog's close and cancel to the dialogs around it too: a dialog opened
      // from another one must not close that one.
      onClose={(event) => event.target === event.currentTarget && onClose()}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        if (confirming) {
          event.preventDefault();
          setConfirming(false);
          return;
        }
        onCancel?.(event);
        if (dirty && !event.defaultPrevented) {
          event.preventDefault();
          setConfirming(true);
        }
      }}
    >
      <h2 id={titleId} className="ink-dialog__title">
        {title}
      </h2>
      <DialogConfirmContext.Provider
        value={{
          confirming,
          texts,
          discard: () => ref.current?.close(),
          keep: () => setConfirming(false),
          register,
        }}
      >
        {children}
      </DialogConfirmContext.Provider>
      {confirming && actionRows === 0 && (
        <div
          className="ink-dialog__confirm ink-dialog__confirm--bar"
          role="alertdialog"
          aria-label={texts.title}
        >
          <ConfirmButtons
            texts={texts}
            discard={() => ref.current?.close()}
            keep={() => setConfirming(false)}
          />
        </div>
      )}
    </dialog>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  const dialog = useContext(DialogConfirmContext);
  const register = dialog?.register;
  useEffect(() => register?.(), [register]);
  return (
    <div className={cx('ink-dialog__actions', dialog?.confirming && 'is-confirming')}>
      {children}
      {dialog?.confirming && (
        <div className="ink-dialog__confirm" role="alertdialog" aria-label={dialog.texts.title}>
          <ConfirmButtons texts={dialog.texts} discard={dialog.discard} keep={dialog.keep} />
        </div>
      )}
    </div>
  );
}
