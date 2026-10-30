// SPDX-License-Identifier: MPL-2.0
import {
  type ButtonHTMLAttributes,
  Children,
  isValidElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Icon } from './icons.tsx';

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
};
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
  className = '',
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
  const [open, setOpen] = useState(false);
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
    setActive(selected >= 0 && !items[selected]?.disabled ? selected : (enabled[0] ?? -1));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const el = popup.current;
    const button = trigger.current;
    if (!el || !button) return;
    el.showPopover();
    const position = () => {
      const rect = button.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 160), window.innerWidth - 16);
      const height = Math.min(el.scrollHeight, 288, window.innerHeight - 32);
      el.style.setProperty(
        '--ink-select-left',
        `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
      );
      el.style.setProperty(
        '--ink-select-top',
        `${Math.max(8, rect.bottom + 8 + height > window.innerHeight ? rect.top - height - 8 : rect.bottom + 8)}px`,
      );
      el.style.setProperty('--ink-select-width', `${width}px`);
    };
    position();
    el.focus();
    const outside = (event: PointerEvent) => {
      if (!el.contains(event.target as Node) && !button.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      el.hidePopover();
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
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
  return (
    <>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <button
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
        className={`ink-input ink-select ink-select--${variant} ${className}`}
        onClick={(event) => {
          props.onClick?.(event);
          if (!event.defaultPrevented) open ? close() : show();
        }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)
          ) {
            event.preventDefault();
            show();
          }
        }}
      >
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
        <div
          ref={popup}
          popover="manual"
          role="listbox"
          id={`${id}-list`}
          tabIndex={-1}
          aria-label={props['aria-label']}
          aria-labelledby={props['aria-labelledby'] ?? props.id ?? `${id}-trigger`}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          className="ink-select__list"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
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
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              const now = Date.now();
              search.current.text =
                (now - search.current.time > 700 ? '' : search.current.text) +
                event.key.toLocaleLowerCase();
              search.current.time = now;
              const text = search.current.text;
              const prefix = [...text].every((c) => c === text[0]) ? (text[0] ?? text) : text;
              const match = [
                ...enabled.filter((i) => i > active),
                ...enabled.filter((i) => i <= active),
              ].find((i) =>
                document
                  .getElementById(`${id}-${i}`)
                  ?.textContent?.trim()
                  .toLocaleLowerCase()
                  .startsWith(prefix),
              );
              if (match !== undefined) setActive(match);
            }
          }}
        >
          {items.length === 0 && <div className="ink-select__empty">{emptyText}</div>}
          {items.map((item, index) => (
            <div key={item.value}>
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
      )}
    </>
  );
}
