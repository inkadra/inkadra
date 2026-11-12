// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it } from 'vitest';
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

describe('a project emoji on Hermes, without Intl.Segmenter', () => {
  const Segmenter = Intl.Segmenter;
  afterEach(() => {
    Intl.Segmenter = Segmenter;
  });
  const one = ['🎬', '❤️', '👍🏽', '👨‍👩‍👧', '🇮🇹', '1️⃣', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🏳️‍🌈'];
  const many = ['🎬🎥', '🇮🇹🇫🇷', 'ab', '👍x', '🎬 '];
  const ok = (emoji: string) => ProjectIcon.safeParse({ shape: 'star', color: 'pink', emoji }).success;

  it('reads one emoji as Intl.Segmenter does, where the old code threw', () => {
    const segmented = [...one, ...many].map(ok);
    Reflect.deleteProperty(Intl, 'Segmenter');
    expect(() => new Intl.Segmenter(undefined, { granularity: 'grapheme' })).toThrow(TypeError);
    expect(one.map(ok)).toEqual(one.map(() => true));
    expect(many.map(ok)).toEqual(many.map(() => false));
    expect([...one, ...many].map(ok)).toEqual(segmented);
  });
});
