// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import type { CommentThread } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { NoteSideSheet } from '../NoteSideSheet.tsx';
import { fillFragment } from '../note.tsx';
import { resetReviews, setReviews } from '../review-store.ts';
import { BoardStore } from '../store.ts';
import { ClientReviewView } from './ClientReviewView.tsx';
import { resolveDroppedShot, ScheduleView, SHOT_DRAG_TYPE } from './ScheduleView.tsx';

vi.mock('../../lib/session.tsx', () => ({ useSession: () => ({ user: null }) }));

vi.mock('react-i18next', () => {
  const t = (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const disposals: Array<() => void> = [];
afterEach(() => {
  resetReviews();
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
  const onComments = vi.fn();
  const onClose = vi.fn();
  const host = await mount(
    <NoteSideSheet
      noteId={note.id}
      store={store}
      readOnly={false}
      projectName="Production"
      boardName="Storyboard"
      onClose={onClose}
      onComments={onComments}
      onEditOnCanvas={onEdit}
    />,
  );
  expect(host.querySelector('[contenteditable="true"]')?.textContent).toBe(
    'The real production note',
  );
  expect(host.textContent).not.toContain('Antonio');
  const editor = host.querySelector('[contenteditable="true"]');
  expect(editor).not.toBeNull();
  expect(host.querySelector('nav')?.textContent).toBe(
    'ProductionStoryboardThe real production note',
  );
  expect(host.textContent).toContain('shells.noteWords:4');
  const expand = host.querySelector<HTMLButtonElement>('[aria-pressed]');
  await act(async () => expand?.click());
  expect(host.querySelector('dialog')?.classList.contains('note-sidesheet--expanded')).toBe(true);
  expect(expand?.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('[contenteditable="true"]')).toBe(editor);
  await act(async () => expand?.click());
  expect(host.querySelector('dialog')?.classList.contains('note-sidesheet--expanded')).toBe(false);
  await act(async () => {
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent === 'comments.open')
      ?.click();
  });
  expect(onComments).toHaveBeenCalledOnce();
  await act(async () => {
    host.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(onClose).toHaveBeenCalledOnce();
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
  expect(host.textContent).toContain('shells.noteWords:4');
});

it('restores the opener focus when the sheet unmounts', async () => {
  const { doc, store } = board();
  const note = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null });
  const opener = document.createElement('button');
  document.body.append(opener);
  disposals.push(() => opener.remove());
  opener.focus();
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
    this.querySelector('button')?.focus();
  });
  await mount(
    <NoteSideSheet
      noteId={note.id}
      store={store}
      readOnly
      onClose={vi.fn()}
      onEditOnCanvas={vi.fn()}
    />,
  );
  expect(document.activeElement).not.toBe(opener);
  disposals.pop()?.();
  expect(document.activeElement).toBe(opener);
});

it('keeps review rounds unavailable and shows live frames while loading', async () => {
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
  expect(host.textContent).toContain('clientReview.roundsUnavailable');
  expect(host.textContent).toContain('comments.loading');
  expect(host.querySelector('textarea')).toBeNull();
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
  const day = {
    id: crypto.randomUUID(),
    boardId: 'board',
    projectId: crypto.randomUUID(),
    revision: 1,
    date: '2026-11-02',
    callTime: '08:00',
    wrap: null,
    location: '',
    notes: '',
    blocks: [],
  };
  vi.spyOn(api, 'get').mockResolvedValue({ items: [day], nextCursor: null });
  const put = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_path, input) => ({ ...day, ...(input as object), revision: 2 }));
  const host = await mount(<ScheduleView store={store} boardId="board" />);
  const drop = host.querySelector('.schedule__day');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { getData: (type: string) => (type === SHOT_DRAG_TYPE ? payload : '') },
  });
  await act(async () => {
    drop?.dispatchEvent(event);
  });
  expect(drop?.textContent).toContain('5D');
  expect(put).toHaveBeenCalledOnce();
  expect(host.querySelector('.film-shell__badge')).toBeNull();
  expect(drop?.querySelector('.schedule__block')?.textContent).not.toContain('7A');
  expect(resolveDroppedShot(payload, 'board', [frame.id], true)).toBeNull();
  expect(resolveDroppedShot(payload, 'other-board', [frame.id], false)).toBeNull();
  expect(resolveDroppedShot(payload, 'board', [], false)).toBeNull();
  for (const invalid of ['5D', 'null', '{}', '[]', '{"boardId":"board","shotId":5}']) {
    expect(resolveDroppedShot(invalid, 'board', [frame.id], false)).toBeNull();
  }
  const viewer = await mount(<ScheduleView store={store} boardId="board" readOnly />);
  await act(async () => {
    viewer.querySelector('.schedule__day')?.dispatchEvent(event);
  });
  expect(viewer.querySelector('.schedule__day')?.textContent).not.toContain('5D');
  expect(viewer.querySelector('fieldset')?.disabled).toBe(true);
  expect(put).toHaveBeenCalledOnce();
});

it('filters real review decisions, counts approval progress and respects viewer permissions', async () => {
  const { doc, store } = board();
  const approved = createElement(
    doc,
    'frame',
    { x: 0, y: 0 },
    { action: 'Approved shot' },
    { userId: null },
  );
  createElement(doc, 'frame', { x: 100, y: 0 }, { action: 'Pending shot' }, { userId: null });
  resetReviews({
    boardId: 'review-board',
    role: 'viewer',
    status: 'ready',
    reviewsStatus: 'ready',
    reviews: new Map([
      [
        approved.id,
        {
          elementId: approved.id,
          status: 'approved',
          note: null,
          changedBy: { kind: 'deleted' },
          changedAt: '2026-10-26T00:00:00Z',
        },
      ],
    ]),
  });
  const host = await mount(<ClientReviewView store={store} boardId="review-board" />);
  expect(host.querySelector('progress')?.value).toBe(1);
  expect(host.querySelector('progress')?.max).toBe(2);
  expect(host.textContent).not.toContain('review.change');
  const pending = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'clientReview.filters.pending',
  );
  await act(async () => pending?.click());
  expect(host.textContent).toContain('Pending shot');
  expect(host.textContent).not.toContain('Approved shot');
  await act(async () => setReviews({ reviewsStatus: 'error' }));
  expect(host.querySelector('progress')).toBeNull();
  expect(host.textContent).toContain('review.loadError');
});

it('shows guest-visible threads and uses the existing resolve API only for commenters', async () => {
  const { doc, store } = board();
  const frame = createElement(doc, 'frame', { x: 0, y: 0 }, {}, { userId: null });
  const thread: CommentThread = {
    id: 'client-thread',
    boardId: 'review-board',
    elementId: frame.id,
    parentId: null,
    pin: null,
    createdAt: '2026-10-26T00:00:00Z',
    editedAt: null,
    deletedAt: null,
    author: {
      kind: 'guest',
      name: 'Client',
      guestId: 'guest',
      shareLinkId: 'link',
      shareLinkLabel: 'Client link',
    },
    body: 'Please brighten this frame',
    mentions: [],
    visibility: 'everyone',
    shareLinkId: 'link',
    shareLinkLabel: 'Client link',
    canEdit: false,
    canDelete: false,
    resolvedAt: null,
    resolvedBy: null,
    replyCount: 0,
    replies: [],
  };
  resetReviews({
    boardId: 'review-board',
    role: 'viewer',
    status: 'ready',
    reviewsStatus: 'ready',
    threads: [thread, { ...thread, id: 'internal', body: 'Internal note', visibility: 'team' }],
  });
  const host = await mount(<ClientReviewView store={store} boardId="review-board" />);
  expect(host.textContent).toContain('Please brighten this frame');
  expect(host.textContent).not.toContain('Internal note');
  expect(host.textContent).not.toContain('comments.reply');
  expect(host.textContent).not.toContain('comments.resolve');
  await act(async () => setReviews({ role: 'commenter' }));
  expect(host.textContent).toContain('comments.reply');
  const post = vi.spyOn(api, 'post').mockResolvedValue({});
  const resolve = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'comments.resolve',
  );
  await act(async () => resolve?.click());
  expect(post).toHaveBeenCalledWith('/comments/client-thread/resolve', {});
});

it('keeps review threads read-only for viewers', async () => {
  const { doc, store } = board();
  const frame = createElement(doc, 'frame', { x: 0, y: 0 }, {}, { userId: null });
  const thread: CommentThread = {
    id: 'client-thread',
    boardId: 'review-board',
    elementId: frame.id,
    parentId: null,
    pin: null,
    createdAt: '2026-10-26T00:00:00Z',
    editedAt: null,
    deletedAt: null,
    author: {
      kind: 'guest',
      name: 'Client',
      guestId: 'guest',
      shareLinkId: 'link',
      shareLinkLabel: 'Client link',
    },
    body: 'Please brighten this frame',
    mentions: [],
    visibility: 'everyone',
    shareLinkId: 'link',
    shareLinkLabel: 'Client link',
    canEdit: false,
    canDelete: false,
    resolvedAt: null,
    resolvedBy: null,
    replyCount: 0,
    replies: [],
  };
  resetReviews({
    boardId: 'review-board',
    role: 'viewer',
    status: 'ready',
    reviewsStatus: 'ready',
    threads: [thread],
  });
  const host = await mount(<ClientReviewView store={store} boardId="review-board" readOnly />);
  expect(host.textContent).toContain('Please brighten this frame');
  expect(host.textContent).not.toContain('comments.reply');
  expect(host.textContent).not.toContain('comments.resolve');
});
