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
  unit,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  label: string;
  onCommit: (value: number) => void;
}) {
  const { i18n } = useTranslation();
  const show = (v: number) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: step < 1 ? 2 : 0 });
  const [draft, setDraft] = useState(show(value));
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the value, not the locale.
  useEffect(() => setDraft(show(value)), [value]);
  const commit = () => {
    const v = Number(draft.replace(',', '.').replace(/[^\d.-]/g, ''));
    if (Number.isFinite(v) && v >= min && v <= max && v !== value) onCommit(v);
    else setDraft(show(value));
  };
  return (
    <span className="plan-num">
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
