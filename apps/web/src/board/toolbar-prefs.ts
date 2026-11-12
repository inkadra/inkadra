import type { IconName, ToolKind } from '@inkadra/ui';

/**
 * The board's bottom bar (#302, decision 0121). Select, Hand and Arrow, then Note, Image, Link
 * and To-do are always there; the other tools wait in More (⋯) and a person can put each in the
 * bar. What they put there is saved with their preferences.
 */
export const CORE_TOOLS = ['note', 'image', 'link', 'todo'] as const;

/** The tools of More, in its order; those of a module that is off are left out. */
export const MORE_TOOLS = [
  'column',
  'section',
  'color',
  'table',
  'voice',
  'map',
  'character',
  'location',
  'frame',
  'plan',
] as const;
export type MoreTool = (typeof MORE_TOOLS)[number];
export type BarTool = (typeof CORE_TOOLS)[number] | MoreTool;

/** Icons as in the bar (chrome.tsx). */
export const BAR_ICONS: Record<BarTool, IconName> = {
  note: 'stickyNote',
  image: 'image',
  link: 'link',
  todo: 'todo',
  color: 'color',
  column: 'splitPanel',
  frame: 'frame',
  section: 'heading',
  table: 'table',
  voice: 'mic',
  map: 'map',
  plan: 'planCamera',
  character: 'user',
  location: 'pin',
};

/** Colour of a tool's icon (tool-color.ts). */
export const barKind = (tool: BarTool): ToolKind => tool;

/** The name of a tool in the bar, More and the settings. */
export const barLabelKey = (tool: BarTool) =>
  tool === 'voice' ? 'board.voiceNote.label' : `board.types.${tool}`;

/** The tools of More a new person finds in the bar. */
export const DEFAULT_PINNED: readonly MoreTool[] = ['column', 'section'];

/**
 * The tools of More in the bar, in More's order, from the saved list (null: the default). A
 * list saved before decision 0121 named every tool shown: a tool shown then stays in the bar.
 */
export function pinnedTools(saved: readonly string[] | null): MoreTool[] {
  const list = saved ?? DEFAULT_PINNED;
  return MORE_TOOLS.filter((t) => list.includes(t));
}

/**
 * The list to save after putting a tool in the bar or taking it out. Other names (the tools
 * that are always there, saved before 0121, and those of a newer app) are kept.
 */
export function togglePinned(saved: readonly string[] | null, tool: MoreTool): string[] {
  const shown = new Set<string>(saved ?? DEFAULT_PINNED);
  if (shown.has(tool)) shown.delete(tool);
  else shown.add(tool);
  const others = [...shown].filter((t) => !(MORE_TOOLS as readonly string[]).includes(t));
  return [...MORE_TOOLS.filter((t) => shown.has(t)), ...others];
}
