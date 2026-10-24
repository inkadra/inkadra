import { createElement, updateElement } from '@inkadra/canvas-core';
import { createBoardDoc, roots, SchemaTooNewError } from '@inkadra/doc-schema';
import type { BoardVersion } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { RequestError } from '../lib/api.ts';
import { groupVersions, versionError, versionStore } from './versions.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
describe('version previews', () => {
  it('isolates a full saved Yjs update from later live changes and preview mutations', () => {
    const live = createBoardDoc(boardId);
    const note = createElement(live, 'note', { x: 10, y: 20 }, {}, { userId: null });
    const fragment = roots(live).elements.get(note.id)?.get('body') as Y.XmlFragment;
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('Saved note')]);
    fragment.insert(0, [paragraph]);
    const state = Y.encodeStateAsUpdate(live);
    updateElement(live, note.id, { x: 90, guestHidden: true });
    const preview = versionStore(state, boardId);
    expect(preview.getSnapshot().byId.get(note.id)).toMatchObject({ x: 10 });
    expect((preview.map(note.id)!.get('body') as Y.XmlFragment).toString()).toContain('Saved note');
    updateElement(preview.doc, note.id, { x: 200 });
    expect(roots(live).elements.get(note.id)?.get('x')).toBe(90);
    expect(roots(live).elements.get(note.id)?.get('guestHidden')).toBe(true);
    preview.destroy();
    preview.doc.destroy();
    live.destroy();
  });
  it('rejects a document from a future schema', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 999);
    expect(() => versionStore(Y.encodeStateAsUpdate(doc), boardId)).toThrow(/newer/);
    doc.destroy();
  });
});

it('groups local calendar days without losing order or unknown version kinds', () => {
  const make = (id: string, createdAt: string, kind = 'auto') =>
    ({ id, createdAt, kind }) as BoardVersion;
  const first = make('a', new Date(2026, 9, 24, 13).toISOString(), 'future');
  const second = make('b', new Date(2026, 9, 24, 10).toISOString());
  const third = make('c', new Date(2026, 9, 23, 23).toISOString());
  expect(groupVersions([first, second, third]).map((g) => g.items)).toEqual([
    [first, second],
    [third],
  ]);
});

it('explains each failure for the action that caused it', () => {
  const status = (code: number) => new RequestError(code, 'x', 'x');
  expect(versionError(status(429), 'restore')).toBe('rateLimited');
  expect(versionError(status(409), 'save')).toBe('limit');
  expect(versionError(status(409), 'rename')).toBe('limit');
  expect(versionError(status(409), 'restore')).toBe('tooNew');
  expect(versionError(new SchemaTooNewError(9), 'preview')).toBe('tooNew');
  expect(versionError(status(500), 'restore')).toBe('unconfirmed');
  expect(versionError(status(500), 'read')).toBe('generic');
  expect(versionError(new TypeError('offline'), 'save')).toBe('generic');
});
