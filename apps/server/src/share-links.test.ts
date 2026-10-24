import { addElement, createBoardDoc, type Element, roots } from '@inkadra/doc-schema';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { guestCan } from './access.ts';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import { checkSameOrigin } from './http/csrf.ts';
import { createGuestAuth } from './http/guest-context.ts';
import { DocViews, guestElement, linkElements, pictureAssetId, viewOf } from './share-links.ts';

const base = { w: 100, z: 'a0', createdBy: 'user-1', createdAt: 1 };
const id = (n: string) => n.padEnd(10, '_');

function doc(elements: Element[]) {
  const d = createBoardDoc('00000000-0000-4000-8000-000000000001');
  for (const el of elements) addElement(d, el);
  return d;
}

describe('guest view of a board document', () => {
  const linked = '00000000-0000-4000-8000-0000000000aa';
  const outside = '00000000-0000-4000-8000-0000000000bb';
  const d = doc([
    { ...base, id: id('col'), type: 'column', title: 'Shown', x: 0, y: 0, parent: null },
    {
      ...base,
      id: id('img'),
      type: 'image',
      assetId: 'a1',
      x: 0,
      y: 0,
      parent: id('col'),
      tags: ['internal'],
      locked: true,
    },
    {
      ...base,
      id: id('hidcol'),
      type: 'column',
      title: 'Hidden',
      x: 0,
      y: 0,
      parent: null,
      guestHidden: true,
    },
    { ...base, id: id('inner'), type: 'image', assetId: 'a2', x: 0, y: 0, parent: id('hidcol') },
    { ...base, id: id('orphan'), type: 'file', assetId: 'a3', x: 0, y: 0, parent: id('gone') },
    { ...base, id: id('loopa'), type: 'column', title: 'a', x: 0, y: 0, parent: id('loopb') },
    { ...base, id: id('loopb'), type: 'column', title: 'b', x: 0, y: 0, parent: id('loopa') },
    { ...base, id: id('unsorted'), type: 'note', x: 0, y: 0, parent: 'unsorted' },
    {
      ...base,
      id: id('frame'),
      type: 'frame',
      x: 0,
      y: 0,
      parent: null,
      assetId: 'a4',
      status: 'retake',
      notes: 'Director only',
      label: '1A',
    },
    { ...base, id: id('drawn'), type: 'frame', x: 0, y: 0, parent: null },
    { ...base, id: id('cardin'), type: 'board', boardId: linked, x: 0, y: 0, parent: null },
    { ...base, id: id('cardout'), type: 'board', boardId: outside, x: 0, y: 0, parent: null },
    {
      ...base,
      id: id('arrowok'),
      type: 'arrow',
      x: 0,
      y: 0,
      parent: null,
      from: { elementId: id('img'), x: 0, y: 0 },
      to: { x: 5, y: 5 },
    },
    {
      ...base,
      id: id('arrowhid'),
      type: 'arrow',
      x: 0,
      y: 0,
      parent: null,
      from: { elementId: id('img'), x: 0, y: 0 },
      to: { elementId: id('inner'), x: 0, y: 0 },
    },
    {
      ...base,
      id: id('arrowout'),
      type: 'arrow',
      x: 0,
      y: 0,
      parent: null,
      from: { elementId: id('cardout'), x: 0, y: 0 },
      to: { x: 1, y: 1 },
    },
  ]);
  // Bold text in the note, the way the Tiptap binding stores marks.
  const body = roots(d).elements.get(id('unsorted'))?.get('body') as Y.XmlFragment;
  const p = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  text.insert(0, 'Ciao ');
  text.insert(5, 'mondo', { bold: {} });
  p.insert(0, [text]);
  body.insert(0, [p]);

  const view = viewOf(d);
  const shown = linkElements(view, new Map([[linked, {}]]));
  const ids = shown.map((e) => e.id).sort();

  it('leaves out hidden cards, their children and broken or circular chains', () => {
    expect(ids).toEqual(
      [
        id('col'),
        id('img'),
        id('unsorted'),
        id('frame'),
        id('drawn'),
        id('cardin'),
        id('arrowok'),
      ].sort(),
    );
  });

  it('sends only the allowed fields, and notes with their rich text', () => {
    const img = shown.find((e) => e.id === id('img')) as Element;
    expect(guestElement(view, img)).toEqual({
      id: id('img'),
      type: 'image',
      assetId: 'a1',
      x: 0,
      y: 0,
      w: 100,
      z: 'a0',
      parent: id('col'),
      createdAt: 1,
      createdBy: null,
    });
    const frame = guestElement(view, shown.find((e) => e.id === id('frame')) as Element);
    expect(frame).not.toHaveProperty('status');
    expect(frame).not.toHaveProperty('notes');
    expect(frame.label).toBe('1A');
    const note = guestElement(view, shown.find((e) => e.id === id('unsorted')) as Element);
    expect(note.body).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ciao ' },
            { type: 'text', text: 'mondo', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    });
  });

  it('hides children whose container is malformed', () => {
    const malformed = doc([
      { ...base, id: id('parent'), type: 'column', title: 'Parent', x: 0, y: 0, parent: null },
      { ...base, id: id('child'), type: 'image', assetId: 'a1', x: 0, y: 0, parent: id('parent') },
    ]);
    roots(malformed).elements.get(id('parent'))!.set('guestHidden', 'invalid');
    expect(viewOf(malformed).visible).toEqual([]);
    malformed.destroy();
  });

  it('knows which cards are pictures', () => {
    const byId = (n: string) => shown.find((e) => e.id === id(n)) as Element;
    expect(pictureAssetId(byId('img'))).toBe('a1');
    expect(pictureAssetId(byId('frame'))).toBe('a4');
    expect(pictureAssetId(byId('drawn'))).toBeNull();
    expect(pictureAssetId(byId('unsorted'))).toBeNull();
  });

  it('caches a decoded document while it is not stored again', async () => {
    const state = Y.encodeStateAsUpdate(d);
    let stamp = new Date(1000);
    let reads = 0;
    const fake = {
      select: () => ({
        from: () => ({
          where: async () => {
            reads++;
            return [{ updatedAt: stamp, state }];
          },
        }),
      }),
    } as unknown as Database;
    const docs = new DocViews();
    const first = await docs.get(fake, 'b');
    expect(await docs.get(fake, 'b')).toBe(first);
    expect(reads).toBe(3);
    stamp = new Date(2000);
    expect(await docs.get(fake, 'b')).not.toBe(first);
  });
});

describe('guest rules', () => {
  it('gives each guest role its rights, picks only with proofing', () => {
    const link = (role: 'guest_view' | 'guest_comment' | 'guest_approve', proofing = false) => ({
      role,
      proofing,
    });
    expect(guestCan(link('guest_view'), 'read_comments')).toBe(false);
    expect(guestCan(link('guest_comment'), 'write_comments')).toBe(true);
    expect(guestCan(link('guest_comment'), 'review')).toBe(false);
    expect(guestCan(link('guest_approve'), 'review')).toBe(true);
    expect(guestCan(link('guest_approve'), 'pick')).toBe(false);
    expect(guestCan(link('guest_view', true), 'pick')).toBe(true);
  });

  it('accepts writes only from the instance itself', () => {
    const req = (headers: Record<string, string>) => ({ headers }) as unknown as FastifyRequest;
    const url = 'https://ink.example.com/';
    expect(checkSameOrigin(req({ origin: 'https://ink.example.com' }), url)).toBe(true);
    expect(checkSameOrigin(req({ origin: 'https://evil.example.com' }), url)).toBe(false);
    expect(checkSameOrigin(req({ origin: 'null' }), url)).toBe(false);
    expect(checkSameOrigin(req({ 'sec-fetch-site': 'same-origin' }), url)).toBe(true);
    expect(checkSameOrigin(req({ 'sec-fetch-site': 'same-site' }), url)).toBe(false);
    expect(checkSameOrigin(req({}), url)).toBe(false);
  });

  it('names the guest cookie __Secure- over HTTPS, scoped to the path of its link', () => {
    const headers: Record<string, string> = {};
    const reply = {
      header: (k: string, v: string) => {
        headers[k] = v;
      },
    } as unknown as FastifyReply;
    const auth = createGuestAuth({
      config: { PUBLIC_URL: 'https://ink.example.com' } as Config,
      db: {} as Database,
      docs: new DocViews(),
    });
    auth.setCookie(reply, 'link-1', 'tok', new Date(Date.now() + 3600_000));
    expect(headers['set-cookie']).toMatch(
      /^__Secure-inkadra\.guest=tok; Path=\/api\/v1\/guest\/links\/link-1; HttpOnly; SameSite=Lax; Max-Age=(3599|3600); Secure$/,
    );
  });
});
