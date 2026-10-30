// SPDX-License-Identifier: AGPL-3.0-only
import { Checkbox, type RadioGroupProps, Segmented as UiSegmented } from '@inkadra/ui';
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

/** The shared segmented radios with a visible label, taking [value, text] pairs. */
export function Segmented({
  options,
  hideLabel = false,
  ...props
}: Omit<RadioGroupProps<string>, 'options'> & { options: Array<[string, string]> }) {
  return (
    <UiSegmented
      {...props}
      hideLabel={hideLabel}
      className="export__field"
      options={options.map(([value, label]) => ({ value, label }))}
    />
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
      <Checkbox
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
