import { readElement, roots } from '@inkadra/doc-schema';
import type { GuestElement } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createGuestDoc, fillFromProseMirror, syncGuestDoc } from './guest-doc.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const base = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdAt: 1, createdBy: null };

const note = (id: string, text: string): GuestElement => ({
  ...base,
  id,
  type: 'note',
  body: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: text, marks: [{ type: 'bold' }] },
        ],
      },
    ],
  },
});

describe('guest doc', () => {
  it('writes ProseMirror JSON the way y-prosemirror stores it', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('t');
    fillFromProseMirror(fragment, {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Scene' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a ' },
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://x.y' } }],
            },
          ],
        },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    });
    const [heading, paragraph, list] = fragment.toArray() as Y.XmlElement[];
    expect(heading?.nodeName).toBe('heading');
    expect(heading?.getAttribute('level')).toBe(2);
    const text = paragraph?.toArray()[0] as Y.XmlText;
    expect(text.toDelta()).toEqual([
      { insert: 'a ' },
      { insert: 'link', attributes: { link: { href: 'https://x.y' } } },
    ]);
    expect(list?.nodeName).toBe('bulletList');
  });

  it('shows exactly the snapshot, keeping unchanged elements', () => {
    const doc = createGuestDoc(boardId);
    const image: GuestElement = { ...base, id: 'image-0001', type: 'image', assetId: boardId };
    syncGuestDoc(doc, [note('note-00001', 'one'), image], '16:9');
    const { elements, meta } = roots(doc);
    expect([...elements.keys()].sort()).toEqual(['image-0001', 'note-00001']);
    expect(meta.get('aspect')).toBe('16:9');
    const kept = elements.get('image-0001');
    const body = elements.get('note-00001')?.get('body') as Y.XmlFragment;
    expect(body.toString()).toContain('one');

    syncGuestDoc(doc, [note('note-00001', 'two')], null);
    expect([...elements.keys()]).toEqual(['note-00001']);
    const changed = elements.get('note-00001') as Y.Map<unknown>;
    expect((changed.get('body') as Y.XmlFragment).toString()).toContain('two');
    expect(meta.get('aspect')).toBeUndefined();

    syncGuestDoc(doc, [note('note-00001', 'two'), image], null);
    const again = elements.get('image-0001');
    syncGuestDoc(doc, [note('note-00001', 'two'), image], null);
    expect(elements.get('image-0001')).toBe(again);
    expect(again).not.toBe(kept);
  });

  it('leaves out elements this build cannot read', () => {
    const doc = createGuestDoc(boardId);
    syncGuestDoc(
      doc,
      [{ ...base, id: 'future-0001', type: 'hologram' }, note('note-00001', 'x')],
      null,
    );
    const { elements } = roots(doc);
    expect([...elements.keys()]).toEqual(['note-00001']);
    expect(readElement(elements.get('note-00001') as Y.Map<unknown>)?.type).toBe('note');
  });
});
