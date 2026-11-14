// SPDX-License-Identifier: MPL-2.0
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

type TabKey = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'preventDefault'> & {
  target: EventTarget | null;
};

const usable = (tab: HTMLElement) =>
  !(tab as HTMLButtonElement).disabled && tab.getAttribute('aria-disabled') !== 'true';

/**
 * The tabs keyboard pattern, for a tablist's onKeyDown or a window listener that sees the key
 * first: Left and Right move the focus to the next tab and wrap, Home and End to the first and
 * last; disabled tabs are skipped. The keys only move the focus (#455); Enter, Space or a click
 * choose the tab, so walking the tabs loads, opens or animates nothing. Returns whether the key
 * was taken.
 */
export function moveTabFocus(e: TabKey): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || !KEYS.includes(e.key)) return false;
  const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
  const list = tab?.closest('[role="tablist"]');
  if (!tab || !list) return false;
  const all = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const tabs = all.filter((t) => t === tab || usable(t));
  const at = tabs.indexOf(tab as HTMLElement);
  const step = e.key === 'ArrowRight' ? 1 : tabs.length - 1;
  e.preventDefault();
  (e.key === 'Home'
    ? tabs.find(usable)
    : e.key === 'End'
      ? [...tabs].reverse().find(usable)
      : tabs[(at + step) % tabs.length]
  )?.focus();
  return true;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A duration token ("180ms", "0.18s") in milliseconds. */
function tokenMs(value: string, fallback: number): number {
  const v = value.trim();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n;
}

/**
 * Puts the indicator of a bar (`.ink-tabs__ind`, a line or a raised thumb) under its chosen
 * item, and slides and stretches it there from where it was when `key` changes: transform only,
 * `--ink-dur-base` with `--ink-ease-out`; under reduced motion it jumps. `selected` finds the
 * chosen item in the bar. Shared by the tabs and the segmented radio.
 */
export function useSlidingIndicator(
  bar: RefObject<HTMLElement | null>,
  selected: string,
  key: unknown,
) {
  const last = useRef<{ x: number; w: number } | null>(null);
  const place = (animate: boolean) => {
    const list = bar.current;
    const ind = list?.querySelector<HTMLElement>(':scope > .ink-tabs__ind');
    if (!list || !ind) return;
    const item = list.querySelector<HTMLElement>(selected);
    if (!item || item.offsetWidth === 0) {
      ind.style.opacity = '0';
      last.current = null;
      return;
    }
    const x = item.offsetLeft;
    const w = item.offsetWidth;
    ind.style.opacity = '';
    ind.style.width = `${w}px`;
    ind.style.transform = `translateX(${x}px)`;
    const from = last.current;
    last.current = { x, w };
    if (!animate || !from || (from.x === x && from.w === w) || reducedMotion()) return;
    if (typeof ind.animate !== 'function') return;
    for (const running of ind.getAnimations()) running.cancel();
    const style = getComputedStyle(list);
    ind.animate(
      [
        { transform: `translateX(${from.x}px) scaleX(${from.w / w})` },
        { transform: `translateX(${x}px) scaleX(1)` },
      ],
      {
        duration: tokenMs(style.getPropertyValue('--ink-dur-base'), 180),
        easing: style.getPropertyValue('--ink-ease-out').trim() || 'ease-out',
      },
    );
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the indicator moves when the choice does.
  useLayoutEffect(() => place(true), [key]);
  // A font that loads late, a resized bar or a label that changes width: the indicator follows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: observes the bar for its lifetime.
  useEffect(() => {
    const list = bar.current;
    if (!list || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(list);
    for (const child of list.children) observer.observe(child);
    return () => observer.disconnect();
  }, []);
}

export type TabItem<T extends string> = {
  id: T;
  label: ReactNode;
  /** Before the label; with `iconOnly` items the label is still the accessible name. */
  icon?: ReactNode;
  /** A number after the label (unread, items in a section). */
  count?: ReactNode;
  disabled?: boolean;
  /** The id of this tab's own panel, when each tab keeps one (both stay in the page). */
  controls?: string;
  /** Extra attributes for this tab's button (a tooltip, a double click, a tour anchor). */
  props?: ButtonHTMLAttributes<HTMLButtonElement> & {
    [data: `data-${string}`]: string | undefined;
  };
};

/**
 * One bar of tabs (#771). `line` for the sections of a dialog, panel or page: many, long or
 * named by the person, with counts; it scrolls sideways when narrow. `segmented` for two to five
 * short, fixed modes of the same content. The chosen tab's line or thumb slides to the new one.
 * The arrows only move the focus (`moveTabFocus`); Enter, Space or a click choose. Tabs are
 * named `${id}-${item.id}` and control `${id}-panel`: put the content in a `TabPanel` with the
 * same `id`.
 */
export function Tabs<T extends string>({
  id,
  items,
  value,
  onChange,
  label,
  labelledBy,
  variant = 'line',
  size,
  fill,
  className,
  listRef,
  onKeyDown,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'role' | 'id'> & {
  id: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The bar's accessible name; or `labelledBy` with the id of a visible heading. */
  label?: string;
  labelledBy?: string;
  variant?: 'line' | 'segmented';
  size?: 'sm';
  /** Segmented: the tabs share the full width. */
  fill?: boolean;
  listRef?: RefObject<HTMLDivElement | null>;
}) {
  const own = useRef<HTMLDivElement>(null);
  const list = listRef ?? own;
  useSlidingIndicator(list, '[role="tab"][aria-selected="true"]', value);
  // The chosen tab scrolls into view in a bar that overflows (in the middle when the bar
  // appears), and the cut edges fade.
  const shown = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the chosen tab.
  useLayoutEffect(() => {
    const el = list.current;
    const tab = el?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const first = !shown.current;
    shown.current = true;
    if (!el || !tab || el.scrollWidth <= el.clientWidth) return;
    if (first) {
      el.scrollLeft = Math.max(0, tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2);
      return;
    }
    const left = tab.offsetLeft - 24;
    const right = tab.offsetLeft + tab.offsetWidth + 24;
    const behavior = reducedMotion() ? 'auto' : 'smooth';
    if (left < el.scrollLeft) el.scrollTo?.({ left, behavior });
    else if (right > el.scrollLeft + el.clientWidth)
      el.scrollTo?.({ left: right - el.clientWidth, behavior });
  }, [value]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: observes the bar for its lifetime.
  useEffect(() => {
    const el = list.current;
    if (!el || variant !== 'line') return;
    const clip = () => {
      el.classList.toggle('is-clip-start', el.scrollLeft > 1);
      el.classList.toggle('is-clip-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    clip();
    el.addEventListener('scroll', clip, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(clip) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', clip);
      observer?.disconnect();
    };
  }, [variant]);
  return (
    <div
      {...rest}
      ref={list}
      role="tablist"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={cx(
        'ink-tabs',
        `ink-tabs--${variant}`,
        size && `ink-tabs--${size}`,
        fill && 'ink-tabs--fill',
        className,
      )}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!e.defaultPrevented) moveTabFocus(e);
      }}
    >
      <span className="ink-tabs__ind" aria-hidden="true" />
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            {...item.props}
            id={`${id}-${item.id}`}
            role="tab"
            className={cx('ink-tabs__tab', item.props?.className)}
            aria-selected={on}
            aria-controls={item.controls ?? `${id}-panel`}
            tabIndex={on ? 0 : -1}
            disabled={item.disabled}
            onClick={(e) => {
              item.props?.onClick?.(e);
              if (!e.defaultPrevented && !on) onChange(item.id);
            }}
          >
            {item.icon}
            <span className="ink-tabs__label">{item.label}</span>
            {item.count !== undefined && item.count !== null && item.count !== false && (
              <span className="ink-tabs__count">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Fades a tab panel in briefly when `value` (the chosen tab) changes; the panel stays mounted,
 * so its state survives the switch. For a panel that is not a `TabPanel`.
 */
export function useTabPanelFade(panel: RefObject<HTMLElement | null>, value: string) {
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fades when the tab changes.
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = panel.current;
    if (!el || typeof el.animate !== 'function') return;
    const style = getComputedStyle(el);
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: tokenMs(style.getPropertyValue('--ink-dur-fast'), 120),
      easing: style.getPropertyValue('--ink-ease-out').trim() || 'ease-out',
    });
  }, [value]);
}

/**
 * The content of the chosen tab of the `Tabs` with the same `id`. It stays mounted across a
 * switch (its state survives) and fades in briefly with the new tab's content.
 */
export function TabPanel({
  id,
  value,
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'role'> & { id: string; value: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useTabPanelFade(panel, value);
  return (
    <div
      {...rest}
      ref={panel}
      role="tabpanel"
      id={`${id}-panel`}
      aria-labelledby={`${id}-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}
