// @vitest-environment happy-dom

import type { CommentThread, UserSummary } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Thread } from './CommentsPanel.tsx';
import { resetReviews } from './review-store.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), post: vi.fn() }, RequestError: Error }));

const giulia = { id: 'giulia', name: 'Giulia Bianchi' } as UserSummary;
const thread = {
  id: 't1',
  elementId: null,
  body: 'Prima',
  createdAt: '2026-10-25T11:00:00Z',
  visibility: 'team',
  resolvedAt: null,
  replyCount: 0,
  replies: [],
  author: { kind: 'user', user: { id: 'luca', name: 'Luca' } },
  mentions: [],
} as unknown as CommentThread;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  resetReviews({ people: [giulia] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** Types like a person: the value and the caret change together, then the field reports it. */
function type(field: HTMLTextAreaElement, value: string, caret: number) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  set?.call(field, value);
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

it('puts the caret after a picked mention at once, so the next key lands after it', async () => {
  await act(async () =>
    root.render(
      <Thread
        thread={thread}
        writable
        targetLabel="Card"
        pinNumber={0}
        showTarget={false}
        canJump={false}
        onJump={vi.fn()}
      />,
    ),
  );
  const reply = [...host.querySelectorAll('button')].find((b) => b.textContent === 'comments.reply');
  await act(async () => reply?.click());
  const field = host.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => type(field, 'Schiarire @Giu per favore', 'Schiarire @Giu'.length));
  const option = host.querySelector<HTMLElement>('[role="option"]');
  expect(option?.textContent).toBe('Giulia Bianchi');
  await act(async () => option?.click());

  // Right after the click, before any animation frame: nothing typed now may be moved.
  expect(field.value).toBe('Schiarire @Giulia Bianchi  per favore');
  const at = 'Schiarire @Giulia Bianchi '.length;
  expect([field.selectionStart, field.selectionEnd]).toEqual([at, at]);
  expect(document.activeElement).toBe(field);
});
