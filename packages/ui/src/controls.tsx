// SPDX-License-Identifier: MPL-2.0
import {
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
} from 'react';
import { Icon } from './icons.tsx';

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  ref?: Ref<HTMLInputElement>;
};

/**
 * Choice controls draw over a transparent native input: labels, forms, Space and arrow keys keep
 * working as the browser makes them, and only the look comes from the design system.
 */
export function Checkbox({
  indeterminate,
  ref,
  className = '',
  ...props
}: ChoiceProps & { indeterminate?: boolean }) {
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (input.current && indeterminate !== undefined) input.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <span className={`ink-choice ink-checkbox ${className}`.trim()}>
      <input
        {...props}
        type="checkbox"
        ref={(node) => {
          input.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
      />
      <span className="ink-choice__box" aria-hidden="true">
        <Icon name="check" size={12} />
        <span className="ink-checkbox__dash" />
      </span>
    </span>
  );
}

/** An on/off setting that applies at once; in forms that submit later use a Checkbox. */
export function Switch({ className = '', ...props }: ChoiceProps) {
  return (
    <span className={`ink-choice ink-switch ${className}`.trim()}>
      <input {...props} type="checkbox" role="switch" aria-checked={props.checked} />
      <span className="ink-switch__track" aria-hidden="true" />
    </span>
  );
}

export function Radio({ className = '', ...props }: ChoiceProps) {
  return (
    <span className={`ink-choice ink-radio ${className}`.trim()}>
      <input {...props} type="radio" />
      <span className="ink-choice__box" aria-hidden="true" />
    </span>
  );
}

/**
 * A radio drawn as a pill or a card, with no visible circle: the tile itself shows the choice.
 * Tiles sharing a `name` form one native group, so arrow keys move between them.
 */
export function ChoiceTile({
  variant = 'pill',
  className = '',
  children,
  ...props
}: ChoiceProps & { variant?: 'pill' | 'card'; children: ReactNode }) {
  return (
    <label className={`ink-tile ink-tile--${variant} ${className}`.trim()}>
      <input {...props} type="radio" className="ink-tile__input" />
      {children}
    </label>
  );
}

export type RadioOption<T extends string> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type RadioGroupProps<T extends string> = {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  name?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  hint?: string | undefined;
  className?: string;
};

function Choices<T extends string>({
  label,
  value,
  onChange,
  options,
  name,
  disabled,
  hideLabel,
  hint,
  className = '',
  segmented,
}: RadioGroupProps<T> & { segmented: boolean }) {
  const id = useId();
  return (
    <fieldset
      className={`ink-radio-group ${segmented ? 'ink-segmented' : ''} ${className}`.trim()}
      aria-describedby={hint ? `${id}-hint` : undefined}
      disabled={disabled}
    >
      <legend className={hideLabel ? 'ink-sr-only' : 'ink-radio-group__legend'}>{label}</legend>
      <div className="ink-radio-group__options">
        {options.map((option) => (
          <label key={option.value} className="ink-radio-group__option">
            <Radio
              name={name ?? id}
              value={option.value}
              checked={value === option.value}
              disabled={disabled || option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="ink-radio-group__text">
              {option.label}
              {option.description && <small>{option.description}</small>}
            </span>
          </label>
        ))}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="ink-radio-group__hint">
          {hint}
        </p>
      )}
    </fieldset>
  );
}

/** A labelled list of exclusive choices: one tab stop, arrow keys move the choice. */
export function RadioGroup<T extends string>(props: RadioGroupProps<T>) {
  return <Choices {...props} segmented={false} />;
}

/** Two to four short exclusive choices drawn as segments; still a native radio group. */
export function Segmented<T extends string>({ hideLabel = true, ...props }: RadioGroupProps<T>) {
  return <Choices {...props} hideLabel={hideLabel} segmented />;
}
