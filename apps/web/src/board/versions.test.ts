import { createElement, updateElement } from '@inkadra/canvas-core';
import { createBoardDoc, roots, SchemaTooNewError } from '@inkadra/doc-schema';
import type { BoardVersion } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { RequestError } from '../lib/api.ts';
import {
  daysAgo,
  expiryDays,
  groupVersions,
  mergeVersions,
  versionError,
  versionStore,
} from './versions.ts';

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

it('merges local changes into every loaded page in server order', () => {
  const make = (id: string, hour: number, name: string | null = null) =>
    ({ id, createdAt: new Date(2026, 9, 24, hour).toISOString(), name }) as BoardVersion;
  const loaded = [make('d', 12), make('c', 11), make('b', 10), make('a', 10)];
  const saved = make('e', 13, 'New');
  const renamed = make('a', 10, 'Kept');
  expect(mergeVersions(loaded, [renamed, saved], ['c'])).toEqual([
    saved,
    loaded[0],
    loaded[2],
    renamed,
  ]);
  expect(loaded.map((v) => v.id)).toEqual(['d', 'c', 'b', 'a']);
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

it('reads the reason of conflicts and unconfirmed changes, and stays careful without one', () => {
  const failed = (code: number, details?: unknown) => new RequestError(code, 'x', 'x', details);
  const limit = { reason: 'named_versions_limit' };
  const newer = { reason: 'newer_schema' };
  const unknown = { reason: 'outcome_unknown' };
  expect(versionError(failed(409, limit), 'rename')).toBe('limit');
  expect(versionError(failed(409, newer), 'preview')).toBe('tooNew');
  // A reason wins over the action that used to decide.
  expect(versionError(failed(409, newer), 'save')).toBe('tooNew');
  expect(versionError(failed(409, limit), 'restore')).toBe('limit');
  // Unknown reasons fall back to the legacy reading.
  expect(versionError(failed(409, { reason: 'later' }), 'save')).toBe('limit');
  expect(versionError(failed(409, { reason: 'later' }), 'restore')).toBe('tooNew');
  for (const action of ['save', 'restore'] as const) {
    expect(versionError(failed(500, unknown), action)).toBe('unconfirmed');
    // Legacy servers omit details and newer ones may send other reasons: still unconfirmed.
    expect(versionError(failed(500), action)).toBe('unconfirmed');
    expect(versionError(failed(500, { reason: 'later' }), action)).toBe('unconfirmed');
    expect(versionError(failed(503, 'not json'), action)).toBe('unconfirmed');
  }
  expect(versionError(failed(500, unknown), 'rename')).toBe('unconfirmed');
  expect(versionError(failed(500), 'delete')).toBe('generic');
});

it('counts calendar days for the Today and Yesterday headings', () => {
  const now = new Date(2026, 10, 12, 0, 30);
  expect(daysAgo(new Date(2026, 10, 12, 23, 59), now)).toBe(0);
  expect(daysAgo(new Date(2026, 10, 11, 23, 59), now)).toBe(1);
  expect(daysAgo(new Date(2026, 9, 15, 18, 2), now)).toBe(28);
});

it('warns about automatic cleanup only in the last week', () => {
  const now = Date.parse('2026-11-12T10:00:00.000Z');
  expect(expiryDays(null, now)).toBeNull();
  expect(expiryDays('2026-11-20T10:00:00.000Z', now)).toBeNull();
  expect(expiryDays('2026-11-19T10:00:00.000Z', now)).toBe(7);
  expect(expiryDays('2026-11-14T12:00:00.000Z', now)).toBe(2);
  expect(expiryDays('2026-11-12T20:00:00.000Z', now)).toBe(0);
  expect(expiryDays('2026-11-12T09:00:00.000Z', now)).toBe(0);
});
