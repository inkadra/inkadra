// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { defaultProjectIcon, ProjectIcon } from './projects.ts';

it('accepts every project shape and colour combination', () => {
  for (const shape of ProjectIcon.shape.shape.options)
    for (const color of ProjectIcon.shape.color.options) {
      expect(ProjectIcon.parse({ shape, color, emoji: null })).toEqual({
        shape,
        color,
        emoji: null,
      });
    }
});
it('rejects unknown API identities and preserves deterministic defaults', () => {
  expect(ProjectIcon.safeParse({ shape: 'unknown', color: 'pink' }).success).toBe(false);
  expect(ProjectIcon.safeParse({ shape: 'star', color: 'unknown' }).success).toBe(false);
  expect(defaultProjectIcon('00000000-0000-0000-0000-000000000000')).toEqual({
    shape: 'diamond',
    color: 'blue',
    emoji: null,
  });
});
