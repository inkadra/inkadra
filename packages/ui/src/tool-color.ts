// SPDX-License-Identifier: MPL-2.0
import type { CSSProperties } from 'react';

/**
 * Canvas tools that create content get a colour of their own, far from the canvas-type
 * colours (kind-color.ts), the accent and danger; the rest stay neutral. The selected tool
 * takes the accent from the stylesheet.
 */
export const toolColor = {
  note: 'note',
  image: 'image',
  link: 'link',
  todo: 'todo',
  // Olive: in the light theme only 0.12 OKLab from the canvas green (decision 0033).
  color: 'color',
  column: null,
  frame: null,
  select: null,
  hand: null,
  arrow: null,
} as const;
export type ToolKind = keyof typeof toolColor;
export function toolStyle(tool: ToolKind): CSSProperties {
  const color = toolColor[tool];
  return {
    '--kind-fg': color ? `var(--ink-tool-${color})` : 'var(--ink-text-secondary)',
    '--kind-bg': color ? `var(--ink-tool-${color}-bg)` : 'var(--ink-surface-2)',
  } as CSSProperties;
}
