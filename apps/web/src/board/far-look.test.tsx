// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, FAR_BLOCK, FAR_ZOOM, farLook } from '@inkadra/canvas-core';
import { createBoardDoc, type Element, type ElementType } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Card } from './cards.tsx';
import { BoardContext, type BoardContextValue } from './context.ts';
import { BoardStore } from './store.ts';
import { videoEmbedUrl } from './youtube.ts';

// The web draws the far look with board.css (`canvas__world--far`), the mobile app with
// `farLook` from canvas-core. This test renders every kind of card in the far world and checks
// that what the stylesheet shows agrees with `farLook`, so the two cannot drift apart.

const assets = vi.hoisted(() => ({ ready: true }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('./assets.ts', async (original) => ({
  ...(await original<object>()),
  useAsset: (id: string | undefined) =>
    !id
      ? undefined
      : assets.ready
        ? {
            id,
            kind: 'image',
            mime: 'image/png',
            filename: 'still.png',
            size: 1024,
            status: 'ready',
            url: `/api/v1/assets/${id}/file`,
            width: 400,
            height: 300,
            variants: [{ url: `/api/v1/assets/${id}/v.webp`, width: 400, height: 300 }],
          }
        : 'missing',
  pickVariant: (asset: { variants: Array<{ url: string }> }) => asset.variants.at(-1)?.url ?? '',
  movingVariantUrl: () => null,
}));
vi.mock('./uploads.ts', () => ({
  useUploadProgress: () => null,
  useUploads: () => [],
  localPreview: () => null,
}));
vi.mock('./CardReview.tsx', () => ({ CardReview: () => null }));
vi.mock('./film/cast-appearances.ts', async (original) => ({
  ...(await original<object>()),
  useCharacterAppearance: () => ({ frames: 0, scenes: [] }),
}));

/** The far rules of board.css, by what they declare. */
const far = (() => {
  const css = readFileSync(
    // happy-dom's URL reads no file: the path from the module's own address.
    join(dirname(fileURLToPath(import.meta.url)), 'board.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, head = '', body = '']) => ({
      selector: head.replace(/\s+/g, ' ').trim(),
      body: body.replace(/\s+/g, ' ').trim(),
    }))
    .filter((r) => r.selector.startsWith('.canvas__world--far'));
  const by = (body: string) => rules.filter((r) => r.body === body).map((r) => r.selector);
  return {
    rules,
    hide: by('visibility: hidden;'),
    show: by('visibility: visible;'),
    fill: by(`background: var(--ink-${FAR_BLOCK});`),
  };
})();

const uuid = '00000000-0000-4000-8000-000000000001';
const youtube = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
type Fields = Record<string, unknown>;
interface Case {
  name: string;
  type: ElementType;
  fields?: Fields;
  ready?: boolean;
  children?: Array<{ type: ElementType; fields?: Fields }>;
}
const cases: Case[] = [
  { name: 'note', type: 'note' },
  { name: 'tinted note', type: 'note', fields: { color: 'blue' } },
  { name: 'to-do', type: 'todo', fields: { items: [] } },
  { name: 'table', type: 'table', fields: { columns: [{ id: 'column01' }], rows: [] } },
  { name: 'section', type: 'section', fields: { title: 'Act one', background: 'blue' } },
  { name: 'board card', type: 'board', fields: { boardId: uuid } },
  { name: 'colour', type: 'color', fields: { hex: '#336699', label: 'Sky' } },
  { name: 'image', type: 'image', fields: { assetId: 'img', caption: 'Still' } },
  { name: 'image, missing', type: 'image', fields: { assetId: 'img' }, ready: false },
  { name: 'empty frame', type: 'frame', fields: { action: 'Walks in' } },
  { name: 'frame with picture', type: 'frame', fields: { assetId: 'img' } },
  { name: 'plan', type: 'plan' },
  { name: 'character', type: 'character', fields: { name: 'Anna' } },
  { name: 'location', type: 'location', fields: { name: 'Port' } },
  { name: 'location with photo', type: 'location', fields: { name: 'Port', assetId: 'img' } },
  { name: 'map', type: 'map', fields: { name: 'Port' } },
  { name: 'map with picture', type: 'map', fields: { name: 'Port', imageAssetId: 'img' } },
  {
    name: 'map, missing',
    type: 'map',
    fields: { name: 'Port', imageAssetId: 'img' },
    ready: false,
  },
  { name: 'file', type: 'file', fields: { assetId: 'img' } },
  { name: 'file, missing', type: 'file', fields: { assetId: 'img' }, ready: false },
  { name: 'link', type: 'link', fields: { url: 'https://example.com/a' } },
  {
    name: 'link with image',
    type: 'link',
    fields: { url: 'https://example.com/a', imageAssetId: 'img' },
  },
  {
    name: 'link with image, no info',
    type: 'link',
    fields: { url: 'https://example.com/a', imageAssetId: 'img', showInfo: false },
  },
  { name: 'video link', type: 'link', fields: { url: youtube } },
  { name: 'video link, no preview', type: 'link', fields: { url: youtube, showPreview: false } },
  { name: 'empty column', type: 'column', fields: { title: 'Ideas' } },
  {
    name: 'column of texts',
    type: 'column',
    fields: { title: 'Ideas', color: 'green' },
    children: [
      { type: 'note', fields: { color: 'orange' } },
      { type: 'todo', fields: { items: [] } },
    ],
  },
  {
    name: 'column with a picture',
    type: 'column',
    fields: { title: 'Ideas' },
    children: [
      { type: 'note' },
      { type: 'image', fields: { assetId: 'img' } },
      { type: 'color', fields: { hex: '#000000' } },
    ],
  },
  {
    name: 'collapsed column with a picture',
    type: 'column',
    fields: { title: 'Ideas', collapsed: true },
    children: [{ type: 'image', fields: { assetId: 'img' } }],
  },
  {
    name: 'scene',
    type: 'scene',
    fields: { number: '4', title: 'Harbour' },
    children: [{ type: 'frame' }],
  },
];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

/** Renders `c` alone in the far world: the card's node and the elements as stored. */
async function renderFar(c: Case) {
  assets.ready = c.ready ?? true;
  const doc = createBoardDoc('boardAAAAAAAA');
  const opts = { userId: null };
  const el = createElement(doc, c.type, { x: 0, y: 0 }, (c.fields ?? {}) as never, opts);
  const children = (c.children ?? []).map((child) =>
    createElement(
      doc,
      child.type,
      { x: 0, y: 0 },
      { ...child.fields, parent: el.id } as never,
      opts,
    ),
  );
  const store = new BoardStore(doc);
  const snap = store.getSnapshot();
  const context = {
    store,
    readOnly: true,
    projectId: 'project',
    boardId: 'boardAAAAAAAA',
    userId: 'user',
    editing: null,
    setEditing: vi.fn(),
    scale: 1,
    frameLabels: new Map(),
  } as unknown as BoardContextValue;
  const world = document.createElement('div');
  world.className = 'canvas__world canvas__world--far';
  document.body.append(world);
  const root = createRoot(world);
  const element = snap.byId.get(el.id) as Element;
  await act(async () =>
    root.render(
      <BoardContext.Provider value={context}>
        <Card element={element} selected={false} childrenOf={snap.columns.get(el.id)} />
      </BoardContext.Provider>,
    ),
  );
  const done = async () => {
    await act(async () => root.unmount());
    world.remove();
    store.destroy();
    doc.destroy();
  };
  return {
    element,
    children: children.map((child) => snap.byId.get(child.id) as Element),
    node: world.querySelector<HTMLElement>(`[data-el="${el.id}"]`) as HTMLElement,
    done,
  };
}

const matches = (selectors: string[]) =>
  new Set(selectors.flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)]));

describe('the far look of board.css and farLook', () => {
  it('reads three far rules from board.css: hide, show the pictures, fill with the block', () => {
    expect(far.rules).toHaveLength(3);
    expect([far.hide.length, far.show.length, far.fill.length]).toEqual([1, 1, 1]);
  });

  for (const c of cases) {
    it(`agree on a ${c.name}`, async () => {
      const { element, children, node, done } = await renderFar(c);
      const look = farLook(element, {
        zoom: FAR_ZOOM / 2,
        children,
        playable: (url) => videoEmbedUrl(url) !== null,
        shown: () => assets.ready,
      });
      const shown = [...matches(far.show)].filter((p) => node.contains(p));
      const filled = matches(far.fill).has(node);
      // Everything of the card is hidden but what the show rule brings back.
      for (const part of node.children)
        expect(matches(far.hide).has(part as HTMLElement)).toBe(true);
      const css =
        filled && shown.length === 0
          ? { look: 'block', color: FAR_BLOCK }
          : shown.length === 0
            ? { look: 'tint', color: element.type === 'note' ? element.color : undefined }
            : element.type === 'column' || element.type === 'scene'
              ? { look: 'surface' }
              : shown.some((p) => p.classList.contains('card__swatch'))
                ? { look: 'swatch', color: element.type === 'color' && element.hex, surface: true }
                : { look: 'picture', surface: true };
      expect(filled && shown.length > 0).toBe(false);
      expect(look).toEqual(css);
      for (const child of children) {
        const childNode = node.querySelector<HTMLElement>(`[data-el="${child.id}"]`);
        if (!childNode) continue; // a collapsed container draws no children
        const childShown = shown.filter((p) => childNode.contains(p));
        const childLook = farLook(child, { zoom: FAR_ZOOM / 2, shown: () => assets.ready });
        expect(childLook.look === 'hidden', `${child.type} in ${c.name}`).toBe(
          childShown.length === 0,
        );
      }
      await done();
    });
  }
});
