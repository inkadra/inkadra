import { Icon, type IconName } from '@inkadra/ui';
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { trackSave } from './settings-save.ts';

export { useIsPhone } from '../lib/phone.ts';

/**
 * One block of a settings page (decision 0124): an optional uppercase label with an action on
 * its right, an optional line under it, then one bordered card of rows split by hairlines.
 */
export function Card({
  title,
  body,
  action,
  danger,
  children,
  className,
  tour,
  anchor,
}: {
  title?: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  danger?: boolean;
  children: ReactNode;
  className?: string;
  /** `data-tour` anchor of a tutorial step (#502). */
  tour?: string;
  /** `data-setting` anchor the settings search opens (an id of `SETTINGS`). */
  anchor?: string;
}) {
  const id = useId();
  return (
    <section
      className={['settings-block', className].filter(Boolean).join(' ')}
      aria-labelledby={title ? id : undefined}
      data-tour={tour}
      data-setting={anchor}
    >
      {(title || action) && (
        <header className="settings-block__head">
          {title && <h3 id={id}>{title}</h3>}
          {action && <div className="settings-block__action">{action}</div>}
        </header>
      )}
      {body && <p className="settings-block__body">{body}</p>}
      <div className={danger ? 'settings-card settings-card--danger' : 'settings-card'}>
        {children}
      </div>
    </section>
  );
}

export type TileTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'purple' | 'teal';

/** The 32px square in front of a row: an icon, or a few letters (2FA, G). */
export function Tile({
  icon,
  tone = 'neutral',
  round,
  children,
  style,
}: {
  icon?: IconName;
  tone?: TileTone;
  round?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`settings-tile settings-tile--${tone}${round ? ' settings-tile--round' : ''}`}
      style={style}
      aria-hidden="true"
    >
      {icon ? <Icon name={icon} size={16} /> : children}
    </span>
  );
}

/** One setting: icon tile, label and one line of help, control on the right; stacked on phones. */
export function Row({
  label,
  help,
  leading,
  icon,
  tone,
  children,
  htmlFor,
  className,
  anchor,
}: {
  label: ReactNode;
  help?: ReactNode;
  leading?: ReactNode;
  /** Shortcut for a `Tile` as `leading`. */
  icon?: IconName;
  tone?: TileTone;
  children?: ReactNode;
  htmlFor?: string;
  className?: string;
  /** `data-setting` anchor the settings search opens (an id of `SETTINGS`). */
  anchor?: string;
}) {
  return (
    <div className={className ? `settings-row ${className}` : 'settings-row'} data-setting={anchor}>
      {leading ?? (icon && <Tile icon={icon} tone={tone} />)}
      <div className="settings-row__text">
        {htmlFor ? (
          <label className="settings-row__label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="settings-row__label">{label}</span>
        )}
        {help && <span className="settings-row__help">{help}</span>}
      </div>
      {children && <div className="settings-row__control">{children}</div>}
    </div>
  );
}

/**
 * The strip that opens every page with a state (decision 0124): a round icon in the state's
 * colour, a sentence, the main action and an optional meter.
 */
export function Summary({
  tone,
  icon,
  title,
  text,
  action,
  meter,
  tour,
  anchor,
  live,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'accent';
  icon: IconName;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  meter?: ReactNode;
  tour?: string;
  /** `data-setting` anchor the settings search opens (an id of `SETTINGS`). */
  anchor?: string;
  /** Read the title out when it changes. */
  live?: boolean;
}) {
  return (
    <section
      className={`settings-summary settings-summary--${tone}`}
      data-tour={tour}
      data-setting={anchor}
    >
      <span className="settings-summary__icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <div className="settings-summary__text">
        <h3 aria-live={live ? 'polite' : undefined}>{title}</h3>
        {text && <p>{text}</p>}
        {meter}
      </div>
      {action && <div className="settings-summary__action">{action}</div>}
    </section>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';
  children: ReactNode;
}) {
  return <span className={`settings-badge settings-badge--${tone}`}>{children}</span>;
}

export { Segmented } from '@inkadra/ui';

/**
 * A text setting that saves itself after a pause in typing or on blur.
 * Empty or unchanged values are never sent.
 */
export function AutosaveText({
  id,
  value,
  save,
  maxLength,
  label,
}: {
  id?: string;
  value: string;
  save: (value: string) => Promise<unknown>;
  maxLength?: number;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const saved = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    saved.current = value;
    setDraft(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (next: string) => {
    clearTimeout(timer.current);
    const clean = next.trim();
    if (!clean || clean === saved.current) return;
    saved.current = clean;
    void trackSave(save(clean)).catch(() => {
      saved.current = value;
    });
  };
  return (
    <input
      id={id}
      className="ink-input settings-input"
      aria-label={id ? undefined : label}
      value={draft}
      maxLength={maxLength}
      aria-invalid={draft.trim() ? undefined : true}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(next), 800);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value);
      }}
    />
  );
}
