// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { MODULE_IDS, MODULES, moduleOf, offered, switchModule } from './modules.ts';
import { readUserPreferences } from './preferences.ts';

describe('the module registry (decision 0121)', () => {
  it('finds the module that owns a kind, a view, a tool or a tour', () => {
    expect(moduleOf('kinds', 'storyboard')).toBe('storyboard');
    expect(moduleOf('kinds', 'moodboard')).toBe('moodboard');
    expect(moduleOf('kinds', 'board')).toBeNull();
    expect(moduleOf('views', 'schedule')).toBe('production');
    expect(moduleOf('views', 'review')).toBe('review');
    expect(moduleOf('tools', 'plan')).toBe('plan');
    expect(moduleOf('tools', 'note')).toBeNull();
    expect(moduleOf('tours', 'setplanLinks')).toBe('plan');
    expect(moduleOf('notifications', 'review')).toBe('review');
    expect(moduleOf('exports', 'callSheet')).toBe('production');
  });

  it('gives each name to one module at most', () => {
    for (const part of Object.keys(MODULES.storyboard) as (keyof typeof MODULES.storyboard)[]) {
      const names = MODULE_IDS.flatMap((id) => MODULES[id][part] as readonly string[]);
      expect(new Set(names).size, part).toBe(names.length);
    }
  });

  it('offers what belongs to Board or to a module that is on', () => {
    expect(offered(['storyboard'], 'tools', 'frame')).toBe(false);
    expect(offered(['storyboard'], 'tools', 'note')).toBe(true);
    expect(offered(['plan'], 'tools', 'frame')).toBe(true);
    expect(offered([], 'kinds', 'moodboard')).toBe(true);
  });

  it('turns one module on or off, keeping names saved by a newer app', () => {
    expect(switchModule([], 'plan', false)).toEqual(['plan']);
    expect(switchModule(['later', 'plan'], 'plan', true)).toEqual(['later']);
    expect(switchModule(['later'], 'review', false)).toEqual(['later', 'review']);
    expect(switchModule(['review'], 'review', false)).toEqual(['review']);
  });

  it('starts with every module on and reads unknown names back', () => {
    expect(readUserPreferences(null).modulesOff).toEqual([]);
    expect(readUserPreferences(null).moduleNotices).toEqual([]);
    expect(readUserPreferences({ modulesOff: ['plan', 'later', 'plan'] }).modulesOff).toEqual([
      'plan',
      'later',
    ]);
    expect(readUserPreferences({ modulesOff: ['plan', 3] }).modulesOff).toEqual(['plan']);
  });
});
