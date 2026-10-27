// SPDX-License-Identifier: MPL-2.0
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
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
      title={label}
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
} as const;

export type GlyphShape = 'diamond' | 'circle' | 'triangle' | 'square';
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
  const stroke = glyphColor[color];
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

/** Modal dialog on the native <dialog> element (focus trap and Escape for free). */
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
      onClose={onClose}
      onCancel={onCancel}
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
