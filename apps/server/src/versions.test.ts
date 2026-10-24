import { addElement, createBoardDoc, type Element, readElement, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { fragmentText } from './search/index-doc.ts';
import { writeVersionOver } from './versions.ts';

const BOARD = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

function note(id: string, fields: Partial<Element> = {}): Element {
  return {
    id,
    type: 'note',
    x: 0,
    y: 0,
    w: 240,
    z: 'a0',
    parent: null,
    createdBy: null,
    createdAt: 1,
    ...fields,
  } as Element;
}

function write(doc: Y.Doc, id: string, text: string) {
  const body = roots(doc).elements.get(id)?.get('body') as Y.XmlFragment;
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  doc.transact(() => {
    body.delete(0, body.length);
    body.insert(0, [p]);
  });
}

const element = (doc: Y.Doc, id: string) => {
  const map = roots(doc).elements.get(id);
  return map ? readElement(map) : null;
};
const text = (doc: Y.Doc, id: string) =>
  fragmentText(roots(doc).elements.get(id)?.get('body') as Y.XmlFragment);

/** A copy of the document as a version stores it. */
const saved = (doc: Y.Doc) => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
};

describe('writeVersionOver', () => {
  it('adds back, removes and reverts elements, rich text and fields', () => {
    const live = createBoardDoc(BOARD);
    addElement(live, note('kept0000', { x: 10, tags: ['scene'] }));
    addElement(live, note('removed0', { x: 20 }));
    write(live, 'kept0000', 'first draft');
    write(live, 'removed0', 'gone later');
    roots(live).meta.set('aspect', '2.39');
    const version = saved(live);

    live.transact(() => roots(live).elements.delete('removed0'));
    addElement(live, note('added000'));
    write(live, 'kept0000', 'second draft');
    live.transact(() => {
      const kept = roots(live).elements.get('kept0000');
      kept?.set('x', 99);
      kept?.set('locked', true);
      kept?.delete('tags');
      roots(live).meta.set('aspect', '16:9');
    });

    writeVersionOver(live, version);
    expect([...roots(live).elements.keys()].sort()).toEqual(['kept0000', 'removed0']);
    expect(element(live, 'kept0000')).toMatchObject({ x: 10, tags: ['scene'] });
    expect(element(live, 'kept0000')?.locked).toBeUndefined();
    expect(text(live, 'kept0000')).toBe('first draft');
    expect(text(live, 'removed0')).toBe('gone later');
    expect(roots(live).meta.get('aspect')).toBe('2.39');
  });

  it('keeps the current guestHidden of cards in both states, and the old one of others', () => {
    const live = createBoardDoc(BOARD);
    addElement(live, note('hidden00'));
    addElement(live, note('shown000', { guestHidden: true }));
    addElement(live, note('deleted0', { guestHidden: true }));
    addElement(live, note('visible0'));
    const version = saved(live);

    live.transact(() => {
      roots(live).elements.get('hidden00')?.set('guestHidden', true);
      roots(live).elements.get('shown000')?.delete('guestHidden');
      roots(live).elements.delete('deleted0');
      roots(live).elements.delete('visible0');
    });
    writeVersionOver(live, version);
    // Hidden since the version: stays hidden.
    expect(element(live, 'hidden00')?.guestHidden).toBe(true);
    // Shown since: stays as it is now.
    expect(element(live, 'shown000')?.guestHidden).toBeUndefined();
    // Brought back: as they were in the version.
    expect(element(live, 'deleted0')?.guestHidden).toBe(true);
    expect(element(live, 'visible0')?.guestHidden).toBeUndefined();
  });

  it('changes nothing when the board already matches the version', () => {
    const live = createBoardDoc(BOARD);
    addElement(live, note('same0000', { tags: ['a'] }));
    write(live, 'same0000', 'unchanged');
    const version = saved(live);
    let updates = 0;
    live.on('update', () => {
      updates += 1;
    });
    writeVersionOver(live, version);
    expect(updates).toBe(0);
  });

  it('is a normal change: an offline edit made before the restore still merges', () => {
    const live = createBoardDoc(BOARD);
    addElement(live, note('card0000', { x: 1 }));
    const version = saved(live);
    live.transact(() => roots(live).elements.get('card0000')?.set('x', 2));

    // Someone offline holds the board as it was and edits another field.
    const offline = saved(live);
    offline.transact(() => roots(offline).elements.get('card0000')?.set('y', 50));

    writeVersionOver(live, version);
    Y.applyUpdate(live, Y.encodeStateAsUpdate(offline));
    expect(element(live, 'card0000')).toMatchObject({ x: 1, y: 50 });
  });
});
