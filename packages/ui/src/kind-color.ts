// SPDX-License-Identifier: MPL-2.0
import type { CSSProperties } from 'react';

/** Content semantics only: project identity and workflow status use separate palettes. */
export const kindColor = {
  storyboard: 'purple',
  frame: 'purple',
  scene: 'purple',
  shotlist: 'green',
  production: 'green',
  moodboard: 'orange',
  image: 'orange',
  color: 'orange',
  palette: 'orange',
  link: 'orange',
  schedule: 'teal',
  review: 'pink',
  note: 'yellow',
  todo: 'yellow',
  pitch: null,
  board: null,
  blank: null,
  column: null,
  canvas: null,
  select: null,
  pointer: null,
  hand: null,
  arrow: null,
} as const;
export type ContentKind = keyof typeof kindColor;
export function kindStyle(kind: ContentKind): CSSProperties {
  const color = kindColor[kind];
  return {
    '--kind-fg': color ? `var(--ink-tag-${color})` : 'var(--ink-text-secondary)',
    '--kind-bg': color ? `var(--ink-tag-${color}-bg)` : 'var(--ink-surface-2)',
  } as CSSProperties;
}
