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

it('maps X to the crop command', () => {
  expect(commandFor(key('x'), false)).toEqual({ kind: 'crop' });
  expect(commandFor(key('x', { ctrlKey: true }), false)).toBeNull();
});

it('maps G to the snap-to-grid toggle, without modifiers', () => {
  expect(commandFor(key('g'), false)).toEqual({ kind: 'snap' });
  expect(commandFor(key('G', { shiftKey: true }), false)).toBeNull();
  expect(commandFor(key('g', { ctrlKey: true }), false)).toBeNull();
  expect(commandFor(key('g', { altKey: true }), false)).toBeNull();
});

it('maps Shift+T to tidying into a mosaic and leaves T to the to-do', () => {
  expect(commandFor(key('T', { shiftKey: true }), false)).toEqual({ kind: 'tidy' });
  expect(commandFor(key('t'), false)).toEqual({ kind: 'add', type: 'todo' });
  expect(commandFor(key('T', { shiftKey: true, ctrlKey: true }), false)).toBeNull();
});
