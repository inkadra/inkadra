// SPDX-License-Identifier: AGPL-3.0-only

const KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

type TabKey = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'preventDefault'> & {
  target: EventTarget | null;
};

/**
 * The tabs keyboard pattern, for a tablist's onKeyDown or a window listener that sees the key
 * first: Left and Right move the focus to the next tab and wrap, Home and End to the first and
 * last. The keys only move the focus; Enter, Space or a click choose the tab, so walking the tabs
 * loads, opens or animates nothing. Returns whether the key was taken.
 */
export function moveTabFocus(e: TabKey): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || !KEYS.includes(e.key)) return false;
  const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
  const list = tab?.closest('[role="tablist"]');
  if (!tab || !list) return false;
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const at = tabs.indexOf(tab as HTMLElement);
  const step = e.key === 'ArrowRight' ? 1 : tabs.length - 1;
  e.preventDefault();
  (e.key === 'Home'
    ? tabs[0]
    : e.key === 'End'
      ? tabs.at(-1)
      : tabs[(at + step) % tabs.length]
  )?.focus();
  return true;
}
