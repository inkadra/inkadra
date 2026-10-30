import { FRAME_STATUSES, type FrameStatus } from '@inkadra/doc-schema';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShotDisplayStatus } from './film-status.ts';

/**
 * Inputs that write on blur, like the fields inside cards. They remount when the value
 * changes elsewhere (`key`), so a remote edit shows up without fighting local typing.
 */
export function TextField({
  label,
  value,
  onCommit,
  readOnly,
  placeholder,
  multiline,
  type,
  hint,
  className,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  readOnly: boolean;
  placeholder?: string;
  multiline?: boolean;
  type?: 'text' | 'number';
  hint?: string;
  className?: string;
}) {
  const id = useId();
  const commit = (next: string) => {
    if (next !== value) onCommit(next);
  };
  return (
    <div className={`film-field ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          key={value}
          className="ink-input film-field__area"
          defaultValue={value}
          readOnly={readOnly}
          placeholder={placeholder}
          rows={3}
          onBlur={(e) => commit(e.target.value)}
        />
      ) : (
        <input
          id={id}
          key={value}
          className="ink-input"
          // Text with a decimal keypad: a number field would refuse "2,5" in some locales.
          type="text"
          inputMode={type === 'number' ? 'decimal' : undefined}
          defaultValue={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={blurOnEnter}
        />
      )}
      {hint && <span className="film-field__hint">{hint}</span>}
    </div>
  );
}

export function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter' || e.key === 'Escape') {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

const CUSTOM = '\u0000custom';

/** A preset code (translated) or free text, for shot size, angle and movement. */
export function PresetField({
  label,
  value,
  codes,
  prefix,
  onCommit,
  readOnly,
  compact,
}: {
  label: string;
  value: string | undefined;
  codes: readonly string[];
  /** i18n prefix of the codes, e.g. "film.shot". */
  prefix: string;
  onCommit: (value: string | undefined) => void;
  readOnly: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const isCode = !value || codes.includes(value);
  const [custom, setCustom] = useState(!isCode);
  const showText = custom || !isCode;
  const select = (
    <select
      id={id}
      className="ink-input film-field__select"
      value={showText ? CUSTOM : (value ?? '')}
      disabled={readOnly}
      aria-label={compact ? label : undefined}
      onChange={(e) => {
        const next = e.target.value;
        if (next === CUSTOM) {
          setCustom(true);
          return;
        }
        setCustom(false);
        onCommit(next || undefined);
      }}
    >
      <option value="">{t('film.frame.none')}</option>
      {codes.map((c) => (
        <option key={c} value={c}>
          {t(`${prefix}.${c}`)}
        </option>
      ))}
      <option value={CUSTOM}>{t('film.frame.custom')}</option>
    </select>
  );
  const text = showText && (
    <input
      key={value}
      className="ink-input"
      defaultValue={isCode ? '' : value}
      aria-label={label}
      readOnly={readOnly}
      // biome-ignore lint/a11y/noAutofocus: shown because the person picked "Other"
      autoFocus={custom && isCode}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (!next) setCustom(false);
        if ((next || undefined) !== value) onCommit(next || undefined);
      }}
      onKeyDown={blurOnEnter}
    />
  );
  if (compact) {
    return (
      <span className="film-preset">
        {select}
        {text}
      </span>
    );
  }
  return (
    <div className="film-field">
      <label htmlFor={id}>{label}</label>
      <span className="film-preset">
        {select}
        {text}
      </span>
    </div>
  );
}

/** Translated text of a preset field: the label of a code, or the text as typed. */
export function usePresetText() {
  const { t } = useTranslation();
  return (prefix: string, codes: readonly string[], value: string | undefined) =>
    value ? (codes.includes(value) ? t(`${prefix}.${value}`) : value) : '';
}

export function StatusSelect({
  value,
  onCommit,
  readOnly,
  label,
}: {
  value: FrameStatus | undefined;
  onCommit: (value: FrameStatus | undefined) => void;
  readOnly: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  const current = value ?? 'draft';
  return (
    <select
      className={`ink-input film-status film-status--${current}`}
      value={current}
      disabled={readOnly}
      aria-label={label}
      onChange={(e) => {
        const next = e.target.value as FrameStatus;
        onCommit(next === 'draft' ? undefined : next);
      }}
    >
      {FRAME_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t(`film.status.${s}`)}
        </option>
      ))}
    </select>
  );
}

export function StatusChip({ status }: { status: ShotDisplayStatus | undefined }) {
  const { t } = useTranslation();
  const s = status ?? 'draft';
  return <span className={`film-chip film-status--${s}`}>{t(`film.status.${s}`)}</span>;
}

/** Seconds typed by a person ("4", "2,5") to milliseconds; empty or invalid = none. */
export function parseSeconds(text: string): number | undefined {
  const n = Number(text.trim().replace(',', '.'));
  if (!text.trim() || !Number.isFinite(n) || n < 0) return undefined;
  return Math.min(3_600_000, Math.round(n * 1000));
}

export function secondsText(ms: number | undefined): string {
  return ms === undefined ? '' : String(Math.round(ms / 100) / 10);
}

/**
 * A list of short names typed as chips: Enter, comma or leaving the field adds the text,
 * Backspace on an empty field takes the last one back. Suggestions come from a datalist.
 */
export function TokenField({
  id,
  values,
  suggestions = [],
  placeholder,
  disabled,
  removeLabel,
  onChange,
}: {
  id?: string | undefined;
  values: readonly string[];
  suggestions?: readonly string[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /** Accessible name of a chip's remove button, e.g. "Remove Elena". */
  removeLabel: (value: string) => string;
  onChange: (values: string[]) => void;
}) {
  const listId = useId();
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const next = [...values];
    for (const part of raw.split(',')) {
      const value = part.trim().slice(0, 120);
      const key = value.toLocaleLowerCase();
      if (value && !next.some((v) => v.toLocaleLowerCase() === key)) next.push(value);
    }
    setText('');
    if (next.length !== values.length) onChange(next.slice(0, 100));
  };
  const known = new Set(values.map((v) => v.toLocaleLowerCase()));
  return (
    <div className="token-field" data-disabled={disabled || undefined}>
      {values.map((value) => (
        <span key={value} className="token-field__chip">
          {value}
          {!disabled && (
            <button
              type="button"
              className="token-field__remove"
              aria-label={removeLabel(value)}
              onClick={() => onChange(values.filter((v) => v !== value))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        className="token-field__input"
        list={suggestions.length ? listId : undefined}
        value={text}
        disabled={disabled}
        placeholder={values.length ? undefined : placeholder}
        onChange={(e) => {
          const next = e.target.value;
          // Picking a suggestion or typing a comma completes the chip.
          if (next.includes(',') || suggestions.includes(next)) add(next);
          else setText(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => add(text)}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions
            .filter((s) => !known.has(s.toLocaleLowerCase()))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  );
}

/**
 * A time that is worked out when nobody sets it: shows the computed time, muted, and turns
 * into a time input on click. Clearing the input returns to the computed time.
 */
export function AutoTime({
  id,
  value,
  computed,
  autoLabel,
  disabled,
  onChange,
}: {
  id: string;
  value: string | null;
  /** The time used when `value` is empty, already formatted; null when there is none. */
  computed: string | null;
  autoLabel: string;
  disabled?: boolean | undefined;
  onChange: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!value && !editing && computed) {
    return (
      <button
        id={id}
        type="button"
        className="ink-input auto-time"
        disabled={disabled}
        onClick={() => {
          setEditing(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
      >
        <span>{computed}</span>
        <span className="auto-time__tag">{autoLabel}</span>
      </button>
    );
  }
  return (
    <input
      ref={input}
      id={id}
      className="ink-input"
      type="time"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      onBlur={() => setEditing(false)}
    />
  );
}
