// SPDX-License-Identifier: AGPL-3.0-only
import { BoardKind } from '@inkadra/shared';
import { Icon, kindColor, kindStyle, NavItem, toolColor, toolStyle } from '@inkadra/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ALL_VIEWS } from '../board/views.ts';

it('uses the same tag tokens for strokes and tiles', () => {
  expect(kindColor).toEqual({
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
  });
  expect(kindStyle('storyboard')).toEqual({
    '--kind-fg': 'var(--ink-tag-purple)',
    '--kind-bg': 'var(--ink-tag-purple-bg)',
  });
  expect(kindStyle('board')).toEqual({
    '--kind-fg': 'var(--ink-text-secondary)',
    '--kind-bg': 'var(--ink-surface-2)',
  });
  expect(kindStyle('moodboard')).toEqual({
    '--kind-fg': 'var(--ink-tag-orange)',
    '--kind-bg': 'var(--ink-tag-orange-bg)',
  });
});

it('keeps canvas tools off the canvas-type colours', () => {
  expect(toolStyle('note')).toEqual({
    '--kind-fg': 'var(--ink-tool-note)',
    '--kind-bg': 'var(--ink-tool-note-bg)',
  });
  expect(toolStyle('select')).toEqual({
    '--kind-fg': 'var(--ink-text-secondary)',
    '--kind-bg': 'var(--ink-surface-2)',
  });
  expect(toolStyle('color')).toEqual({
    '--kind-fg': 'var(--ink-tool-color)',
    '--kind-bg': 'var(--ink-tool-color-bg)',
  });
  expect(toolStyle('column')).toEqual(toolStyle('select'));
  for (const kind of Object.keys(toolColor)) expect(Object.hasOwn(kindColor, kind)).toBe(false);
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

it('merges caller styles with icon size and kind', () => {
  const html = renderToStaticMarkup(
    <Icon name="frame" size={20} contentKind="storyboard" style={{ opacity: 0.5 }} />,
  );
  expect(html).toContain('width:20px');
  expect(html).toContain('color:var(--kind-fg)');
  expect(html).toContain('opacity:0.5');
});
