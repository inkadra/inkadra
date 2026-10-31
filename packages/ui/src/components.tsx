// SPDX-License-Identifier: MPL-2.0
import {
  type ButtonHTMLAttributes,
  createContext,
  type InputHTMLAttributes,
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
import { Icon, type IconName } from './icons.tsx';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** Two frames side by side, the second at 55%: the Inkadra mark. */
export function Logo({ size = 30, label = 'Inkadra' }: { size?: number; label?: string }) {
  const inner = Math.round(size * 0.55);
  return (
    <span
      role="img"
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        background: 'var(--ink-logo-tile)',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
      }}
    >
      <svg viewBox="0 0 24 24" width={inner} height={inner} aria-hidden="true">
        <rect x="3" y="7" width="8" height="10" rx="1.5" fill="var(--ink-logo-ink)" />
        <rect
          x="13"
          y="7"
          width="8"
          height="10"
          rx="1.5"
          fill="var(--ink-logo-ink)"
          opacity="0.55"
        />
      </svg>
    </span>
  );
}

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span style={{ fontSize: size, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1 }}>
      inkadra
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ink-btn',
        `ink-btn--${variant}`,
        size === 'lg' && 'ink-btn--lg',
        block && 'ink-btn--block',
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-ink-tooltip={label}
      className={cx('ink-iconbtn', className)}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}

export function TextField({
  label,
  error,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cx('ink-field', className)}>
      <label htmlFor={id} className="ink-field__label">
        {label}
      </label>
      <input
        id={id}
        className="ink-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error && (
        <span id={errorId} className="ink-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * A date in the app's own field look: the label or the chosen date, a calendar icon, and the
 * browser's picker on click. The native input stays underneath for typing and for forms.
 */
export function DateField({
  label,
  value,
  onChange,
  clearLabel,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown as a × button while a date is set. */
  clearLabel?: string;
}) {
  const open = (input: HTMLInputElement) => {
    try {
      input.showPicker?.();
    } catch {
      // Not allowed outside a user gesture, or not supported: typing still works.
    }
  };
  const shown = value
    ? new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(`${value}T00:00`))
    : label;
  return (
    <div className={cx('ink-date', value && 'ink-date--set', className)}>
      <span className="ink-date__text" aria-hidden="true">
        {shown}
      </span>
      <input
        {...props}
        type="date"
        className="ink-date__input"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => open(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open(e.currentTarget);
          }
        }}
      />
      {value && clearLabel ? (
        <button
          type="button"
          className="ink-date__clear"
          aria-label={clearLabel}
          disabled={props.disabled}
          onClick={() => onChange('')}
        >
          <Icon name="close" size={14} />
        </button>
      ) : (
        <span className="ink-date__icon" aria-hidden="true">
          <Icon name="calendar" size={16} />
        </span>
      )}
    </div>
  );
}

export interface SliderProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'
  > {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  'aria-label': string;
}

/**
 * A themed range input: thin neutral track, the filled part and thumb in the text colour, the
 * global focus ring. Arrows, Page Up/Down, Home and End work natively.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  style,
  ...props
}: SliderProps) {
  const fill = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={cx('ink-slider', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ['--ink-slider-fill' as string]: `${fill}%`, ...style }}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
      {...props}
    />
  );
}

export function KeyCap({ children }: { children: ReactNode }) {
  return <kbd className="ink-kc">{children}</kbd>;
}

export function Avatar({
  name,
  image,
  size = 28,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span
      className="ink-avatar"
      title={name}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.36) }}
    >
      {image && failed !== image ? (
        <img
          src={image}
          onError={() => setFailed(image)}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
        />
      ) : (
        initials
      )}
    </span>
  );
}

const glyphColor = {
  blue: 'var(--ink-tag-blue)',
  orange: 'var(--ink-tag-orange)',
  purple: 'var(--ink-tag-purple)',
  green: 'var(--ink-tag-green)',
  neutral: 'var(--ink-text-muted)',
  teal: 'var(--ink-tag-teal)',
  yellow: 'var(--ink-tag-yellow)',
  red: 'var(--ink-tag-red)',
  pink: 'var(--ink-tag-pink)',
} as const;

export type GlyphShape =
  | 'diamond'
  | 'circle'
  | 'triangle'
  | 'square'
  | 'hexagon'
  | 'star'
  | 'pentagon'
  | 'cross'
  | 'octagon'
  | 'drop'
  | 'moon'
  | 'clapperboard';
export type GlyphColor = keyof typeof glyphColor;
const GLYPH_SHAPES: readonly GlyphShape[] = [
  'diamond',
  'circle',
  'triangle',
  'square',
  'hexagon',
  'star',
  'pentagon',
  'cross',
  'octagon',
  'drop',
  'moon',
  'clapperboard',
];

/** Project marker: paired frames echo the logo; names remain the accessible identity. */
export function ProjectGlyph({
  shape,
  color,
  emoji,
}: {
  shape: GlyphShape;
  color: GlyphColor;
  emoji?: string | null;
}) {
  if (emoji)
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          width: 18,
          height: 18,
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
          fontSize: 16,
        }}
      >
        {emoji}
      </span>
    );
  const stroke = glyphColor[color] ?? glyphColor.neutral;
  if (!GLYPH_SHAPES.includes(shape)) shape = 'circle';
  const common = { fill: 'none', stroke, strokeWidth: 1.6, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style={{ flex: 'none' }}>
      {shape === 'diamond' && (
        <>
          <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" {...common} />
          <path d="M8 5l3 3-3 3-3-3z" {...common} />
        </>
      )}
      {shape === 'circle' && (
        <>
          <circle cx="8" cy="8" r="6" {...common} />
          <circle cx="8" cy="8" r="2.5" {...common} />
        </>
      )}
      {shape === 'triangle' && (
        <>
          <path d="M8 2l6 11H2z" {...common} />
          <path d="M8 7l2 4H6z" {...common} />
        </>
      )}
      {shape === 'square' && (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" {...common} />
          <rect x="6" y="6" width="4" height="4" rx="0.5" {...common} />
        </>
      )}
      {shape === 'hexagon' && (
        <>
          <path d="M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z" {...common} />
          <path d="M8 5.4l2.25 1.3v2.6L8 10.6 5.75 9.3V6.7z" {...common} />
        </>
      )}
      {shape === 'star' && (
        <>
          <path
            d="M8 1.5l1.9 4.1 4.5.5-3.35 3 .95 4.4L8 11.3l-4 2.2.95-4.4-3.35-3 4.5-.5z"
            {...common}
          />
          <circle cx="8" cy="8.2" r="1.6" {...common} />
        </>
      )}
      {shape === 'pentagon' && (
        <>
          <path d="M8 1.6l6.3 4.6-2.4 7.4H4.1L1.7 6.2z" {...common} />
          <path d="M8 5.6l2.5 1.8-.95 2.9h-3.1l-.95-2.9z" {...common} />
        </>
      )}
      {shape === 'cross' && (
        <>
          <path d="M6 1.8h4v4.2h4.2v4H10v4.2H6V10H1.8V6H6z" {...common} />
          <rect x="6.9" y="6.9" width="2.2" height="2.2" {...common} />
        </>
      )}
      {shape === 'octagon' && (
        <>
          <path d="M5.6 1.8h4.8l3.8 3.8v4.8l-3.8 3.8H5.6l-3.8-3.8V5.6z" {...common} />
          <path d="M7 5.6h2l1.4 1.4v2L9 10.4H7L5.6 9V7z" {...common} />
        </>
      )}
      {shape === 'drop' && (
        <>
          <path d="M8 1.6s5 5.1 5 8.4a5 5 0 0 1-10 0c0-3.3 5-8.4 5-8.4z" {...common} />
          <path d="M8 7.4s2 2 2 3.2a2 2 0 0 1-4 0c0-1.2 2-3.2 2-3.2z" {...common} />
        </>
      )}
      {shape === 'moon' && (
        <>
          <path d="M13.6 9.9A6 6 0 1 1 6.1 2.4a4.9 4.9 0 0 0 7.5 7.5z" {...common} />
          <circle cx="6.4" cy="9.4" r="1.6" {...common} />
        </>
      )}
      {shape === 'clapperboard' && (
        <>
          <rect x="2" y="6.3" width="12" height="7.7" rx="1.2" {...common} />
          <path d="M2 6.3l1.3-3.4 10.6 1.4-.6 2M5.6 3.2l-.8 3M9.2 3.7l-.8 2.6" {...common} />
        </>
      )}
    </svg>
  );
}

export function EmptyState({
  icon = 'image',
  title,
  children,
  actions,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ink-empty">
      <Icon name={icon} />
      <div className="ink-empty__title">{title}</div>
      {children && <div className="ink-muted">{children}</div>}
      {actions && <div className="ink-empty__actions">{actions}</div>}
    </div>
  );
}

const PRESSABLE =
  'button, a[href], input, select, textarea, summary, label, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [contenteditable="true"]';

/**
 * For the capture-phase `pointerdown` listener of a menu or popover that closes on an outside
 * press: a press on empty space only closes it. Neither it nor the click that follows reaches
 * what is underneath, the board included. A press on a control goes through, so one press
 * still reaches another menu's button.
 */
export function swallowOutsidePress(event: Event) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest(PRESSABLE)) return;
  event.stopPropagation();
  // The click follows the release at once. A press that never ends in one (a touch that turns
  // into a scroll is cancelled) must not hold back a later click.
  const pressed = new AbortController();
  document.addEventListener('pointercancel', () => pressed.abort(), {
    capture: true,
    once: true,
    signal: pressed.signal,
  });
  document.addEventListener(
    'pointerup',
    () => {
      pressed.abort();
      const swallow = (e: Event) => e.stopPropagation();
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, true), 0);
    },
    { capture: true, once: true, signal: pressed.signal },
  );
}

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
      {...backdrop}
      // A second Escape in a row cannot be cancelled by the browser: take Escape first.
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || (!dirty && !confirming)) return;
        if (
          event.target instanceof Element &&
          event.target.closest('dialog') !== event.currentTarget
        )
          return;
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
