// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import {
  describeNotification,
  initials,
  NotificationBell,
  NotificationList,
  notificationActor,
  useNotificationFeed,
} from './Notifications.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../board/connection.ts', () => ({ useBoardConnection: vi.fn(() => null) }));

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

it('builds initials from the first two words, ignoring extra whitespace', () => {
  expect(initials('Giulia Bianchi')).toBe('GB');
  expect(initials('  Giulia   Bianchi ')).toBe('GB');
  expect(initials('Laura')).toBe('LA');
  expect(initials(null)).toBe('IN');
  expect(initials('')).toBe('IN');
});

it('names an opened link by its label, with no guest or visit details', () => {
  const t = (key: string) => key;
  const opened = { type: 'link_opened', actor: null, reviewStatus: null } as const;
  expect(notificationActor({ ...opened, shareLinkLabel: ' Cliente ' }, t)).toBe('Cliente');
  expect(notificationActor({ ...opened, shareLinkLabel: null }, t)).toBe(
    'notifications.type.guest',
  );
  expect(describeNotification(opened, t)).toBe('notifications.type.link_opened');
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
                visibility: 'everyone',
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

    expect(host.textContent).not.toContain('notifications.loadedOnly');

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
    expect(host.querySelector('.inbox-detail__preview-svg')).toBeNull();
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
  vi.useFakeTimers();
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

    // Press ArrowDown on the list item to focus and select the second item
    await act(async () => {
      host
        .querySelector('[data-notification-id="n1"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    // Selecting unread item marks it read only once scrolling stops (~400 ms debounce)
    expect(api.post).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(400));
    expect(api.post).toHaveBeenCalledWith('/me/notifications/n2/read', {});

    // Press Escape to close
    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
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
    return Promise.resolve({ myRole: 'commenter' });
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

it('does not auto-select or auto-read on mobile while the detail is hidden', async () => {
  const media = window.matchMedia('(width < 768px)');
  Object.defineProperty(media, 'matches', { value: true });
  const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(media);
  const host = document.createElement('div');
  const root = createRoot(host);
  vi.mocked(api.get).mockResolvedValue({
    items: [{ ...baseNotification, id: 'mobile', readAt: null }],
    nextCursor: null,
  });
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={1}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onCount={vi.fn()}
          />
        </MemoryRouter>,
      ),
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(host.querySelector('.notifications__detail-pane')).toBeNull();
    expect(host.querySelector('[aria-current="true"]')).toBeNull();
    expect(api.get).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    matchMedia.mockRestore();
  }
});

it('keeps Enter on action buttons and moves list focus with a roving tab stop', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onNavigate = vi.fn();
  vi.mocked(api.get).mockImplementation((path) =>
    Promise.resolve(
      path.startsWith('/me/notifications')
        ? {
            items: [
              { ...baseNotification, id: 'first' },
              { ...baseNotification, id: 'second' },
            ],
            nextCursor: null,
          }
        : path.includes('/comments')
          ? { items: [], nextCursor: null }
          : { myRole: 'viewer' },
    ),
  );
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={0}
            onClose={vi.fn()}
            onNavigate={onNavigate}
            onCount={vi.fn()}
          />
        </MemoryRouter>,
      ),
    );
    const first = host.querySelector<HTMLButtonElement>('[data-notification-id="first"]')!;
    const second = host.querySelector<HTMLButtonElement>('[data-notification-id="second"]')!;
    await act(async () => {
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(second);
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    expect(second.getAttribute('aria-current')).toBe('true');
    const headerAction = host.querySelector<HTMLButtonElement>('.notifications__head button')!;
    const detailAction = host.querySelector<HTMLButtonElement>('.inbox-detail__actions button')!;
    await act(async () => {
      headerAction.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      detailAction.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('skips pathless items, focuses the first enabled item from the panel and debounces mark-read', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const items = [
    { ...baseNotification, id: 'pathless', projectId: null, readAt: null },
    { ...baseNotification, id: 'n1', readAt: null },
    { ...baseNotification, id: 'n2', readAt: null },
  ];
  vi.mocked(api.get).mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith('/me/notifications') ? { items, nextCursor: null } : { items: [] },
    ),
  );
  vi.mocked(api.post).mockResolvedValue({});
  const onCount = vi.fn().mockResolvedValue(undefined);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={2}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onCount={onCount}
          />
        </MemoryRouter>,
      ),
    );
    const pathless = host.querySelector<HTMLButtonElement>('[data-notification-id="pathless"]')!;
    const first = host.querySelector<HTMLButtonElement>('[data-notification-id="n1"]')!;
    const second = host.querySelector<HTMLButtonElement>('[data-notification-id="n2"]')!;
    expect(pathless.disabled).toBe(true);
    expect(pathless.tabIndex).toBe(-1);
    expect(first.tabIndex).toBe(0);

    // ArrowDown on the panel enters the list at the first enabled item
    const dialog = host.querySelector('[role="dialog"]')!;
    await act(async () => {
      (dialog as HTMLElement).focus();
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
    expect(second.tabIndex).toBe(-1);

    // Arrow navigation defers mark-read: no POST while scrolling, one ~400 ms after stopping
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(second);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/me/notifications/n1/read', {});
    await act(async () => vi.advanceTimersByTime(400));
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenLastCalledWith('/me/notifications/n2/read', {});
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});

const count = async () => {};

/** The app shell's wiring: one feed for the bell and the Inbox. */
function Shell({ inbox, onOpenInbox }: { inbox: boolean; onOpenInbox: () => void }) {
  const feed = useNotificationFeed(count);
  return (
    <>
      <NotificationBell unread={1} onCount={count} feed={feed} onOpenInbox={onOpenInbox} />
      {inbox && (
        <NotificationList
          fixed
          unread={1}
          onClose={() => {}}
          onNavigate={() => {}}
          onCount={count}
          feed={feed}
        />
      )}
    </>
  );
}

it('shows the bell as a peek of the Inbox: same title, same read state, Open inbox at the bottom', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onOpenInbox = vi.fn();
  vi.mocked(api.get).mockResolvedValue({
    items: [{ ...baseNotification, id: 'n1', type: 'mention', readAt: null, excerpt: 'Hi' }],
    nextCursor: null,
  });
  vi.mocked(api.post).mockResolvedValue({});
  const render = (inbox: boolean) =>
    root.render(
      <MemoryRouter>
        <Shell inbox={inbox} onOpenInbox={onOpenInbox} />
      </MemoryRouter>,
    );
  try {
    await act(async () => render(false));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.notification-bell__button')?.click(),
    );
    expect(host.querySelector('#notifications-title')?.textContent).toContain('nav.inbox');
    expect(host.querySelector('.notification.is-unread')).not.toBeNull();
    // Read in the peek…
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('.notification button[aria-label="notifications.read"]')
        ?.click(),
    );
    expect(api.post).toHaveBeenCalledWith('/me/notifications/n1/read', {});
    const open = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'notifications.openInbox',
    );
    await act(async () => open?.click());
    expect(onOpenInbox).toHaveBeenCalled();
    expect(host.querySelector('.notification-bell .notifications')).toBeNull();
    // …and the Inbox lists the same item, already read, without another fetch before it reloads.
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    await act(async () => render(true));
    expect(host.querySelector('.notifications--fixed .notification')).not.toBeNull();
    expect(host.querySelector('.notifications--fixed .notification.is-unread')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

type Feed = ReturnType<typeof useNotificationFeed>;

function FeedProbe({ into }: { into: { feed: Feed | null } }) {
  into.feed = useNotificationFeed(count);
  return null;
}

/** Renders the shared feed alone and hands it back after each render. */
async function mountFeed() {
  const host = document.createElement('div');
  const root = createRoot(host);
  const ref: { feed: Feed | null } = { feed: null };
  await act(async () => root.render(<FeedProbe into={ref} />));
  return {
    feed: () => ref.feed as Feed,
    unmount: () => act(async () => root.unmount()),
  };
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

it('drops a stale first-page response and keeps a newer local read', async () => {
  const unreadItem = { ...baseNotification, id: 'n1', type: 'mention', readAt: null };
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  vi.mocked(api.get).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.mocked(api.post).mockResolvedValue({});
  const { feed, unmount } = await mountFeed();
  try {
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = feed().load(null);
      b = feed().load(null);
    });
    // The newer load answers first; the item is then read here.
    await act(async () => {
      second.resolve({ items: [unreadItem], nextCursor: null });
      await b;
    });
    await act(async () => feed().markRead('n1'));
    expect(feed().items[0]?.readAt).not.toBeNull();
    // The older load lands last, from before the read: it is ignored.
    await act(async () => {
      first.resolve({ items: [unreadItem, { ...unreadItem, id: 'old' }], nextCursor: null });
      await a;
    });
    expect(feed().items.map((n) => n.id)).toEqual(['n1']);
    expect(feed().items[0]?.readAt).not.toBeNull();
    // A later reload fetched before the server saw the read does not bring it back as unread.
    vi.mocked(api.get).mockResolvedValueOnce({ items: [unreadItem], nextCursor: null });
    await act(async () => feed().load(null));
    expect(feed().items[0]?.readAt).not.toBeNull();
  } finally {
    await unmount();
  }
});

it('keeps the pages loaded with Show more when the first page reloads', async () => {
  const at = (id: string, createdAt: string) => ({
    ...baseNotification,
    id,
    type: 'mention',
    createdAt,
  });
  const page1 = [at('a', '2026-10-25T12:00:00Z'), at('b', '2026-10-25T11:00:00Z')];
  const page2 = [at('c', '2026-10-25T10:00:00Z'), at('d', '2026-10-25T09:00:00Z')];
  vi.mocked(api.get)
    .mockResolvedValueOnce({ items: page1, nextCursor: 'p2' })
    .mockResolvedValueOnce({ items: page2, nextCursor: 'p3' })
    .mockResolvedValueOnce({
      items: [at('new', '2026-10-25T13:00:00Z'), page1[0]],
      nextCursor: 'x',
    });
  const { feed, unmount } = await mountFeed();
  try {
    await act(async () => feed().load(null));
    await act(async () => feed().load('p2'));
    await act(async () => feed().load(null));
    expect(feed().items.map((n) => n.id)).toEqual(['new', 'a', 'b', 'c', 'd']);
    // "Show more" continues after the last page already shown.
    expect(feed().next).toBe('p3');
  } finally {
    await unmount();
  }
});

it('shows the filter helper only for an active filter when more pages exist', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  vi.mocked(api.get).mockResolvedValue({ items: [], nextCursor: 'more' });
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
  expect(host.textContent).not.toContain('notifications.loadedOnly');
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent === 'notifications.tabs.mentions')
      ?.click(),
  );
  expect(host.textContent).toContain('notifications.loadedOnly');
  await act(async () => root.unmount());
});

it('does not auto-read hidden assignment notifications when opening My tasks', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const items = [
    { ...baseNotification, id: 'read-comment', type: 'comment' },
    {
      ...baseNotification,
      id: 'task',
      type: 'task_assigned',
      readAt: null,
      commentId: null,
      threadId: null,
    },
  ];
  vi.mocked(api.get).mockImplementation(async (path: string) =>
    path.startsWith('/me/notifications') ? { items, nextCursor: null } : { items: [] },
  );
  vi.mocked(api.post).mockResolvedValue({});
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={1}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onCount={vi.fn().mockResolvedValue(undefined)}
          />
        </MemoryRouter>,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === 'tasks.title')
        ?.click(),
    );
    expect(host.querySelector('.notifications--tasks')).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    const down = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    host.querySelector('[role="dialog"]')?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
