// SPDX-License-Identifier: MPL-2.0
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type PointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
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
  | 'cross';
export type GlyphColor = keyof typeof glyphColor;

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
  if (
    !['diamond', 'circle', 'triangle', 'square', 'hexagon', 'star', 'pentagon', 'cross'].includes(
      shape,
    )
  )
    shape = 'circle';
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

/**
 * Modal dialog on the native <dialog> element (focus trap and Escape for free). A click on the
 * backdrop closes it like Escape does: `onCancel` can still keep it open.
 */
export function Dialog({
  open,
  title,
  onClose,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  /** Runs whenever the dialog has closed, also after Escape. */
  onClose: () => void;
  /** Runs on Escape before the dialog closes; `preventDefault()` asks the browser to keep it open. */
  onCancel?: (event: SyntheticEvent<HTMLDialogElement>) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const backdrop = useBackdropClick((el) => {
    const cancel = new Event('cancel', { cancelable: true });
    el.dispatchEvent(cancel);
    if (!cancel.defaultPrevented) el.close();
  });
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
      // React hands a dialog's close and cancel to the dialogs around it too: a dialog opened
      // from another one must not close that one.
      onClose={(event) => event.target === event.currentTarget && onClose()}
      onCancel={(event) => event.target === event.currentTarget && onCancel?.(event)}
    >
      <h2 id={titleId} className="ink-dialog__title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="ink-dialog__actions">{children}</div>;
}
