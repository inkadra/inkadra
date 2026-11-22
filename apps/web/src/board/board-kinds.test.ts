import { offered } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { boardKindChoices } from './board-kinds.ts';

const offers = (off: string[]) => (part: 'kinds', name: string) => offered(off, part, name);

describe('boardKindChoices', () => {
  it('keeps a kind whose module is off, dimmed with its module to turn on (0121)', () => {
    const choices = boardKindChoices(offers(['storyboard']), false);
    expect(choices.map((c) => c.kind)).toEqual(['board', 'moodboard', 'storyboard', 'production']);
    expect(choices.find((c) => c.kind === 'storyboard')).toEqual({
      kind: 'storyboard',
      owner: 'storyboard',
      off: true,
      present: false,
    });
    // A plain board belongs to no module: always on.
    expect(choices[0]).toEqual({ kind: 'board', owner: null, off: false, present: false });
  });

  it('marks the one Production board as present, so it opens instead (0123)', () => {
    const present = boardKindChoices(offers([]), true).filter((c) => c.present);
    expect(present.map((c) => c.kind)).toEqual(['production']);
    expect(boardKindChoices(offers([]), false).some((c) => c.present)).toBe(false);
    // Off wins: the dimmed entry turns the module on rather than opening the board.
    const off = boardKindChoices(offers(['production']), true, ['production']);
    expect(off).toEqual([{ kind: 'production', owner: 'production', off: true, present: false }]);
  });
});
