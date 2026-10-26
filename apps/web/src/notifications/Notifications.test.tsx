// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { NotificationList } from './Notifications.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

it('keeps the API unread count across pages and excludes comments from mentions', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const notification = {
    actor: null,
    projectId: 'p',
    boardId: 'b',
    elementId: null,
    commentId: null,
    boardTitle: 'Board',
    projectName: 'Project',
    reviewStatus: null,
    readAt: '2026-10-25T12:00:00Z',
    createdAt: '2026-10-25T11:00:00Z',
  };
  vi.mocked(api.get)
    .mockResolvedValueOnce({
      items: [
        { ...notification, id: 'm', type: 'mention', excerpt: 'A real mention' },
        { ...notification, id: 'c', type: 'comment', excerpt: 'A plain comment' },
      ],
      nextCursor: 'next',
    })
    .mockResolvedValueOnce({
      items: [{ ...notification, id: 'r', type: 'reply', excerpt: 'A reply' }],
      nextCursor: null,
    });
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={7}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onCount={vi.fn()}
          />
        </MemoryRouter>,
      ),
    );
    expect(host.querySelector('h2 span')?.textContent).toBe('7');
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(3);
    await act(async () =>
      tabs.find((tab) => tab.textContent === 'notifications.tabs.mentions')?.click(),
    );
    expect(host.textContent).toContain('A real mention');
    expect(host.textContent).not.toContain('A plain comment');
    expect(host.querySelector('.notifications-tab-badge')).toBeNull();
    const more = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'notifications.more',
    );
    await act(async () => more?.click());
    expect(host.querySelector('h2 span')?.textContent).toBe('7');
    expect(host.textContent).not.toContain('A reply');
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={0}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onCount={vi.fn()}
          />
        </MemoryRouter>,
      ),
    );
    expect(host.querySelector('h2 span')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.resetAllMocks();
  }
});
