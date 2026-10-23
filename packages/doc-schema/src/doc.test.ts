// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addElement,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  createBoardDoc,
  Element,
  getSchemaVersion,
  migrateBoardDoc,
  newElementId,
  parseBoardDocName,
  readElement,
  roots,
  SchemaTooNewError,
  UNSORTED,
  validateBoardDoc,
} from './index.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const base = () => ({
  id: newElementId(),
  x: 0,
  y: 0,
  w: 240,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: 0,
});

describe('board document', () => {
  it('names documents after boards', () => {
    expect(parseBoardDocName(boardDocName(boardId))).toBe(boardId);
    expect(parseBoardDocName('project:x')).toBeNull();
  });

  it('starts at the current version', () => {
    expect(getSchemaVersion(createBoardDoc(boardId))).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('initialises an empty document through migration', () => {
    const doc = new Y.Doc();
    expect(migrateBoardDoc(doc, boardId)).toEqual([CURRENT_SCHEMA_VERSION]);
    expect(roots(doc).meta.get('boardId')).toBe(boardId);
  });

  it('refuses documents from a newer build', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', CURRENT_SCHEMA_VERSION + 1);
    expect(() => migrateBoardDoc(doc, boardId)).toThrow(SchemaTooNewError);
  });

  it('stores elements and reads them back', () => {
    const doc = createBoardDoc(boardId);
    const todo = {
      ...base(),
      type: 'todo' as const,
      parent: UNSORTED,
      items: [{ id: newElementId(), text: 'Sopralluogo', done: false }],
    };
    addElement(doc, todo);
    const note = addElement(doc, { ...base(), type: 'note' });
    expect(note.get('body')).toBeInstanceOf(Y.XmlFragment);
    expect(readElement(roots(doc).elements.get(todo.id)!)).toEqual(todo);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('syncs between two replicas', () => {
    const a = createBoardDoc(boardId);
    const b = new Y.Doc();
    const el = { ...base(), type: 'color' as const, hex: '#3B7CF6' };
    addElement(a, el);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readElement(roots(b).elements.get(el.id)!)).toEqual(el);
  });

  it('reports invalid elements and unknown roots', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).elements.set('broken-id', new Y.Map([['type', 'note']]));
    doc.getArray('stray');
    expect(validateBoardDoc(doc)).toHaveLength(2);
  });

  it('accepts only web addresses on link cards', () => {
    const link = (url: string) => Element.safeParse({ ...base(), type: 'link', url }).success;
    expect(link('https://example.com/ref')).toBe(true);
    expect(link('http://example.com')).toBe(true);
    expect(link('javascript:alert(1)')).toBe(false);
    expect(link('data:text/html,<script>alert(1)</script>')).toBe(false);
  });
});
