// SPDX-License-Identifier: AGPL-3.0-only
import { tokenMs } from './ease-cards.ts';
import { ALL_VIEWS, type BoardView } from './views.ts';

/** What a tab switch adds to its navigation: the router runs it as a view transition. */
export type ViewSwitchMotion = { viewTransition?: true };

/** Which way a switch travels along the tabs; null when nothing is switching. */
export function switchDirection(from: BoardView | null, to: BoardView): 'forward' | 'back' | null {
  if (from === null || from === to) return null;
  return ALL_VIEWS.indexOf(to) > ALL_VIEWS.indexOf(from) ? 'forward' : 'back';
}

/** Where the active tab's pill starts its next slide, measured before the tabs change. */
let pill: { to: BoardView; left: number; width: number } | null = null;

/**
 * Call from a tab, just before it navigates; everything else that changes the view (first load,
 * links, the sidebar) stays instant. The view's animation reads the direction from the root
 * (film.css), since the router starts the transition.
 */
export function beginViewSwitch(from: BoardView | null, to: BoardView): ViewSwitchMotion {
  const direction = switchDirection(from, to);
  if (!direction || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return {};
  document.documentElement.dataset.viewDirection = direction;
  const list = document.querySelector<HTMLElement>('.ink-header .view-tabs');
  const moving = list?.querySelector<HTMLElement>('.view-tabs__pill');
  const start = moving?.getAnimations().length
    ? moving
    : list?.querySelector('[aria-selected="true"]');
  if (list && start) {
    const box = start.getBoundingClientRect();
    const left = box.left - list.getBoundingClientRect().left + list.scrollLeft;
    pill = { to, left, width: box.width };
  }
  return { viewTransition: true };
}

/** Slides the pill to the open tab, when a tab switch brought it there. */
export function slideTabPill(list: HTMLElement | null, view: BoardView): void {
  const from = pill;
  if (!list || from?.to !== view) return;
  pill = null;
  const shape = list.querySelector<HTMLElement>('.view-tabs__pill');
  const tab = list.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!shape || !tab) return;
  for (const running of shape.getAnimations()) running.cancel();
  list.classList.add('view-tabs--sliding');
  const style = getComputedStyle(list);
  shape.animate(
    [
      { transform: `translateX(${from.left}px)`, width: `${from.width}px` },
      { transform: `translateX(${tab.offsetLeft}px)`, width: `${tab.offsetWidth}px` },
    ],
    {
      duration: tokenMs(style.getPropertyValue('--ink-dur-base'), 180),
      easing: style.getPropertyValue('--ink-ease-out').trim() || 'ease-out',
    },
  ).onfinish = () => list.classList.remove('view-tabs--sliding');
}

// The router replays a transition on back and forward, with no way to set its direction first:
// without one the switch is instant (film.css).
// Tests that import the board page run without a window.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    delete document.documentElement.dataset.viewDirection;
    pill = null;
  });
}
