// SPDX-License-Identifier: MPL-2.0
import type { CSSProperties } from 'react';

/**
 * Canvas types only: board kinds, views, templates and sidebar modules. Canvas tools have
 * their own palette (tool-color.ts); project identity and workflow status use others again.
 */
export const kindColor = {
  storyboard: 'purple',
  shotlist: 'green',
  production: 'green',
  moodboard: 'orange',
  schedule: 'teal',
  review: 'pink',
  pitch: null,
  board: null,
  blank: null,
  canvas: null,
} as const;
export type ContentKind = keyof typeof kindColor;
export function kindStyle(kind: ContentKind): CSSProperties {
  const color = kindColor[kind];
  return {
    '--kind-fg': color ? `var(--ink-tag-${color})` : 'var(--ink-text-secondary)',
    '--kind-bg': color ? `var(--ink-tag-${color}-bg)` : 'var(--ink-surface-2)',
  } as CSSProperties;
}
