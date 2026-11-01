import {
  addElement,
  createBoardDoc,
  type Element,
  hiddenFromGuests,
  readElement,
  roots,
} from '@inkadra/doc-schema';
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

  it.each(['note', 'board'] as const)(
    'keeps a %s hidden after restoring its parent from a hidden column to a visible one',
    (type) => {
      const live = createBoardDoc(BOARD);
      addElement(live, { ...note('visible0'), type: 'column', title: 'Visible' } as Element);
      addElement(live, {
        ...note('card0000', { parent: 'visible0' }),
        ...(type === 'board' ? { type, boardId: BOARD } : { type }),
      } as Element);
      const version = saved(live);
      addElement(live, {
        ...note('hidden00', { guestHidden: true }),
        type: 'column',
        title: 'Hidden',
      } as Element);
      roots(live).elements.get('card0000')?.set('parent', 'hidden00');
      const lookup = (id: string) => element(live, id) ?? undefined;
      expect(hiddenFromGuests('card0000', lookup)).toBe(true);

      writeVersionOver(live, version);
      expect(element(live, 'card0000')).toMatchObject({ parent: 'visible0', guestHidden: true });
      expect(hiddenFromGuests('card0000', lookup)).toBe(true);
    },
  );

  it.each(['body', 'items', 'strokes'] as const)(
    'replaces %s wholesale, discarding edits inside the old nested type from an offline client',
    (field) => {
      const live = createBoardDoc(BOARD);
      const item = { id: 'item0000', text: 'version', done: false };
      const stroke = {
        id: 'stroke00',
        tool: 'pencil' as const,
        color: '#000000',
        width: 1,
        points: [0, 0],
      };
      const card = addElement(
        live,
        field === 'items'
          ? { ...note('card0000'), type: 'todo', items: [item] }
          : field === 'strokes'
            ? { ...note('card0000'), type: 'frame', strokes: [stroke] }
            : note('card0000'),
      );
      if (field === 'body') write(live, 'card0000', 'version');
      const version = saved(live);
      if (field === 'body') write(live, 'card0000', 'current');
      else if (field === 'items')
        (card.get(field) as Y.Array<Y.Map<unknown>>).get(0).set('text', 'current');
      else (card.get(field) as Y.Array<unknown>).push([{ ...stroke, id: 'current0' }]);

      const offline = saved(live);
      if (field === 'body') write(offline, 'card0000', 'offline');
      else if (field === 'items')
        (roots(offline).elements.get('card0000')!.get(field) as Y.Array<Y.Map<unknown>>)
          .get(0)
          .set('done', true);
      else
        (roots(offline).elements.get('card0000')!.get(field) as Y.Array<unknown>).push([
          { ...stroke, id: 'offline0' },
        ]);
      writeVersionOver(live, version);
      Y.applyUpdate(live, Y.encodeStateAsUpdate(offline));
      if (field === 'body') expect(text(live, 'card0000')).toBe('version');
      else
        expect((card.get(field) as Y.Array<unknown>).toJSON()).toEqual([
          field === 'items' ? item : stroke,
        ]);
    },
  );

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
