// SPDX-License-Identifier: MPL-2.0
import {
  type HTMLAttributes,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { cx } from './cx.ts';
import { swallowOutsidePress } from './layer.ts';

/** Why a menu closes; a press on one of its items is left to the item. */
export type MenuCloseReason = 'escape' | 'tab' | 'outside';

const ITEMS = '[role^="menuitem"]:not(:disabled)';
const ROW = '[role="group"], fieldset';
const usable = (item: HTMLElement) => item.getAttribute('aria-disabled') !== 'true';
const name = (item: HTMLElement) =>
  (item.getAttribute('aria-label') ?? item.textContent ?? '').trim().toLocaleLowerCase();

/**
 * The WAI-ARIA menu: a `role="menu"` surface (`.ink-menu`) around the caller's items, which are
 * buttons with a `menuitem`, `menuitemradio` or `menuitemcheckbox` role. On mount the first
 * usable item takes the focus (the first item when none is usable, else the menu itself), and
 * only the focused item is in the Tab order (roving tabindex). Up and Down walk the items and
 * wrap, Home and End go to the ends, a letter goes to the next item that starts with it (a key
 * no item starts with goes on to the caller); in a row of items (a `role="group"` or a
 * fieldset) Left and Right walk that row and wrap in it. Items with `disabled` are skipped;
 * `aria-disabled` ones stay in the walk so their hint can be read. Escape closes and gives the
 * focus back to `anchor`, Tab and Shift+Tab close and move on from `anchor` in one press, a
 * press outside the menu and `anchor` closes and is swallowed (`swallowOutsidePress`). The
 * keys it takes stop there. Where it sits is the caller's: a class, a style, or `ref`.
 */
export function Menu({
  label,
  anchor,
  onClose,
  ref,
  className,
  onKeyDown,
  onFocus,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'role'> & {
  label?: string | undefined;
  /** The button that opened the menu: pressing it is left to the button. */
  anchor?: RefObject<HTMLElement | null> | undefined;
  onClose: (reason: MenuCloseReason) => void;
  ref?: RefObject<HTMLDivElement | null> | undefined;
}) {
  const own = useRef<HTMLDivElement>(null);
  const menu = ref ?? own;
  const latest = useRef({ onClose, anchor });
  latest.current = { onClose, anchor };
  const search = useRef({ text: '', time: 0 });
  const active = useRef<HTMLElement | null>(null);
  // Roving tabindex, on every render so that items added later join it.
  useLayoutEffect(() => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const current = items.includes(active.current as HTMLElement) ? active.current : items[0];
    for (const item of items) item.tabIndex = item === current ? 0 : -1;
  });
  useEffect(() => {
    const el = menu.current;
    // Already placed in view: scrolling to the item would shift a clipped list beside it.
    (
      el?.querySelector<HTMLElement>(`${ITEMS}:not([aria-disabled="true"])`) ??
      el?.querySelector<HTMLElement>(ITEMS) ??
      el
    )?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || latest.current.anchor?.current?.contains(target))
        return;
      swallowOutsidePress(event);
      latest.current.onClose('outside');
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [menu]);
  const walk = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const row = items[at]?.closest(ROW);
    const { key } = event;
    if (key === 'Home') items[0]?.focus();
    else if (key === 'End') items.at(-1)?.focus();
    else if (key === 'ArrowDown' || key === 'ArrowUp') {
      items[(at + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (row && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      // Across a row, and only that row: its first item does not lead back to the list.
      const cells = items.filter((item) => row.contains(item));
      const i = cells.indexOf(items[at] as HTMLElement);
      cells[(i + (key === 'ArrowRight' ? 1 : -1) + cells.length) % cells.length]?.focus();
    } else if (
      key.length === 1 &&
      key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = Date.now();
      const char = key.toLocaleLowerCase();
      const order = [...items.slice(at + 1), ...items.slice(0, at + 1)];
      const find = (text: string) => {
        // The same letter again goes to the next item that starts with it.
        const prefix = [...text].every((c) => c === text[0]) ? (text[0] ?? text) : text;
        return order.find((item) => usable(item) && name(item).startsWith(prefix));
      };
      let text = (now - search.current.time > 700 ? '' : search.current.text) + char;
      let match = find(text);
      if (!match && text !== char) {
        text = char;
        match = find(text);
      }
      // Only a prefix that found an item is kept.
      search.current = { text: match ? text : '', time: now };
      // A key no item starts with is left to the caller (the schedule's 1–5 pick a type).
      if (!match) return false;
      match.focus();
    } else return false;
    return true;
  };
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={cx('ink-menu', className)}
      {...rest}
      onFocus={(event) => {
        onFocus?.(event);
        const item = (event.target as Element).closest<HTMLElement>(ITEMS);
        if (!item) return;
        active.current = item;
        for (const other of menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])
          other.tabIndex = other === item ? 0 : -1;
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          latest.current.anchor?.current?.focus();
          onClose('escape');
        } else if (event.key === 'Tab') {
          // From the button that opened it, Tab or Shift+Tab goes on to what is beside that button.
          latest.current.anchor?.current?.focus();
          onClose('tab');
        } else if (walk(event)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}
