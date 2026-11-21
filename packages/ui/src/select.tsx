// SPDX-License-Identifier: MPL-2.0
import {
  type ButtonHTMLAttributes,
  Children,
  isValidElement,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { cx } from './cx.ts';
import { Icon } from './icons.tsx';
import { anchorLayer } from './layer.ts';

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  description?: ReactNode;
  group?: string;
};
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'children'> & {
  value: string | number;
  onChange: (value: string) => void;
  options?: SelectOption[];
  children?: ReactNode;
  name?: string;
  placeholder?: string;
  emptyText?: string;
  variant?: 'default' | 'quiet';
  /** A label shown inside the control, before the value ("Status  All"); also its name. */
  prefix?: string;
};
/** A label's own words, without the controls it may wrap (the trigger, its list). */
function labelText(label: HTMLLabelElement | undefined) {
  if (!label) return '';
  const copy = label.cloneNode(true) as HTMLElement;
  for (const control of copy.querySelectorAll('button, input, select, textarea, [popover]'))
    control.remove();
  return copy.textContent?.trim() ?? '';
}

/** The text of a label given as React nodes, for type-to-select while the list is closed. */
function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

/** Single choice listbox. Native option children are accepted for incremental migrations. */
export function Select({
  value,
  onChange,
  options,
  children,
  name,
  placeholder,
  emptyText,
  variant = 'default',
  prefix,
  className,
  disabled,
  ...props
}: Props) {
  const items: SelectOption[] = options ?? [];
  if (!options) {
    const collect = (nodes: ReactNode, group?: string) =>
      Children.forEach(nodes, (node) => {
        if (
          !isValidElement<{
            value?: string | number;
            children?: ReactNode;
            disabled?: boolean;
            label?: string;
          }>(node)
        )
          return;
        if (node.type === 'option')
          items.push({
            value: String(node.props.value ?? ''),
            label: node.props.children,
            disabled: node.props.disabled,
            group,
          });
        else collect(node.props.children, node.props.label ?? group);
      });
    collect(children);
  }
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [active, setActive] = useState(-1);
  const search = useRef({ text: '', time: 0 });
  const selected = items.findIndex((item) => item.value === String(value));
  const enabled = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const close = (focus = false) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const show = () => {
    // Nothing to list and nothing to say about it: there is no list to open.
    if (items.length === 0 && !emptyText) return;
    // The phone sheet is titled with the field's visible label, or its accessible name.
    const button = trigger.current;
    setTitle(
      labelText(button?.labels?.[0]) ||
        (props['aria-labelledby'] &&
          document.getElementById(props['aria-labelledby'])?.textContent?.trim()) ||
        (props['aria-label'] ?? prefix) ||
        '',
    );
    setActive(selected >= 0 && !items[selected]?.disabled ? selected : (enabled[0] ?? -1));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const el = popup.current;
    const button = trigger.current;
    if (!el || !button) return;
    // On a phone the layer is the scrim around the sheet: its own click closes the sheet.
    const cleanup = anchorLayer(el, button, () => setOpen(false), 8);
    list.current?.focus();
    return cleanup;
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);
  const choose = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    onChange(item.value);
    close(true);
  };
  /**
   * Type-to-select, as a native select does: the next enabled option after `from` whose label
   * starts with the letters typed in quick succession (one letter repeated cycles through them).
   */
  const typeahead = (key: string, from: number) => {
    const now = Date.now();
    search.current.text =
      (now - search.current.time > 700 ? '' : search.current.text) + key.toLocaleLowerCase();
    search.current.time = now;
    const text = search.current.text;
    const start = [...text].every((c) => c === text[0]) ? (text[0] ?? text) : text;
    return [...enabled.filter((i) => i > from), ...enabled.filter((i) => i <= from)].find((i) =>
      (document.getElementById(`${id}-${i}`)?.textContent ?? nodeText(items[i]?.label))
        .trim()
        .toLocaleLowerCase()
        .startsWith(start),
    );
  };
  const typed = (event: KeyboardEvent) =>
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  return (
    <>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <button
        aria-label={prefix}
        {...props}
        ref={trigger}
        id={props.id ?? `${id}-trigger`}
        type="button"
        role="combobox"
        data-value={value}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={disabled}
        className={cx('ink-input ink-select', `ink-select--${variant}`, className)}
        onClick={(event) => {
          props.onClick?.(event);
          if (!event.defaultPrevented) open ? close() : show();
        }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            show();
          } else if (typed(event)) {
            event.preventDefault();
            const match = typeahead(event.key, selected);
            const item = match === undefined ? undefined : items[match];
            if (item && item.value !== String(value)) onChange(item.value);
          }
        }}
      >
        {prefix && (
          <span className="ink-select__prefix" aria-hidden="true">
            {prefix}
          </span>
        )}
        <span
          className={
            selected < 0 || (items[selected]?.disabled && items[selected]?.value === '')
              ? 'ink-select__placeholder'
              : 'ink-select__value'
          }
        >
          {selected < 0 ? placeholder : items[selected]?.label}
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        // The layer lives in the top layer (a manual popover), above open dialogs too: positioned
        // under the trigger on desktop, a dimmed backdrop with a bottom sheet on phones.
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a tap on the backdrop is a pointer shortcut; the listbox handles Escape.
        <div
          ref={popup}
          popover="manual"
          className="ink-select__layer"
          onClick={(event) => {
            // Keeps a wrapping label from pressing the trigger again.
            event.preventDefault();
            event.stopPropagation();
            if (event.target === event.currentTarget) close(true);
          }}
        >
          <div className="ink-select__panel">
            <div className="ink-select__sheet-head" aria-hidden="true">
              <span className="ink-select__handle" />
              {title && <span className="ink-select__title">{title}</span>}
            </div>
            <div
              ref={list}
              role="listbox"
              id={`${id}-list`}
              tabIndex={-1}
              aria-labelledby={props['aria-labelledby'] ?? props.id ?? `${id}-trigger`}
              aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
              className="ink-select__list"
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  close(true);
                  return;
                }
                if (event.key === 'Tab') {
                  close(true);
                  return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  choose(active);
                  return;
                }
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  const current = enabled.indexOf(active);
                  setActive(
                    enabled[
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? enabled.length - 1
                          : (current + (event.key === 'ArrowUp' ? -1 : 1) + enabled.length) %
                            enabled.length
                    ] ?? -1,
                  );
                  return;
                }
                if (typed(event)) {
                  event.preventDefault();
                  const match = typeahead(event.key, active);
                  if (match !== undefined) setActive(match);
                }
              }}
            >
              {items.length === 0 && <div className="ink-select__empty">{emptyText}</div>}
              {items.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: two options may share a value; the list is rebuilt on each render.
                <div key={index}>
                  {item.group && item.group !== items[index - 1]?.group && (
                    <div className="ink-select__group">{item.group}</div>
                  )}
                  <div
                    tabIndex={-1}
                    onKeyDown={() => {
                      /* Keyboard handling belongs to the listbox. */
                    }}
                    role="option"
                    data-value={item.value}
                    id={`${id}-${index}`}
                    aria-selected={selected === index}
                    aria-disabled={item.disabled || undefined}
                    data-active={active === index || undefined}
                    className="ink-select__option"
                    onPointerMove={() => !item.disabled && setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(index)}
                  >
                    {item.icon}
                    <span className="ink-select__label">
                      {item.label}
                      {item.description && <small>{item.description}</small>}
                    </span>
                    {selected === index && <Icon name="check" size={16} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
