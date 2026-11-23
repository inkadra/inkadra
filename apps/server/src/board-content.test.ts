import {
  addElement,
  createBoardDoc,
  Element,
  hiddenFromGuests,
  readElement,
  roots,
  UNSORTED,
} from '@inkadra/doc-schema';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { scheduleSource, trackGuestHiding } from './board-content.ts';
import { viewOf } from './share-links.ts';

// Counted, to tell a whole board read again from one element read again.
vi.mock('@inkadra/doc-schema', async (original) => {
  const schema = await original<typeof import('@inkadra/doc-schema')>();
  return {
    ...schema,
    hiddenFromGuests: vi.fn(schema.hiddenFromGuests),
    readElement: vi.fn(schema.readElement),
  };
});

const boardId = '0193f0a4-6c1e-7b9a-9c51-0000000000aa';

it('reads a stored document migrated, as the live one reads (#826)', () => {
  const doc = createBoardDoc(boardId);
  roots(doc).meta.set('schemaVersion', 25);
  const walker = {
    id: 'iconAAAAAAAAA',
    kind: 'actor',
    color: '#7AD689',
    x: 100,
    y: 100,
    steps: [{ x: 10, y: 10, note: 'Comes in' }],
    note: 'Sits down',
  };
  const plan = Element.parse({
    id: 'planAAAAAAAAA',
    x: 0,
    y: 0,
    w: 240,
    z: 'a0',
    parent: null,
    createdBy: null,
    createdAt: 0,
    type: 'plan',
    strokes: [],
    shapes: [],
    icons: [walker],
  });
  addElement(doc, plan);
  const { elements } = scheduleSource(boardId, Y.encodeStateAsUpdate(doc));
  const read = elements.find((el) => el.id === plan.id);
  if (read?.type !== 'plan') throw new Error('not a plan');
  // Version 26 moved this note: unmigrated, the call sheet would show it as the item's own.
  expect(read.icons?.[0]).toMatchObject({ stepNote: 'Sits down' });
  expect(read.icons?.[0]).not.toHaveProperty('note');
});

describe('trackGuestHiding', () => {
  const base = { w: 280, z: 'a0', createdBy: null, createdAt: 0, x: 0, y: 0 };
  const column = (id: string, guestHidden = false) =>
    ({ ...base, id, type: 'column', title: id, parent: null, guestHidden }) as const;
  const note = (id: string, parent: string | null) =>
    ({ ...base, id, type: 'note', parent }) as const;
  const setup = () => {
    const doc = createBoardDoc(boardId);
    for (const el of [
      column('shownAAAAAAAA'),
      column('hiddenAAAAAAA', true),
      column('hiddenBBBBBBB', true),
      note('cardAAAAAAAAA', 'shownAAAAAAAA'),
      note('cardBBBBBBBBB', 'hiddenAAAAAAA'),
    ])
      addElement(doc, Element.parse(el));
    const el = (id: string) => roots(doc).elements.get(id)!;
    return { doc, el, newlyHidden: trackGuestHiding(doc) };
  };

  it('tells when a card guests saw is hidden through its container', () => {
    const { el, newlyHidden } = setup();
    el('cardAAAAAAAAA').set('parent', 'hiddenAAAAAAA');
    expect(newlyHidden()).toBe(true);
    // Said once: the next call compares with what guests see now.
    expect(newlyHidden()).toBe(false);
  });

  it('tells when a container or a card is hidden by its own flag', () => {
    const { el, newlyHidden } = setup();
    el('shownAAAAAAAA').set('guestHidden', true);
    expect(newlyHidden()).toBe(true);
  });

  it('tells when a card is hidden through a container of its container', () => {
    const { doc, el, newlyHidden } = setup();
    addElement(doc, Element.parse(column('innerAAAAAAAA')));
    addElement(doc, Element.parse(note('deepAAAAAAAAA', 'innerAAAAAAAA')));
    expect(newlyHidden()).toBe(false);
    el('innerAAAAAAAA').set('parent', 'shownAAAAAAAA');
    expect(newlyHidden()).toBe(false);
    el('shownAAAAAAAA').set('guestHidden', true);
    expect(newlyHidden()).toBe(true);
    // Between two nested containers both hidden.
    el('deepAAAAAAAAA').set('parent', 'shownAAAAAAAA');
    expect(newlyHidden()).toBe(false);
  });

  it('tells when a card goes to the unsorted tray', () => {
    const { el, newlyHidden } = setup();
    el('cardAAAAAAAAA').set('parent', UNSORTED);
    expect(newlyHidden()).toBe(true);
  });

  it('tells when the container of a card guests saw is deleted and the card stays', () => {
    const { doc, newlyHidden } = setup();
    roots(doc).elements.delete('shownAAAAAAAA');
    expect(newlyHidden()).toBe(true);
  });

  it('reorders a card inside its container without reading the board again', () => {
    const { doc, el, newlyHidden } = setup();
    vi.mocked(hiddenFromGuests).mockClear();
    doc.transact(() => {
      el('cardAAAAAAAAA').set('parent', 'shownAAAAAAAA');
      el('cardAAAAAAAAA').set('z', 'a5');
    });
    expect(newlyHidden()).toBe(false);
    expect(hiddenFromGuests).not.toHaveBeenCalled();
  });

  it('reads nothing again when only the rich text of a card changes', () => {
    const { el, newlyHidden } = setup();
    let body = el('cardAAAAAAAAA').get('body');
    if (!(body instanceof Y.XmlFragment)) {
      body = new Y.XmlFragment();
      el('cardAAAAAAAAA').set('body', body);
    }
    newlyHidden();
    vi.mocked(readElement).mockClear();
    const paragraph = new Y.XmlElement('paragraph');
    (body as Y.XmlFragment).insert(0, [paragraph]);
    paragraph.insert(0, [new Y.XmlText('Hello')]);
    (paragraph.get(0) as Y.XmlText).insert(5, ' there');
    expect(newlyHidden()).toBe(false);
    expect(readElement).not.toHaveBeenCalled();
  });

  it('tells when a container turns invalid, as share pages leave it out with its cards', () => {
    const { doc, el, newlyHidden } = setup();
    el('shownAAAAAAAA').set('w', 0);
    expect(viewOf(doc).visible.map((v) => v.id)).not.toContain('cardAAAAAAAAA');
    expect(newlyHidden()).toBe(true);
  });

  it('ignores a card of an invalid container moved into a hidden one', () => {
    const { el, newlyHidden } = setup();
    el('shownAAAAAAAA').set('w', 0);
    newlyHidden();
    el('cardAAAAAAAAA').set('parent', 'hiddenAAAAAAA');
    expect(newlyHidden()).toBe(false);
  });

  it('ignores a card moved between two containers that were both hidden', () => {
    const { el, newlyHidden } = setup();
    el('cardBBBBBBBBB').set('parent', 'hiddenBBBBBBB');
    expect(newlyHidden()).toBe(false);
  });

  it('ignores edits that hide nothing guests saw', () => {
    const { doc, el, newlyHidden } = setup();
    el('cardAAAAAAAAA').set('x', 40);
    el('shownAAAAAAAA').set('title', 'Renamed');
    expect(newlyHidden()).toBe(false);
    // A card added hidden was never visible.
    addElement(doc, Element.parse(note('cardCCCCCCCCC', 'hiddenAAAAAAA')));
    expect(newlyHidden()).toBe(false);
    // Nor is a card shown again, or one deleted.
    el('hiddenBBBBBBB').set('guestHidden', false);
    roots(doc).elements.delete('cardAAAAAAAAA');
    expect(newlyHidden()).toBe(false);
  });
});
