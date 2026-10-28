import { FRAME_STATUSES, type FrameStatus } from '@inkadra/doc-schema';
import { type KeyboardEvent, useId, useState } from 'react';
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
