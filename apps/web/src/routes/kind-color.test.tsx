// SPDX-License-Identifier: AGPL-3.0-only
import { BoardKind } from '@inkadra/shared';
import { kindColor, kindStyle, NavItem } from '@inkadra/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ALL_VIEWS } from '../board/views.ts';

it('uses the same tag tokens for strokes and tiles', () => {
  expect(kindColor).toMatchObject({
    storyboard: 'purple',
    shotlist: 'green',
    moodboard: 'orange',
    schedule: 'teal',
    review: 'pink',
    note: 'yellow',
    board: null,
  });
  for (const kind of Object.keys(kindColor) as (keyof typeof kindColor)[]) {
    const color = kindColor[kind];
    expect(kindStyle(kind)).toEqual({
      '--kind-fg': color ? `var(--ink-tag-${color})` : 'var(--ink-text-secondary)',
      '--kind-bg': color ? `var(--ink-tag-${color}-bg)` : 'var(--ink-surface-2)',
    });
  }
});
it('colours only the sidebar icon and preserves the active row', () => {
  const html = renderToStaticMarkup(
    <NavItem icon="storyboard" contentKind="storyboard" label="Storyboard" active href="#" />,
  );
  expect(html).toContain('ink-icon--kind');
  expect(html).toContain('--ink-tag-purple');
  expect(html).toContain('ink-nav__name');
  expect(html).toContain('aria-current="page"');
});

it('covers every board kind and view', () => {
  for (const kind of [...BoardKind.options, ...ALL_VIEWS])
    expect(Object.hasOwn(kindColor, kind)).toBe(true);
});
