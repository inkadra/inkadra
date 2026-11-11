// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as schema from './index.ts';

const { createBoardDoc, migrateBoardDoc, noteImageAssetIds, roots } = schema;

it('declares the non-backward-compatible note body features, up to document schema 19', () => {
  expect((schema as unknown as Record<string, unknown>).NOTE_BODY_FORMAT).toEqual({
    version: 19,
    marks: ['noteInk'],
    nodes: ['taskList', 'taskItem', 'mention', 'noteImage'],
    blockAttributes: ['textAlign'],
  });
});

describe('mentions and pictures in notes (schema 19)', () => {
  const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

  function noteWithBody(doc: Y.Doc) {
    const note = new Y.Map<unknown>();
    roots(doc).elements.set('noteAAAAAAAAA', note);
    const body = new Y.XmlFragment();
    note.set('body', body);
    return body;
  }

  it('upgrades a version 18 note without changing its body', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 18);
    const body = noteWithBody(doc);
    const list = new Y.XmlElement('taskList');
    const item = new Y.XmlElement('taskItem');
    item.setAttribute('checked', true as unknown as string);
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('Rough cut')]);
    item.insert(0, [p]);
    list.insert(0, [item]);
    body.insert(0, [list]);
    const before = body.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([19, 20, 21, 22, 23, 24]);
    expect(body.toJSON()).toBe(before);
  });

  it('keeps mentions and pictures through a Yjs round trip and lists the pictures', () => {
    const doc = createBoardDoc(boardId);
    const body = noteWithBody(doc);
    const p = new Y.XmlElement('paragraph');
    const mention = new Y.XmlElement('mention');
    mention.setAttribute('id', 'user-1');
    mention.setAttribute('label', 'Giulia');
    p.insert(0, [new Y.XmlText('Ask '), mention]);
    const picture = new Y.XmlElement('noteImage');
    picture.setAttribute('assetId', 'asset-1');
    body.insert(0, [p, picture]);

    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const read = (roots(copy).elements.get('noteAAAAAAAAA') as Y.Map<unknown>).get(
      'body',
    ) as Y.XmlFragment;
    expect(read.toJSON()).toBe(body.toJSON());
    expect(noteImageAssetIds(read)).toEqual(['asset-1']);
    expect(schema.NoteMention.safeParse({ id: 'user-1', label: 'Giulia' }).success).toBe(true);
    expect(schema.NoteImage.safeParse({ assetId: '' }).success).toBe(false);
  });
});
