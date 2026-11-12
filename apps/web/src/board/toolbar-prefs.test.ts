import { describe, expect, it } from 'vitest';
import { DEFAULT_PINNED, MORE_TOOLS, pinnedTools, togglePinned } from './toolbar-prefs.ts';

describe('toolbar preferences (decision 0121)', () => {
  it('puts Column and Section title in the bar until something is chosen', () => {
    expect(pinnedTools(null)).toEqual(['column', 'section']);
    expect(DEFAULT_PINNED).toEqual(['column', 'section']);
  });

  it('keeps a bar saved before 0121: a tool shown then stays in the bar', () => {
    // The old list named every tool shown, the ones now always there included.
    const saved = ['note', 'image', 'link', 'todo', 'arrow', 'frame', 'storyboard', 'map'];
    expect(pinnedTools(saved)).toEqual(['map', 'frame']);
  });

  it('keeps More order and skips names it does not know', () => {
    expect(pinnedTools(['plan', 'later-tool', 'color'])).toEqual(['color', 'plan']);
  });

  it('puts one tool in the bar or takes it out, keeping the other names saved', () => {
    expect(togglePinned(null, 'table')).toEqual(['column', 'section', 'table']);
    expect(togglePinned(null, 'column')).toEqual(['section']);
    expect(togglePinned(['note', 'later-tool', 'map'], 'color')).toEqual([
      'color',
      'map',
      'note',
      'later-tool',
    ]);
    expect(pinnedTools(togglePinned(togglePinned(null, 'voice'), 'voice'))).toEqual(
      pinnedTools(null),
    );
    expect(MORE_TOOLS).toHaveLength(10);
  });
});
