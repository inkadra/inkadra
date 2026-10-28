// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { type GlyphShape, ProjectGlyph } from './components.tsx';

it.each(['hexagon', 'star', 'pentagon', 'cross'] as const)('draws paired %s frames', (shape) => {
  const glyph = ProjectGlyph({ shape, color: 'pink' });
  expect(glyph.props.viewBox).toBe('0 0 16 16');
  const selected = glyph.props.children.filter(Boolean);
  expect(selected).toHaveLength(1);
  expect(selected[0].props.children).toHaveLength(2);
  expect(selected[0].props.children[0].props.stroke).toBe('var(--ink-tag-pink)');
});
it('falls back to circle and neutral for unknown runtime values', () => {
  const glyph = ProjectGlyph({ shape: 'future' as GlyphShape, color: 'future' as 'neutral' });
  const selected = glyph.props.children.filter(Boolean);
  expect(selected[0].props.children[0].type).toBe('circle');
  expect(selected[0].props.children[0].props.stroke).toBe('var(--ink-text-muted)');
});
