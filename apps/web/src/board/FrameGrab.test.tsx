// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import type { Asset } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FrameGrab } from './FrameGrab.tsx';
import { BoardStore } from './store.ts';
import type { StartUpload } from './uploads.ts';

const state = vi.hoisted(() => ({ upload: null as StartUpload | null, cancel: vi.fn() }));
vi.mock('./uploads.ts', () => ({
  startUpload: (input: StartUpload) => {
    state.upload = input;
    return 'capture-upload';
  },
  cancelUpload: state.cancel,
}));
vi.mock('./frame-grab.ts', async (original) => ({
  ...(await original<typeof import('./frame-grab.ts')>()),
  captureVideoFrame: async () => ({
    file: new File(['png'], 'capture.png', { type: 'image/png' }),
    timeSeconds: 1.25,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'it' } }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = '11111111-1111-4111-8111-111111111111';
let cleanup = () => {};
afterEach(() => {
  cleanup();
  state.upload = null;
  state.cancel.mockClear();
});

async function setup() {
  const store = new BoardStore(createBoardDoc(id));
  const element = createElement(
    store.doc,
    'file',
    { x: 0, y: 0 },
    { assetId: id, guestHidden: true },
    { userId: 'u' },
  );
  const frame = createElement(store.doc, 'frame', { x: 0, y: 100 }, {}, { userId: 'u' });
  if (element.type !== 'file') throw new Error('fixture');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <FrameGrab
        store={store}
        element={element}
        asset={{ id, kind: 'video', filename: 'Last Train' } as Asset}
        video={{ current: document.createElement('video') }}
        projectId={id}
        userId="u"
        readOnly={false}
        initialFrameId={frame.id}
        onDone={vi.fn()}
      />,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
    store.destroy();
  };
  const click = async (selector: string) => {
    await act(async () => container.querySelector<HTMLButtonElement>(selector)?.click());
  };
  return { container, store, frame, click };
}

it('cancels on close, permits close while busy, and omits dangling aria-controls', async () => {
  const { container, click } = await setup();
  expect(container.querySelector('.viewer__grab')?.hasAttribute('aria-controls')).toBe(false);
  await click('.viewer__grab');
  expect(container.textContent).toContain('frameGrab.hiddenDestination');
  await click('.ink-btn--primary');
  expect(state.upload).not.toBeNull();
  const close = container.querySelector<HTMLButtonElement>('.viewer__grab-options .ink-btn--ghost');
  expect(close?.disabled).toBe(false);
  await click('.viewer__grab-options .ink-btn--ghost');
  expect(state.cancel).toHaveBeenCalledWith('capture-upload');
  expect(container.querySelector('.viewer__grab-options')).toBeNull();
  expect(container.querySelector<HTMLButtonElement>('.viewer__grab')?.disabled).toBe(false);
});

it('cancels on unmount and never commits a late upload', async () => {
  const { store, frame, click } = await setup();
  await click('.viewer__grab');
  await click('.ink-btn--primary');
  const upload = state.upload;
  cleanup();
  cleanup = () => {};
  expect(state.cancel).toHaveBeenCalledWith('capture-upload');
  await act(async () => upload?.onComplete?.('late-asset'));
  expect(store.getSnapshot().byId.get(frame.id)).not.toHaveProperty('assetId');
});

it('leaves busy state and cancels when the network goes offline', async () => {
  const { container, click } = await setup();
  await click('.viewer__grab');
  await click('.ink-btn--primary');
  await act(async () => window.dispatchEvent(new Event('offline')));
  expect(state.cancel).toHaveBeenCalledWith('capture-upload');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector<HTMLButtonElement>('.ink-btn--primary')?.disabled).toBe(false);
});

it('retries after failure without accepting a stale completion and hides a public destination', async () => {
  const { container, store, frame, click } = await setup();
  await click('.viewer__grab');
  await click('.ink-btn--primary');
  const first = state.upload;
  await act(async () => first?.onFailed?.(null));
  expect(container.querySelector<HTMLButtonElement>('.ink-btn--primary')?.disabled).toBe(false);
  await click('.ink-btn--primary');
  await act(async () => first?.onComplete?.('stale'));
  expect(store.getSnapshot().byId.get(frame.id)).not.toHaveProperty('assetId');
  await act(async () => state.upload?.onComplete?.('new-image'));
  expect(store.getSnapshot().byId.get(frame.id)).toMatchObject({
    assetId: 'new-image',
    guestHidden: true,
  });
});
