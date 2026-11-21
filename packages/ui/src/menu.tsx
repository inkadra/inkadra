// SPDX-License-Identifier: MPL-2.0
import { type HTMLAttributes, type KeyboardEvent, type RefObject, useEffect, useRef } from 'react';
import { cx } from './cx.ts';
import { swallowOutsidePress } from './layer.ts';

/** Why a menu closes; a press on one of its items is left to the item. */
export type MenuCloseReason = 'escape' | 'tab' | 'outside';

const ITEMS = '[role^="menuitem"]:not(:disabled)';
const usable = (item: HTMLElement) => item.getAttribute('aria-disabled') !== 'true';
const name = (item: HTMLElement) =>
  (item.getAttribute('aria-label') ?? item.textContent ?? '').trim().toLocaleLowerCase();

/**
 * The WAI-ARIA menu: a `role="menu"` surface (`.ink-menu`) around the caller's items, which are
 * buttons with a `menuitem`, `menuitemradio` or `menuitemcheckbox` role. On mount the first
 * usable item takes the focus. Up and Down walk the items and wrap, Home and End go to the
 * ends, a letter goes to the next item that starts with it (one no item starts with goes on
 * to the caller); in a row of items (a `role="group"`
 * or a fieldset) Left and Right walk too. Items with `disabled` are skipped; `aria-disabled`
 * ones stay in the walk so their hint can be read. Escape closes and gives the focus back to
 * `anchor`, Tab closes and moves on from `anchor`, a press outside the menu and `anchor` closes
 * and is swallowed (`swallowOutsidePress`). The keys it takes stop there, so they never reach
 * the board underneath. Where it sits is the caller's: a class, a style, or `ref` to measure.
 */
export function Menu({
  label,
  anchor,
  onClose,
  ref,
  className,
  onKeyDown,
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
  useEffect(() => {
    // Already placed in view: scrolling to the item would shift a clipped list beside it.
    menu.current
      ?.querySelector<HTMLElement>(`${ITEMS}:not([aria-disabled="true"])`)
      ?.focus({ preventScroll: true });
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
    const inRow = !!items[at]?.closest('[role="group"], fieldset');
    const { key } = event;
    if (key === 'Home') items[0]?.focus();
    else if (key === 'End') items.at(-1)?.focus();
    else if (
      key === 'ArrowDown' ||
      key === 'ArrowUp' ||
      (inRow && (key === 'ArrowLeft' || key === 'ArrowRight'))
    ) {
      const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (
      key.length === 1 &&
      key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = Date.now();
      const text =
        (now - search.current.time > 700 ? '' : search.current.text) + key.toLocaleLowerCase();
      search.current = { text, time: now };
      // The same letter again goes to the next item that starts with it.
      const prefix = [...text].every((c) => c === text[0]) ? (text[0] ?? text) : text;
      const order = [...items.slice(at + 1), ...items.slice(0, at + 1)];
      const match = order.find((item) => usable(item) && name(item).startsWith(prefix));
      // A key no item starts with is left to the caller (the schedule's 1–9 pick a type).
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
      className={cx('ink-menu', className)}
      {...rest}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          latest.current.anchor?.current?.focus();
          onClose('escape');
        } else if (event.key === 'Tab') {
          // From the button that opened it, the Tab goes on to what follows that button.
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
