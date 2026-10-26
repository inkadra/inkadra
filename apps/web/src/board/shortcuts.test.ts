import { describe, expect, it } from 'vitest';
import { commandFor, type KeyInput } from './shortcuts.ts';

const key = (name: string, partial: Partial<KeyInput> = {}): KeyInput => ({
  key: name,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...partial,
});

describe('canvas keyboard shortcuts', () => {
  it('maps F2 to the rename command without modifiers', () => {
    expect(commandFor(key('F2'), false)).toEqual({ kind: 'rename' });
    expect(commandFor(key('F2'), true)).toEqual({ kind: 'rename' });

    // Modifiers suppress rename
    expect(commandFor(key('F2', { shiftKey: true }))).toBeNull();
    expect(commandFor(key('F2', { metaKey: true }))).toBeNull();
    expect(commandFor(key('F2', { ctrlKey: true }))).toBeNull();
    expect(commandFor(key('F2', { altKey: true }))).toBeNull();
  });

  it('keeps Enter as the edit command to open elements', () => {
    expect(commandFor(key('Enter'))).toEqual({ kind: 'edit' });
  });
});
