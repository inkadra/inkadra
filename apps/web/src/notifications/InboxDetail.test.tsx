// @vitest-environment happy-dom
import type { Comment, CommentThread, Notification } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { InboxDetail } from './InboxDetail.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const notification = (id: string, elementId: string | null = null) =>
  ({
    id,
    boardId: 'b',
    threadId: id,
    commentId: id,
    elementId,
    createdAt: '2026-10-25T11:00:00Z',
    type: 'comment',
  }) as Notification;
const reply = (id: string, createdAt = '2026-10-25T11:00:00Z') =>
  ({
    id,
    body: `message ${id}`,
    createdAt,
    visibility: 'everyone',
  }) as Comment;
const thread = (id: string, patch: Partial<CommentThread> = {}) =>
  ({
    ...reply(id),
    resolvedAt: null,
    replyCount: 0,
    replies: [],
    ...patch,
  }) as CommentThread;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const render = async (id: string, elementId: string | null = null) =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <InboxDetail
          notification={notification(id, elementId)}
          onNavigate={vi.fn()}
          onCount={vi.fn()}
        />
      </MemoryRouter>,
    ),
  );
const button = (key: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === key);
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('clears actionable state during A to B loading and ignores late loads', async () => {
  const pageA = deferred<{ items: CommentThread[]; nextCursor: null }>();
  const pageB = deferred<{ items: CommentThread[]; nextCursor: null }>();
  let page = pageA;
  vi.mocked(api.get).mockImplementation((path) =>
    path === '/boards/b' ? Promise.resolve({ myRole: 'editor' }) : page.promise,
  );
  await render('a');
  page = pageB;
  await render('b');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('.inbox-detail__resolve-btn')).toBeNull();
  await act(async () => pageA.resolve({ items: [thread('a')], nextCursor: null }));
  expect(host.textContent).not.toContain('message a');
  await act(async () => pageB.resolve({ items: [thread('b')], nextCursor: null }));
  expect(host.textContent).toContain('message b');
});

it('ignores reply and resolve responses after switching notification', async () => {
  const sent = deferred<Comment>();
  const resolved = deferred<object>();
  vi.mocked(api.get).mockImplementation((path) =>
    Promise.resolve(
      path === '/boards/b'
        ? { myRole: 'commenter' }
        : { items: [thread('a'), thread('b')], nextCursor: null },
    ),
  );
  vi.mocked(api.post).mockImplementation((path) =>
    path.endsWith('/resolve') ? resolved.promise : sent.promise,
  );
  await render('a');
  await act(async () => {
    const input = host.querySelector('textarea')!;
    input.value = 'pending reply';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('notifications.sendReply')?.click());
  await act(async () => button('notifications.markResolved')?.click());
  await render('b');
  await act(async () => {
    sent.resolve(reply('late'));
    resolved.resolve({});
  });
  expect(host.querySelector('.inbox-detail__thread-messages')?.textContent).toContain('message b');
  expect(host.querySelector('.inbox-detail__thread-messages')?.textContent).not.toContain(
    'message late',
  );
  expect(button('notifications.markResolved')).toBeDefined();
});

it('paginates to the exact thread and shows unavailable instead of a sibling when missing or deleted', async () => {
  vi.mocked(api.get).mockImplementation((path) =>
    Promise.resolve(
      path === '/boards/b'
        ? { myRole: 'editor' }
        : path.includes('cursor=next')
          ? { items: [thread('target')], nextCursor: null }
          : { items: [thread('sibling')], nextCursor: 'next' },
    ),
  );
  await render('target');
  expect(host.querySelector('.inbox-detail__thread-messages')?.textContent).toContain(
    'message target',
  );
  expect(api.get).toHaveBeenCalledWith('/boards/b/comments?status=all&cursor=next');
  await render('missing');
  expect(host.textContent).toContain('notifications.conversationUnavailable');
  expect(host.querySelector('textarea')).toBeNull();
  vi.mocked(api.get).mockImplementation((path) =>
    Promise.resolve(
      path === '/boards/b'
        ? { myRole: 'editor' }
        : { items: [thread('deleted', { deletedAt: '2026-10-25T12:00:00Z' })], nextCursor: null },
    ),
  );
  await render('deleted');
  expect(host.textContent).toContain('notifications.conversationUnavailable');
});

it('gates viewer actions and shows the server-defined audience as read-only', async () => {
  vi.mocked(api.get).mockImplementation((path) =>
    Promise.resolve(
      path === '/boards/b' ? { myRole: 'viewer' } : { items: [thread('a')], nextCursor: null },
    ),
  );
  await render('a');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('.inbox-detail__resolve-btn')).toBeNull();
  expect(host.querySelector('[role="tab"]')).toBeNull();
  expect(host.textContent).toContain('notifications.visibleToClient');
});

it('deduplicates overlapping reply pages, sorts chronologically and stops at the last cursor', async () => {
  const a = reply('a', '2026-10-25T10:00:00Z');
  const b = reply('b', '2026-10-25T11:00:00Z');
  const c = reply('c', '2026-10-25T12:00:00Z');
  const d = reply('d', '2026-10-25T11:30:00Z');
  vi.mocked(api.get).mockImplementation((path) =>
    Promise.resolve(
      path === '/boards/b'
        ? { myRole: 'editor' }
        : path.includes('/replies')
          ? path.includes('cursor=next')
            ? { items: [b, d, c], nextCursor: null }
            : { items: [b, a], nextCursor: 'next' }
          : { items: [thread('t', { replyCount: 4, replies: [c] })], nextCursor: null },
    ),
  );
  await render('t');
  await act(async () => button('comments.moreReplies')?.click());
  expect(button('comments.moreReplies')).toBeDefined();
  await act(async () => button('comments.moreReplies')?.click());
  const messages = [...host.querySelectorAll('.inbox-detail__message-body')].map(
    (m) => m.textContent,
  );
  expect(messages).toEqual(['message t', 'message a', 'message b', 'message d', 'message c']);
  expect(button('comments.moreReplies')).toBeUndefined();
});

it('surfaces failed loads and mutations with retry, and refreshes the detail', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('unavailable'));
  await render('a');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('notifications.error');
  let body = 'original';
  vi.mocked(api.get).mockImplementation((path) =>
    Promise.resolve(
      path === '/boards/b'
        ? { myRole: 'editor' }
        : { items: [thread('a', { body })], nextCursor: null },
    ),
  );
  await act(async () => button('comments.retry')?.click());
  vi.mocked(api.post).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({});
  await act(async () => button('notifications.markResolved')?.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('notifications.actionError');
  await act(async () => button('comments.retry')?.click());
  expect(button('notifications.markReopen')).toBeDefined();
  body = 'updated';
  await act(async () => button('notifications.refresh')?.click());
  expect(host.querySelector('.inbox-detail__thread-messages')?.textContent).toContain('updated');
});

it('hides "other comments" when the notification is not tied to a frame', async () => {
  vi.mocked(api.get).mockImplementation((path) =>
    Promise.resolve(
      path === '/boards/b'
        ? { myRole: 'editor' }
        : { items: [thread('a'), thread('b')], nextCursor: null },
    ),
  );
  await render('a', 'el');
  expect(host.querySelector('.inbox-detail__other-comments')).not.toBeNull();
  await render('b');
  expect(host.querySelector('.inbox-detail__other-comments')).toBeNull();
});

it('removes loaded A controls while B is pending and refreshes the selected sibling', async () => {
  const pending = deferred<{ items: CommentThread[]; nextCursor: null }>();
  let loading = false;
  vi.mocked(api.get).mockImplementation((path) =>
    path === '/boards/b'
      ? Promise.resolve({ myRole: 'editor' })
      : loading
        ? pending.promise
        : Promise.resolve({ items: [thread('a'), thread('b')], nextCursor: null }),
  );
  await render('a', 'el');
  expect(host.querySelector('textarea')).not.toBeNull();
  loading = true;
  await render('b', 'el');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('.inbox-detail__resolve-btn')).toBeNull();
  await act(async () => pending.resolve({ items: [thread('a'), thread('b')], nextCursor: null }));
  const sibling = host.querySelector<HTMLButtonElement>('.inbox-detail__other-item')!;
  await act(async () => sibling.click());
  expect(host.querySelector('.inbox-detail__thread-messages')?.textContent).toContain('message a');
  loading = false;
  await act(async () => button('notifications.refresh')?.click());
  expect(host.querySelector('.inbox-detail__thread-messages')?.textContent).toContain('message a');
});
