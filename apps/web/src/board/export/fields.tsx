// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useId } from 'react';
import './export.css';

/**
 * Form controls of the export dialog, shared with other dialogs of the same family (the
 * screenplay import): a labelled field, segmented radios and a checkbox with a hint.
 */
export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="export__field">
      <label className="export__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export function Segmented({
  label,
  hideLabel,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  hideLabel?: boolean;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  hint?: string | undefined;
}) {
  const hintId = useId();
  const name = useId();
  // Native radios: one tab stop and arrow keys come with them; the labels look like segments.
  return (
    <fieldset
      className="export__field export__seg-field"
      aria-describedby={hint ? hintId : undefined}
    >
      <legend className={hideLabel ? 'ink-sr-only' : 'export__label'}>{label}</legend>
      <div className="export__seg">
        {options.map(([v, text]) => (
          <label key={v} className="export__seg-btn">
            <input
              type="radio"
              className="export__seg-input"
              name={name}
              value={v}
              checked={value === v}
              onChange={() => onChange(v)}
            />
            {text}
          </label>
        ))}
      </div>
      {hint && (
        <p id={hintId} className="export__hint">
          {hint}
        </p>
      )}
    </fieldset>
  );
}

export function Check({
  checked,
  disabled,
  onChange,
  hint,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="export__check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {children}
        {hint && <span className="export__hint">{hint}</span>}
      </span>
    </label>
  );
}
