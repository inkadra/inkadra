// @vitest-environment happy-dom
import {
  addFrame,
  addScene,
  listElements,
  storyboardOf,
  updateElement,
} from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { chooseSelect } from '../../test/select.ts';
import { BoardStore } from '../store.ts';
import { FramePanel } from './FramePanel.tsx';
import { StoryboardView } from './StoryboardView.tsx';

const started = vi.hoisted(() => [] as Array<{ file: File; onAsset: (id: string) => void }>);
const post = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api.ts', async (original) => {
  const real = await original<typeof import('../../lib/api.ts')>();
  return { ...real, api: { ...real.api, post } };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/session.tsx', () => ({ useSession: () => ({ instance: null }) }));
vi.mock('../uploads.ts', async (original) => ({
  ...(await original<typeof import('../uploads.ts')>()),
  startUpload: (upload: { file: File; onAsset: (id: string) => void }) => {
    started.push(upload);
    return `u${started.length}`;
  },
}));

const image = (name: string) => new File(['x'], name, { type: 'image/png' });

/** A drag event of files from the desktop, at a point of the page. */
function dragFiles(type: 'dragover' | 'drop', files: File[], x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    dataTransfer: { value: { types: ['Files'], files, dropEffect: 'none' } },
  });
  return event;
}

it('drops images between two frames as one new frame each, and not for a read-only viewer', async () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const scene = addScene(doc, { number: '1' }, { userId: null });
  addFrame(doc, scene.id, null, {}, { userId: null });
  addFrame(doc, scene.id, null, {}, { userId: null });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const frames = () => storyboardOf([...store.getSnapshot().byId.values()])[0]?.frames ?? [];
  const render = (readOnly: boolean) =>
    act(async () =>
      root.render(
        <MemoryRouter>
          <StoryboardView store={store} projectId="p" boardId="b" userId="u" readOnly={readOnly} />
        </MemoryRouter>,
      ),
    );
  try {
    await render(false);
    // The two tiles side by side, 16 px apart.
    const tiles = [...host.querySelectorAll<HTMLElement>('.story__tile')];
    tiles.forEach((tile, i) => {
      const left = i * 116;
      tile.getBoundingClientRect = () =>
        ({ left, right: left + 100, top: 0, bottom: 80 }) as DOMRect;
    });
    const grid = host.querySelector('.story__grid') as HTMLElement;
    const over = dragFiles('dragover', [image('a.png')], 108, 40);
    await act(async () => grid.dispatchEvent(over));
    // The marker of the reorder stands before the frame the images would go in front of.
    expect(over.defaultPrevented).toBe(true);
    expect(host.querySelectorAll('.story__tile.is-drop')).toHaveLength(1);
    expect(tiles[1]?.classList.contains('is-drop')).toBe(true);

    const notes = new File(['x'], 'notes.txt', { type: 'text/plain' });
    await act(async () =>
      grid.dispatchEvent(dragFiles('drop', [image('a.png'), notes, image('b.jpg')], 108, 40)),
    );
    expect(frames()).toHaveLength(4);
    expect(started.map((u) => u.file.name)).toEqual(['a.png', 'b.jpg']);
    expect(host.querySelectorAll('.story__tile.is-drop')).toHaveLength(0);
    // Not an image: said in a toast, no upload.
    expect(host.querySelector('.toast')?.textContent).toBe('film.drop.notImage');
    started[0]?.onAsset('asset-a');
    started[1]?.onAsset('asset-b');
    expect(frames().map((f) => f.assetId)).toEqual([undefined, 'asset-a', 'asset-b', undefined]);

    // A viewer cannot drop: nothing is added and no upload starts.
    started.length = 0;
    await render(true);
    const viewerGrid = host.querySelector('.story__grid') as HTMLElement;
    await act(async () => viewerGrid.dispatchEvent(dragFiles('drop', [image('c.png')], 108, 40)));
    expect(frames()).toHaveLength(4);
    expect(started).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  }
});

it('shares the scene filter between compact and desktop navigation without modifying read-only documents', async () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const a = addScene(doc, { number: '1', title: 'Opening' }, { userId: null });
  const b = addScene(doc, { number: '2', title: 'Ending' }, { userId: null });
  addFrame(doc, a.id, null, {}, { userId: null });
  addFrame(doc, b.id, null, {}, { userId: null });
  addFrame(doc, null, null, {}, { userId: null });
  const before = Y.encodeStateAsUpdate(doc);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <StoryboardView store={store} projectId="p" boardId="b" userId="u" readOnly />
        </MemoryRouter>,
      ),
    );
    const picker = host.querySelector<HTMLButtonElement>('.story__scene-picker .ink-select');
    expect(picker?.getAttribute('aria-haspopup')).toBe('listbox');
    expect(host.querySelector(`label[for="${picker?.id}"]`)).not.toBeNull();
    expect(host.querySelectorAll('.story__tile')).toHaveLength(3);
    await act(async () => {
      if (picker) {
        chooseSelect(picker, b.id);
      }
    });
    expect(host.querySelectorAll('.story__tile')).toHaveLength(1);
    expect(host.querySelector('.story__side-item[aria-pressed="true"]')?.textContent).toContain(
      'Ending',
    );
    const all = host.querySelector<HTMLButtonElement>('.story__side-item');
    await act(async () => all?.click());
    expect(picker?.value).toBe('');
    expect(host.querySelectorAll('.story__tile')).toHaveLength(3);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  }
});

it('keeps an omitted scene in place, hides it on request, restores or deletes it after a version', async () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const opts = { userId: null };
  const a = addScene(doc, { number: '14' }, opts);
  const b = addScene(doc, { number: '15', title: 'Parking lot' }, opts);
  addFrame(doc, a.id, null, {}, opts);
  addFrame(doc, b.id, null, {}, opts);
  addFrame(doc, b.id, null, {}, opts);
  updateElement(doc, b.id, { omitted: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
      (el) => el.getAttribute('aria-label') === label || el.textContent?.startsWith(label),
    );
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <StoryboardView store={store} projectId="p" boardId="b" userId="u" readOnly={false} />
        </MemoryRouter>,
      ),
    );
    const omitted = host.querySelector('.story__scene.is-omitted');
    expect(omitted?.getAttribute('aria-label')).toBe('film.scene.omittedHeading');
    expect(omitted?.querySelector('.story__omitted-badge')?.textContent).toBe('film.scene.omitted');
    expect(host.querySelector('.story__side-item.is-omitted')?.textContent).toContain(
      'Parking lot',
    );
    expect(host.querySelectorAll('.story__tile')).toHaveLength(3);

    // The bar hides omitted scenes and shows them again; the document does not change.
    const toggle = button('film.scene.omittedToggle (1)');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => toggle?.click());
    expect(host.querySelector('.story__scene.is-omitted')).toBeNull();
    expect(host.querySelectorAll('.story__tile')).toHaveLength(1);
    await act(async () => toggle?.click());
    expect(host.querySelectorAll('.story__tile')).toHaveLength(3);

    await act(async () => button('film.scene.menu')?.click());
    await act(async () => button('film.scene.restore')?.click());
    expect(listElements(doc).find((e) => e.id === b.id)).not.toHaveProperty('omitted');

    // Deleting needs the version first: without it nothing goes.
    await act(async () => updateElement(doc, b.id, { omitted: true }));
    post.mockRejectedValueOnce(new Error('offline'));
    await act(async () => button('film.scene.menu')?.click());
    await act(async () => {
      button('film.scene.deleteAll')?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('.toast')?.textContent).toBe('film.scene.deleteFailed');
    expect(listElements(doc)).toHaveLength(5);
    post.mockResolvedValueOnce({});
    await act(async () => button('film.scene.menu')?.click());
    await act(async () => {
      button('film.scene.deleteAll')?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(post).toHaveBeenLastCalledWith('/boards/b/versions', {
      name: 'film.scene.deleteVersion',
    });
    expect(listElements(doc)).toHaveLength(2);
    expect(storyboardOf(listElements(doc)).map((g) => g.scene?.number)).toEqual(['14']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  }
});

it('leaves the frames of omitted scenes out of the sidebar total, as the shot list does', async () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const opts = { userId: null };
  const a = addScene(doc, { number: '1' }, opts);
  const b = addScene(doc, { number: '2' }, opts);
  addFrame(doc, a.id, null, {}, opts);
  addFrame(doc, b.id, null, {}, opts);
  addFrame(doc, b.id, null, {}, opts);
  updateElement(doc, b.id, { omitted: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <StoryboardView store={store} projectId="p" boardId="b" userId="u" readOnly={false} />
        </MemoryRouter>,
      ),
    );
    const counts = [...host.querySelectorAll('.story__side-count')].map((el) => el.textContent);
    // All scenes, then each scene: the omitted one keeps its own count.
    expect(counts).toEqual(['1', '1', '2']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  }
});

it('subscribes the frame panel picture picker to the board store only while open', async () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const scene = addScene(doc, { number: '1' }, { userId: null });
  const frame = addFrame(doc, scene.id, null, {}, { userId: null });
  const spy = vi.spyOn(store, 'subscribe');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <FramePanel
            store={store}
            frame={frame}
            label="1A"
            boardAspect="16:9"
            projectId="p"
            boardId="b"
            readOnly={false}
            onClose={() => {}}
            onDraw={() => {}}
          />
        </MemoryRouter>,
      ),
    );
    // Only CastLinks subscribes while the "From board" picture picker is closed.
    expect(spy).toHaveBeenCalledTimes(1);
    const imageBtn = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'board.types.image',
    );
    await act(async () => imageBtn?.click());
    expect(spy).toHaveBeenCalledTimes(1);
    const fromBoardBtn = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'story.fromBoard',
    );
    await act(async () => fromBoardBtn?.click());
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  }
});
