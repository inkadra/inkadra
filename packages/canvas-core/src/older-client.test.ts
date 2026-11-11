// SPDX-License-Identifier: MPL-2.0
/**
 * P11 (decision 0101): this build plays an older client against a document written by a newer
 * schema. The newer schema is simulated by storing what this build does not know: fields at any
 * depth, an enumeration value, a note node. After paste, duplicate (card, column, scene),
 * delete (column, plan base), edits of nested plain values and opening a note, nothing it does
 * not know is lost, or the operation is refused (`foreignCardsIn`, `checkCard`).
 */
import {
  CURRENT_SCHEMA_VERSION,
  checkCard,
  createBoardDoc,
  type Element,
  roots,
} from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  copyElements,
  createElement,
  deleteElements,
  duplicateElements,
  foreignCardsIn,
  listElements,
  PasteRefusedError,
  pasteElements,
} from './board.ts';
import { addPlanIcon, addVariant, type PlanElement } from './plan.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const opts = { userId: null };
const PLACE = ['id', 'x', 'y', 'z', 'parent', 'createdBy', 'createdAt'];

const mapOf = (doc: Y.Doc, id: string) => roots(doc).elements.get(id) as Y.Map<unknown>;
/** A card as stored, without what a copy changes on purpose. */
function content(doc: Y.Doc, id: string): Record<string, unknown> {
  const json = mapOf(doc, id).toJSON();
  for (const key of PLACE) delete json[key];
  return json;
}
const through = (data: unknown) => JSON.parse(JSON.stringify(data));
/** A board this build holds at a newer schema than its own, as the older client does. */
function newerTarget(id = boardId, version = CURRENT_SCHEMA_VERSION + 1) {
  const doc = createBoardDoc(id);
  roots(doc).meta.set('schemaVersion', version);
  return doc;
}

/** A board of a newer schema: what that schema adds is written as stored. */
function newerBoard() {
  const doc = createBoardDoc(boardId);
  roots(doc).meta.set('schemaVersion', CURRENT_SCHEMA_VERSION + 1);
  const at = { x: 0, y: 0 };

  const note = createElement(doc, 'note', at, {}, opts).id;
  mapOf(doc, note).set('pinned', true);
  const p = new Y.XmlElement('paragraph');
  p.setAttribute('indent', '2' as never);
  const text = new Y.XmlText();
  p.insert(0, [text]);
  (mapOf(doc, note).get('body') as Y.XmlFragment).insert(0, [p, new Y.XmlElement('callout')]);
  text.insert(0, 'Primo piano', { glow: {} });

  const image = createElement(doc, 'image', at, { assetId: 'photo' }, opts).id;
  mapOf(doc, image).set('crop', { x: 0, y: 0, w: 0.5, h: 0.5, feather: 0.2 });
  mapOf(doc, image).set('filter', 'mono');

  const arrow = createElement(
    doc,
    'arrow',
    at,
    { from: { x: 0, y: 0, elementId: note }, to: { x: 100, y: 100 } },
    opts,
  ).id;
  mapOf(doc, arrow).set('from', { x: 0, y: 0, elementId: note, side: 'left' });

  const column = createElement(doc, 'column', { x: 600, y: 0 }, { title: 'Da girare' }, opts).id;
  const known = createElement(doc, 'note', at, { parent: column }, opts).id;
  const inColumn = createElement(doc, 'note', at, { parent: column }, opts).id;
  mapOf(doc, inColumn).set('pinned', true);
  // A newer status: this build cannot validate the frame, so no list shows it.
  const unreadable = createElement(doc, 'frame', at, { parent: column }, opts).id;
  mapOf(doc, unreadable).set('status', 'approved-final');

  const scene = createElement(doc, 'scene', { x: 900, y: 0 }, { number: '4', title: '' }, opts).id;
  const frame = createElement(doc, 'frame', at, { parent: scene }, opts).id;
  mapOf(doc, frame).set('lensMount', 'PL');

  const plan = createElement(doc, 'plan', { x: 0, y: 600 }, {}, opts).id;
  const icon = addPlanIcon(doc, plan, { kind: 'sofa', color: '#202020', x: 100, y: 100 })!;
  const icons = mapOf(doc, plan).get('icons') as Y.Array<Y.Map<unknown>>;
  icons.get(0).set('elevation', 2);
  icons.push([
    new Y.Map<unknown>(
      Object.entries({
        id: 'iconBBBBBBBB',
        kind: 'crane2',
        color: '#202020',
        x: 5,
        y: 5,
        layer: 'set',
      }),
    ),
  ]);
  const read = listElements(doc).find((e) => e.id === plan) as PlanElement;
  const variant = addVariant(doc, read, 'Sera', opts);

  return {
    doc,
    note,
    image,
    arrow,
    column,
    known,
    inColumn,
    unreadable,
    scene,
    frame,
    plan,
    icon,
    variant,
  };
}

describe('an older client on a newer document (P11)', () => {
  it('pastes cards with every field, item and note node it does not know, on their board', () => {
    const b = newerBoard();
    // The same board, as another client holds it.
    const target = newerTarget();
    const ids = [b.note, b.image, b.arrow];
    const pasted = pasteElements(
      target,
      through(copyElements(b.doc, ids)),
      { x: 0, y: 0 },
      opts,
    ).ids;
    for (const [i, id] of ids.entries()) {
      const copy = content(target, pasted[i]!);
      const original = content(b.doc, id);
      if (id === b.arrow) {
        // The end follows the copy of the note, pasted with it.
        expect(copy.from).toMatchObject({ side: 'left', elementId: pasted[0] });
        delete copy.from;
        delete copy.to;
        delete original.from;
        delete original.to;
      }
      expect(copy).toEqual(original);
    }
  });

  it('pastes them on another board of the same server, and refuses elsewhere', () => {
    const b = newerBoard();
    const elsewhere = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
    const data = through(copyElements(b.doc, [b.note], { instance: 'https://a.example' }));
    const sameServer = newerTarget(elsewhere);
    const at = { x: 0, y: 0 };
    const [copy] = pasteElements(sameServer, data, at, {
      ...opts,
      instance: 'https://a.example',
    }).ids;
    expect(content(sameServer, copy!)).toEqual(content(b.doc, b.note));
    const otherServer = newerTarget(elsewhere);
    expect(() =>
      pasteElements(otherServer, data, at, { ...opts, instance: 'https://b.example' }),
    ).toThrow(new PasteRefusedError('newer'));
    expect(roots(otherServer).elements.size).toBe(0);
  });

  it('refuses cards of a later schema than the board it pastes on, on the same server', () => {
    const b = newerBoard();
    // A newer client upgraded the source board live; this board is still one version behind.
    roots(b.doc).meta.set('schemaVersion', CURRENT_SCHEMA_VERSION + 2);
    const elsewhere = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
    const data = through(copyElements(b.doc, [b.note], { instance: 'https://a.example' }));
    const target = newerTarget(elsewhere);
    expect(() =>
      pasteElements(target, data, { x: 0, y: 0 }, { ...opts, instance: 'https://a.example' }),
    ).toThrow(new PasteRefusedError('newer'));
    expect(roots(target).elements.size).toBe(0);
  });

  it('duplicates a card with what it does not know', () => {
    const b = newerBoard();
    const [copy] = duplicateElements(b.doc, [b.note], { x: 20, y: 20 }, opts);
    expect(content(b.doc, copy!)).toEqual(content(b.doc, b.note));
  });

  it('duplicates a column and a scene with every card inside, those it cannot read too', () => {
    const b = newerBoard();
    for (const container of [b.column, b.scene]) {
      const [copy] = duplicateElements(b.doc, [container], { x: 20, y: 20 }, opts);
      const kids = (parent: string) =>
        [...roots(b.doc).elements.entries()]
          .filter(([, map]) => map.get('parent') === parent)
          .map(([id]) => content(b.doc, id));
      expect(kids(copy!)).toEqual(kids(container));
    }
  });

  it('copies a column with its cards, and refuses to paste a newer card it cannot read', () => {
    const b = newerBoard();
    const target = newerTarget();
    const data = through(copyElements(b.doc, [b.column]));
    expect(() => pasteElements(target, data, { x: 0, y: 0 }, opts)).toThrow(PasteRefusedError);
    expect(roots(target).elements.size).toBe(0);
    // Without it, the column and the other cards keep everything.
    mapOf(b.doc, b.unreadable).delete('status');
    const [column] = pasteElements(
      target,
      through(copyElements(b.doc, [b.column])),
      { x: 0, y: 0 },
      opts,
    ).ids;
    const kids = [...roots(target).elements.values()].filter((map) => map.get('parent') === column);
    expect(kids.map((map) => map.get('pinned'))).toEqual([undefined, true, undefined]);
  });

  it('names the cards a column, a scene or a plan base would take with it', () => {
    const b = newerBoard();
    expect(foreignCardsIn(b.doc, [b.column])).toEqual({
      foreign: [b.inColumn],
      unreadable: [b.unreadable],
    });
    expect(foreignCardsIn(b.doc, [b.scene])).toEqual({ foreign: [b.frame], unreadable: [] });
    expect(foreignCardsIn(b.doc, [b.plan])).toEqual({ foreign: [b.plan], unreadable: [] });
    expect(foreignCardsIn(b.doc, [b.known])).toEqual({ foreign: [], unreadable: [] });
  });

  it('deletes a plan base and keeps its Set in the variant, with what it does not know', () => {
    const b = newerBoard();
    deleteElements(b.doc, [b.plan]);
    const icons = (mapOf(b.doc, b.variant).get('icons') as Y.Array<Y.Map<unknown>>).toJSON();
    expect(icons).toMatchObject([
      { id: b.icon, elevation: 2 },
      { id: 'iconBBBBBBBB', kind: 'crane2' },
    ]);
  });

  it('deletes a plan base it cannot read and still keeps its Set in the variant', () => {
    const b = newerBoard();
    mapOf(b.doc, b.plan).set('sensor', 'imax');
    expect(listElements(b.doc).some((e) => e.id === b.plan)).toBe(false);
    deleteElements(b.doc, [b.plan]);
    const variant = listElements(b.doc).find((e) => e.id === b.variant) as Element;
    expect(variant).toMatchObject({ type: 'plan', icons: [{ id: b.icon, kind: 'sofa' }] });
    expect(mapOf(b.doc, b.variant).has('variantOf')).toBe(false);
  });

  it('marks cards with nested plain values or note nodes it does not know as not editable', () => {
    const b = newerBoard();
    expect(checkCard(mapOf(b.doc, b.arrow))).toMatchObject({
      status: 'foreign',
      issues: [{ kind: 'key', path: ['from', 'side'] }],
    });
    expect(checkCard(mapOf(b.doc, b.image))).toMatchObject({
      status: 'foreign',
      issues: [
        { kind: 'key', path: ['crop', 'feather'] },
        { kind: 'key', path: ['filter'] },
      ],
    });
    expect(checkCard(mapOf(b.doc, b.note))).toMatchObject({
      status: 'foreign',
      readable: true,
      issues: [
        { kind: 'attribute', path: ['body', 0], name: 'paragraph.indent' },
        { kind: 'mark', path: ['body', 0, 0], name: 'glow' },
        { kind: 'node', path: ['body', 1], name: 'callout' },
        { kind: 'key', path: ['pinned'] },
      ],
    });
    expect(checkCard(mapOf(b.doc, b.known))).toEqual({ status: 'known' });
  });
});
