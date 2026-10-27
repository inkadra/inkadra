import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { trackSave } from './settings-save.ts';

/** Matches the mobile shell breakpoint in mobile-shell.css. */
const PHONE = '(width < 768px)';

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const query = window.matchMedia(PHONE);
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => (typeof window !== 'undefined' && window.matchMedia?.(PHONE).matches) || false,
    () => false,
  );
}

export function Card({
  title,
  body,
  action,
  danger,
  children,
  className,
}: {
  title?: string;
  body?: ReactNode;
  action?: ReactNode;
  danger?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      className={['settings-card', danger && 'settings-card--danger', className]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby={title ? id : undefined}
    >
      {title && (
        <header className="settings-card__head">
          <div className="settings-card__title">
            <h2 id={id}>{title}</h2>
            {action}
          </div>
          {body && <p>{body}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

/** One setting: label and help on the left, control on the right; stacked on phones. */
export function Row({
  label,
  help,
  leading,
  children,
  htmlFor,
}: {
  label: ReactNode;
  help?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="settings-row">
      {leading}
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

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'ok' | 'warn' | 'neutral' | 'accent';
  children: ReactNode;
}) {
  return <span className={`settings-badge settings-badge--${tone}`}>{children}</span>;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="settings-segmented">
      {options.map((o) => (
        <label key={o.value} className={o.value === value ? 'is-on' : undefined}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

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
