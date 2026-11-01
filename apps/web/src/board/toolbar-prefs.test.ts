import { describe, expect, it } from 'vitest';
import { BAR_TOOLS, barTools, DEFAULT_BAR, toggleBarTool } from './toolbar-prefs.ts';

describe('toolbar preferences', () => {
  it('shows the default bar until something is chosen', () => {
    expect(barTools(null)).toEqual(DEFAULT_BAR);
    expect(DEFAULT_BAR).not.toContain('storyboard');
  });

  it('keeps bar order and skips names it does not know', () => {
    expect(barTools(['frame', 'later-tool', 'note'])).toEqual(['note', 'frame']);
  });

  it('toggles one tool, keeping unknown names saved by a newer app', () => {
    const hidden = toggleBarTool(null, 'color');
    expect(hidden).toEqual(DEFAULT_BAR.filter((t) => t !== 'color'));
    expect(toggleBarTool(['later-tool', 'note'], 'storyboard')).toEqual([
      'note',
      'storyboard',
      'later-tool',
    ]);
    expect(barTools(toggleBarTool(hidden, 'color'))).toEqual(DEFAULT_BAR);
    expect(BAR_TOOLS).toHaveLength(9);
  });
});
