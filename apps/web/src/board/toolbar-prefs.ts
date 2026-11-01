import type { IconName, ToolKind } from '@inkadra/ui';

/**
 * The tools a person keeps in the board's bottom bar (#302), saved with their preferences.
 * Select and Hand always stay; the others can be hidden and are then in the "+" menu.
 */
export const BAR_TOOLS = [
  'note',
  'image',
  'link',
  'todo',
  'color',
  'arrow',
  'column',
  'frame',
  'storyboard',
] as const;
export type BarTool = (typeof BAR_TOOLS)[number];

/** Icons as in the bar (chrome.tsx). */
export const BAR_ICONS: Record<BarTool, IconName> = {
  note: 'stickyNote',
  image: 'image',
  link: 'link',
  todo: 'todo',
  color: 'color',
  arrow: 'arrow',
  column: 'splitPanel',
  frame: 'frame',
  storyboard: 'storyboard',
};

/** Colour of a tool's icon; the storyboard is neutral like Frame. */
export const barKind = (tool: BarTool): ToolKind => (tool === 'storyboard' ? 'frame' : tool);

/** The bar as it was before it could be chosen. */
export const DEFAULT_BAR: readonly BarTool[] = BAR_TOOLS.filter((t) => t !== 'storyboard');

/** The tools shown, in bar order, from the saved list (null: the default bar). */
export function barTools(saved: readonly string[] | null): BarTool[] {
  const list = saved ?? DEFAULT_BAR;
  return BAR_TOOLS.filter((t) => list.includes(t));
}

/**
 * The list to save after showing or hiding one tool. Names this app does not know, saved by a
 * newer one, are kept.
 */
export function toggleBarTool(saved: readonly string[] | null, tool: BarTool): string[] {
  const shown = new Set<string>(saved ?? DEFAULT_BAR);
  if (shown.has(tool)) shown.delete(tool);
  else shown.add(tool);
  const unknown = [...shown].filter((t) => !(BAR_TOOLS as readonly string[]).includes(t));
  return [...BAR_TOOLS.filter((t) => shown.has(t)), ...unknown];
}
