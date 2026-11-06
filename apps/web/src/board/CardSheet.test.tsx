// @vitest-environment happy-dom

import type { CommentThread } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { Reply } from './CardSheet.tsx';
import { resetReviews, setReviews } from './review-store.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), post: vi.fn() }, RequestError: Error }));

const thread = (visibility: string) =>
  ({
    id: 't1',
    elementId: 'card',
    body: 'Più corta?',
    createdAt: '2026-10-25T11:00:00Z',
    visibility,
    resolvedAt: null,
    replyCount: 0,
    replies: [],
    author: { kind: 'user', user: { id: 'luca', name: 'Luca' } },
    mentions: [],
    reactions: [],
    unread: false,
  }) as unknown as CommentThread;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.post).mockResolvedValue({});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetReviews();
});

async function open(visibility: string) {
  setReviews({ role: 'editor', threads: [thread(visibility)] });
  await act(async () => root.render(<Reply boardId="b" elementId="card" />));
  const field = host.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      field,
      'Sì, la accorcio',
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
  });
  return field;
}

/** Enter as the browser sends it from a field, with the implicit submit it can trigger. */
async function pressEnter(field: HTMLTextAreaElement, modifier = false) {
  await act(async () => {
    field.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: modifier,
        bubbles: true,
        cancelable: true,
      }),
    );
    if (!modifier) field.form?.requestSubmit();
  });
}

it('says who reads a reply to a public thread, and only its button sends it', async () => {
  const field = await open('everyone');
  expect(host.querySelector('.comment-audience')?.textContent).toContain('comments.replyGuests');
  await pressEnter(field);
  await pressEnter(field, true);
  expect(api.post).not.toHaveBeenCalled();
  const send = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  await act(async () => {
    send?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
  expect(api.post).toHaveBeenCalledWith('/boards/b/comments', {
    body: 'Sì, la accorcio',
    parentId: 't1',
  });
});

it('sends a reply to the team with the shortcut, and warns nobody', async () => {
  const field = await open('team');
  expect(host.querySelector('.comment-audience')).toBeNull();
  await pressEnter(field, true);
  expect(api.post).toHaveBeenCalledTimes(1);
});
