// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A short number typed by hand ("2,20 m", "28 mm"), written on Enter or blur; the decimal comma
 * is accepted. Out-of-range or unreadable input goes back to the value.
 */
export function NumberField({
  value,
  min,
  max,
  step = 1,
  nudge = step,
  unit,
  digits = 0,
  lead,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** What an arrow key adds or takes away; the step of the field unless a finer one is typed. */
  nudge?: number;
  unit?: string;
  /** Decimals always shown: 1 writes "8.0 m", as the start dialog of the mockup. */
  digits?: number;
  /** Words before the number, "Up," in "Up, 0°". */
  lead?: string | undefined;
  label: string;
  onCommit: (value: number) => void;
}) {
  const { i18n } = useTranslation();
  const show = (v: number) =>
    // "5600 K", as the mockup: no thousands separator in a short field.
    v.toLocaleString(i18n.language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: Math.max(digits, step < 1 ? 2 : 0),
      useGrouping: false,
    });
  const [draft, setDraft] = useState(show(value));
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the value, not the locale.
  useEffect(() => setDraft(show(value)), [value]);
  const commit = () => {
    const text = draft.replace(',', '.').replace(/[^\d.-]/g, '');
    // No digit at all (cleared, or only letters) is not a number: Number('') would read 0.
    const v = /\d/.test(text) ? Number(text) : Number.NaN;
    if (Number.isFinite(v) && v >= min && v <= max && v !== value) onCommit(v);
    else setDraft(show(value));
  };
  return (
    // "60%", "45°": these units sit against the number.
    <span className={`plan-num${unit === '%' || unit === '°' ? ' plan-num--tight' : ''}`}>
      {lead && <span className="plan-num__lead">{lead}</span>}
      <input
        inputMode="decimal"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = e.key === 'ArrowUp' ? nudge : -nudge;
            const next = Math.min(max, Math.max(min, Math.round((value + delta) * 100) / 100));
            setDraft(show(next));
            if (next !== value) onCommit(next);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(show(value));
            e.currentTarget.blur();
          }
        }}
      />
      {unit && <span>{unit}</span>}
    </span>
  );
}
