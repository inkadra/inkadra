// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { NoteSideSheet } from '../NoteSideSheet.tsx';
import { fillFragment } from '../note.tsx';
import { BoardStore } from '../store.ts';
import { ClientReviewView } from './ClientReviewView.tsx';
import { resolveDroppedShot, ScheduleView, SHOT_DRAG_TYPE } from './ScheduleView.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const disposals: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) dispose();
});
async function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}
function board() {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  disposals.push(() => {
    store.destroy();
    doc.destroy();
  });
  return { doc, store };
}

it('opens the actual note fragment in the existing editor and keeps canvas editing accessible', async () => {
  const { doc, store } = board();
  const note = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null });
  const fragment = store.map(note.id)?.get('body') as Y.XmlFragment;
  fillFragment(fragment, 'The real production note');
  // happy-dom does not implement the native modal API.
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  const onEdit = vi.fn();
  const host = await mount(
    <NoteSideSheet
      noteId={note.id}
      store={store}
      readOnly={false}
      onClose={vi.fn()}
      onEditOnCanvas={onEdit}
    />,
  );
  expect(host.querySelector('[contenteditable="true"]')?.textContent).toBe(
    'The real production note',
  );
  expect(host.textContent).not.toContain('Antonio');
  const editor = host.querySelector('[contenteditable="true"]');
  expect(editor).not.toBeNull();
  const canvasButton = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'shells.editOnCanvas',
  );
  await act(async () => canvasButton?.click());
  expect(onEdit).toHaveBeenCalledOnce();
});

it('shows live note content without an editor for read-only access', async () => {
  const { doc, store } = board();
  const note = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null });
  const fragment = store.map(note.id)?.get('body') as Y.XmlFragment;
  fillFragment(fragment, 'Shared note');
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  const host = await mount(
    <NoteSideSheet
      noteId={note.id}
      store={store}
      readOnly
      onClose={vi.fn()}
      onEditOnCanvas={vi.fn()}
    />,
  );
  expect(host.querySelector('[contenteditable="true"]')).toBeNull();
  expect(host.textContent).toContain('Shared note');
  expect(host.textContent).not.toContain('shells.editOnCanvas');
  await act(async () => {
    fillFragment(fragment, 'Remote update');
  });
  expect(host.textContent).toContain('Remote update');
});

it('disables review submission, decisions and comments without claiming a save', async () => {
  const { doc, store } = board();
  createElement(
    doc,
    'frame',
    { x: 0, y: 0 },
    { label: '5D', action: 'Actual shot' },
    { userId: null },
  );
  const host = await mount(<ClientReviewView store={store} />);
  const submit = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'shells.submitReview',
  );
  expect(submit?.disabled).toBe(true);
  expect(host.textContent).toContain('shells.reviewUnavailable');
  expect([...host.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  expect(host.querySelector('textarea')?.disabled).toBe(true);
  expect(host.textContent).toContain('Actual shot');
});

it('renders the dropped shot identity and rejects foreign, malformed and read-only drops', async () => {
  const { doc, store } = board();
  const frame = createElement(
    doc,
    'frame',
    { x: 0, y: 0 },
    { label: '5D', action: 'Dropped shot' },
    { userId: null },
  );
  createElement(doc, 'frame', { x: 100, y: 0 }, { label: '7A' }, { userId: null });
  const payload = JSON.stringify({ boardId: 'board', shotId: frame.id });
  const host = await mount(<ScheduleView store={store} boardId="board" />);
  const drop = host.querySelector('.film-shell__drop');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { getData: (type: string) => (type === SHOT_DRAG_TYPE ? payload : '') },
  });
  await act(async () => {
    drop?.dispatchEvent(event);
  });
  expect(drop?.textContent).toContain('5D');
  expect(drop?.textContent).not.toContain('7A');
  expect(resolveDroppedShot(payload, 'board', [frame.id], true)).toBeNull();
  expect(resolveDroppedShot(payload, 'other-board', [frame.id], false)).toBeNull();
  expect(resolveDroppedShot(payload, 'board', [], false)).toBeNull();
  for (const invalid of ['5D', 'null', '{}', '[]', '{"boardId":"board","shotId":5}']) {
    expect(resolveDroppedShot(invalid, 'board', [frame.id], false)).toBeNull();
  }
  const viewer = await mount(<ScheduleView store={store} boardId="board" readOnly />);
  await act(async () => {
    viewer.querySelector('.film-shell__drop')?.dispatchEvent(event);
  });
  expect(viewer.querySelector('.film-shell__drop')?.textContent).not.toContain('5D');
});
