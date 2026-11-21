// SPDX-License-Identifier: MPL-2.0
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type JSX,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from 'react';
import { cx } from './cx.ts';
import { Icon, type IconName } from './icons.tsx';

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

type ButtonLook = {
  /** `positive`: a quiet green for a step that closes something, such as Mark as resolved. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'positive';
  size?: 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
};
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonLook & {
    /** Working on it: the button is disabled and tells assistive technology it is busy. */
    busy?: boolean;
    href?: undefined;
    ref?: Ref<HTMLButtonElement>;
  };
/** A link drawn as a button: a download, a page elsewhere. A link has no disabled or busy state. */
type LinkButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'type'> &
  ButtonLook & {
    href: string;
    ref?: Ref<HTMLAnchorElement>;
    disabled?: never;
    busy?: never;
    type?: never;
  };

/** A button; with `href` it is a link (`download`, `target`) that looks the same. */
export function Button(props: LinkButtonProps): JSX.Element;
// The button's signature comes last: `ComponentProps<typeof Button>` reads the last one, and
// consumers deriving the props keep the native button's (#954 review).
export function Button(props: ButtonProps): JSX.Element;
export function Button(props: ButtonProps | LinkButtonProps): JSX.Element {
  const { variant = 'secondary', size = 'md', block, icon, className, children } = props;
  const look = cx(
    'ink-btn',
    `ink-btn--${variant}`,
    size === 'lg' && 'ink-btn--lg',
    block && 'ink-btn--block',
    className,
  );
  const content = (
    <>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </>
  );
  if (props.href !== undefined) {
    // Dropped even when a spread slips them past the types: they would not stop a link.
    const {
      variant: _v,
      size: _s,
      block: _b,
      icon: _i,
      className: _c,
      disabled: _d,
      busy: _bu,
      type: _t,
      ...link
    } = props as LinkButtonProps;
    return (
      <a {...link} className={look}>
        {content}
      </a>
    );
  }
  const {
    variant: _v,
    size: _s,
    block: _b,
    icon: _i,
    className: _c,
    type = 'button',
    busy,
    disabled,
    ...button
  } = props;
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...button}
      className={look}
    >
      {content}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  ref?: Ref<HTMLButtonElement>;
}) {
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

/** A text input in the design system's look, for a field labelled elsewhere or not at all. */
export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input {...props} className={cx('ink-input', className)} />;
}

/** A multi-line text input in the design system's look; see `Input`. */
export function TextArea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea {...props} className={cx('ink-input', className)} />;
}

export function TextField({
  label,
  error,
  className,
  id: ownId,
  'aria-describedby': describedBy,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null }) {
  const generated = useId();
  const id = ownId ?? generated;
  const errorId = `${id}-error`;
  return (
    <div className={cx('ink-field', className)}>
      <label htmlFor={id} className="ink-field__label">
        {label}
      </label>
      <input
        aria-invalid={error ? true : undefined}
        {...props}
        id={id}
        className="ink-input"
        aria-describedby={cx(describedBy, error && errorId) || undefined}
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
  /** A meaningful track; callers supply its gradient and the colour at the current value. */
  meaning?: { gradient: string; thumbColor: string };
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  'aria-label': string;
}

/**
 * A themed range input: neutral track, the filled part and thumb in the text colour, the
 * global focus ring. Arrows, Page Up/Down, Home and End work natively.
 */
export function Slider({
  meaning,
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
      className={cx('ink-slider', meaning && 'ink-slider--meaning', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{
        ['--ink-slider-fill' as string]: `${fill}%`,
        ...(meaning && {
          '--ink-slider-track': meaning.gradient,
          '--ink-slider-thumb': meaning.thumbColor,
        }),
        ...style,
      }}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
      {...props}
    />
  );
}

export function KeyCap({ children }: { children: ReactNode }) {
  return <kbd className="ink-kc">{children}</kbd>;
}

/**
 * A person's photo, or their initials without one. It is named after the person; where the name
 * is written right next to it, `decorative` hides it from assistive technology so the name is
 * not read twice.
 */
export function Avatar({
  name,
  image,
  size = 28,
  decorative,
}: {
  name: string;
  image?: string | null;
  size?: number;
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const initials = name
    .split(/\s+/)
    // "Carla (cliente)" is CC, not C(.
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span
      className="ink-avatar"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
      data-ink-tooltip={name}
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

/** The project identity palette: the stroke of each colour a project or board icon can have. */
export const glyphColor = {
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

/**
 * One line of a list (a task, a notification): a lead (dot, checkbox, avatar), who or what, an
 * optional preview, where it is, and a trailing time or due date. The element around it (a link,
 * a button) makes it pressable; `.ink-row` styles the hover and the selected state.
 */
export function ListRow({
  lead,
  title,
  preview,
  where,
  trail,
}: {
  lead?: ReactNode;
  title: ReactNode;
  preview?: ReactNode;
  where?: ReactNode;
  trail?: ReactNode;
}) {
  return (
    <>
      {lead}
      <span className="ink-row__text">
        <span className="ink-row__title">{title}</span>
        {preview && <span className="ink-row__preview">{preview}</span>}
        {where && <span className="ink-row__where">{where}</span>}
      </span>
      {trail && <span className="ink-row__trail">{trail}</span>}
    </>
  );
}

/**
 * A card with a cover over a name, one meta line and a footer (a board, a project). The cover
 * holds the picture and its overlays; a link in `name` with `.ink-cover-card__link` covers the
 * whole card, controls in `overlay` stay above it.
 */
export function CoverCard({
  cover,
  overlay,
  name,
  meta,
  foot,
  className,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  cover: ReactNode;
  overlay?: ReactNode;
  name: ReactNode;
  meta?: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className={cx('ink-cover-card', className)} {...props}>
      <div className="ink-cover-card__cover">{cover}</div>
      {overlay}
      <div className="ink-cover-card__body">
        <div className="ink-cover-card__name">{name}</div>
        {meta && <div className="ink-cover-card__meta">{meta}</div>}
        {foot && <div className="ink-cover-card__foot">{foot}</div>}
      </div>
      {children}
    </article>
  );
}
