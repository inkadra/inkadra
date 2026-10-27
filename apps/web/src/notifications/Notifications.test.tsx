// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { NotificationList } from './Notifications.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const baseNotification = {
  actor: { kind: 'user', user: { id: 'u1', name: 'Laura', image: null } },
  projectId: 'p1',
  boardId: 'b1',
  elementId: 'el1',
  commentId: 'c1',
  threadId: 't1',
  boardTitle: 'Storyboard',
  projectName: 'Ultima corsa',
  reviewStatus: null,
  readAt: '2026-10-25T12:00:00Z',
  createdAt: '2026-10-25T11:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

it('keeps the API unread count across pages and excludes comments from mentions', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  vi.mocked(api.get)
    .mockResolvedValueOnce({
      items: [
        { ...baseNotification, id: 'm', type: 'mention', excerpt: 'A real mention' },
        { ...baseNotification, id: 'c', type: 'comment', excerpt: 'A plain comment' },
      ],
      nextCursor: 'next',
    })
    .mockResolvedValueOnce({
      items: [{ ...baseNotification, id: 'r', type: 'reply', excerpt: 'A reply' }],
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
    expect(tabs.length).toBeGreaterThanOrEqual(3);
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
  }
});

it('renders the two-pane triage view and marks unread notification as read on open', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const unreadItem = {
    ...baseNotification,
    id: 'n-unread',
    readAt: null,
    type: 'comment',
    excerpt: 'Need more light',
  };
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith('/me/notifications')) {
      return Promise.resolve({ items: [unreadItem], nextCursor: null });
    }
    if (path.startsWith('/boards/b1/comments')) {
      return Promise.resolve({
        items: [
          {
            id: 't1',
            boardId: 'b1',
            elementId: 'el1',
            parentId: null,
            pin: { x: 0.51, y: 0.3 },
            createdAt: '2026-10-25T11:00:00Z',
            author: baseNotification.actor,
            body: 'Need more light on frame',
            visibility: 'everyone',
            resolvedAt: null,
            replyCount: 1,
            replies: [
              {
                id: 'r1',
                boardId: 'b1',
                elementId: 'el1',
                parentId: 't1',
                createdAt: '2026-10-25T11:05:00Z',
                author: { kind: 'user', user: { id: 'u2', name: 'Giulia', image: null } },
                body: 'Small panel on the right',
                visibility: 'team',
              },
            ],
          },
        ],
        nextCursor: null,
      });
    }
    if (path === '/boards/b1') {
      return Promise.resolve({
        id: 'b1',
        title: 'Storyboard',
        breadcrumb: [{ id: 'sc4', title: 'Scena 4', kind: 'board' }],
      });
    }
    return Promise.resolve({});
  });
  vi.mocked(api.post).mockResolvedValue({});

  const onCount = vi.fn().mockResolvedValue(undefined);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={1}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onCount={onCount}
          />
        </MemoryRouter>,
      ),
    );

    // Two-pane structure
    expect(host.querySelector('.notifications__list-pane')).not.toBeNull();
    expect(host.querySelector('.notifications__detail-pane')).not.toBeNull();

    // Mark read on open
    expect(api.post).toHaveBeenCalledWith('/me/notifications/n-unread/read', {});
    expect(onCount).toHaveBeenCalled();

    // Detail breadcrumb and comments
    expect(host.querySelector('.inbox-detail__breadcrumb')?.textContent).toContain('Ultima corsa');
    expect(host.querySelector('.inbox-detail__breadcrumb')?.textContent).toContain('Scena 4');
    expect(host.textContent).toContain('Need more light on frame');
    expect(host.textContent).toContain('Small panel on the right');
    expect(host.querySelector('.inbox-detail__pin--active')?.textContent).toBe('1');
  } finally {
    await act(async () => root.unmount());
  }
});

it('supports keyboard navigation with arrows, Enter, and Escape', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const items = [
    { ...baseNotification, id: 'n1', readAt: '2026-10-25T10:00:00Z', excerpt: 'First note' },
    { ...baseNotification, id: 'n2', readAt: null, excerpt: 'Second note' },
  ];
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith('/me/notifications')) {
      return Promise.resolve({ items, nextCursor: null });
    }
    return Promise.resolve({ items: [] });
  });
  vi.mocked(api.post).mockResolvedValue({});

  const onClose = vi.fn();
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={1}
            onClose={onClose}
            onNavigate={vi.fn()}
            onCount={vi.fn()}
          />
        </MemoryRouter>,
      ),
    );

    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    // Press ArrowDown to select second item
    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    // Selecting unread item marks it read
    expect(api.post).toHaveBeenCalledWith('/me/notifications/n2/read', {});

    // Press Escape to close
    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

it('allows replying to and resolving threads from the inbox detail pane', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const thread = {
    id: 't1',
    boardId: 'b1',
    elementId: 'el1',
    parentId: null,
    pin: { x: 0.5, y: 0.5 },
    createdAt: '2026-10-25T11:00:00Z',
    author: baseNotification.actor,
    body: 'Original thread',
    visibility: 'everyone',
    resolvedAt: null,
    replyCount: 0,
    replies: [],
  };

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith('/me/notifications')) {
      return Promise.resolve({
        items: [{ ...baseNotification, id: 'n1' }],
        nextCursor: null,
      });
    }
    if (path.startsWith('/boards/b1/comments')) {
      return Promise.resolve({ items: [thread], nextCursor: null });
    }
    return Promise.resolve({});
  });
  vi.mocked(api.post).mockImplementation((path: string) => {
    if (path.includes('/resolve')) {
      return Promise.resolve({ ...thread, resolvedAt: '2026-10-25T12:00:00Z' });
    }
    if (path.includes('/comments')) {
      return Promise.resolve({
        id: 'r-new',
        boardId: 'b1',
        elementId: 'el1',
        parentId: 't1',
        createdAt: '2026-10-25T12:05:00Z',
        author: { kind: 'user', user: { id: 'me', name: 'Me', image: null } },
        body: 'New reply from inbox',
        visibility: 'everyone',
      });
    }
    return Promise.resolve({});
  });

  try {
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

    // Resolve thread button
    const resolveBtn = host.querySelector<HTMLButtonElement>('.inbox-detail__resolve-btn');
    expect(resolveBtn?.textContent).toContain('notifications.markResolved');
    await act(async () => resolveBtn?.click());
    expect(api.post).toHaveBeenCalledWith('/comments/t1/resolve', {});

    // Reply via composer
    const textarea = host.querySelector<HTMLTextAreaElement>('.inbox-detail__composer-textarea');
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (textarea) {
        const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        desc?.set?.call(textarea, 'New reply from inbox');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const sendBtn = [
      ...host.querySelectorAll<HTMLButtonElement>('.inbox-detail__composer button'),
    ].find((b) => b.textContent?.includes('notifications.sendReply'));
    expect(sendBtn).toBeDefined();
    await act(async () => sendBtn?.click());

    expect(api.post).toHaveBeenCalledWith('/boards/b1/comments', {
      parentId: 't1',
      body: 'New reply from inbox',
    });
  } finally {
    await act(async () => root.unmount());
  }
});
