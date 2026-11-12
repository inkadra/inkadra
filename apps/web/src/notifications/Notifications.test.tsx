// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import {
  describeNotification,
  initials,
  NotificationBell,
  NotificationList,
  notificationActor,
  relativeTime,
  useNotificationFeed,
} from './Notifications.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
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

describe('swiping a notification on a phone', () => {
  const realMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
    vi.useRealTimers();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  /** A list of one notification of a thread, with this role and thread, swiped by a finger. */
  async function swiped(
    role: string,
    resolvedAt: string | null,
    notification: object = baseNotification,
  ) {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith('/me/notifications'))
        return {
          items: [{ id: 'n', type: 'reply', excerpt: 'x', ...notification }],
          nextCursor: null,
        };
      if (path === '/boards/b1') return { myRole: role };
      return { items: [{ id: 't1', resolvedAt, deletedAt: null }], nextCursor: null };
    });
    vi.mocked(api.post).mockResolvedValue({});
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList unread={0} onClose={vi.fn()} onNavigate={vi.fn()} onCount={vi.fn()} />
        </MemoryRouter>,
      ),
    );
    const front = host.querySelector('.swipe-row__front') as HTMLElement;
    front.setPointerCapture = vi.fn();
    const finger = (type: string, clientX: number) =>
      front.dispatchEvent(
        new PointerEvent(type, { pointerType: 'touch', clientX, clientY: 0, bubbles: true }),
      );
    await act(async () => {
      finger('pointerdown', 200);
      finger('pointermove', 120);
    });
    const action = (name: string) =>
      [...host.querySelectorAll('.swipe-row__action')].find((b) => b.textContent === name) as
        | HTMLButtonElement
        | undefined;
    return { host, action, unmount: () => act(async () => root.unmount()) };
  }

  it('offers Resolve to who can comment, on an open thread', async () => {
    const { action, unmount } = await swiped('commenter', null);
    expect(action('notifications.swipeResolve')).toBeDefined();
    await unmount();
  });

  it('hides Resolve from who can only read, and on a thread already resolved', async () => {
    const reader = await swiped('viewer', null);
    expect(reader.action('notifications.swipeResolve')).toBeUndefined();
    await reader.unmount();
    const done = await swiped('editor', '2026-10-25T12:00:00Z');
    expect(done.action('notifications.swipeResolve')).toBeUndefined();
    await done.unmount();
  });

  it('marks the notification read after resolving, and the message goes away', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { host, action, unmount } = await swiped('editor', null, {
      ...baseNotification,
      readAt: null,
    });
    await act(async () => action('notifications.swipeResolve')?.click());
    expect(api.post).toHaveBeenCalledWith('/comments/t1/resolve', {});
    expect(api.post).toHaveBeenCalledWith('/me/notifications/n/read', {});
    expect(host.textContent).toContain('notifications.resolvedDone');
    expect(action('notifications.swipeResolve')).toBeUndefined();
    await act(async () => vi.advanceTimersByTime(4000));
    expect(host.textContent).not.toContain('notifications.resolvedDone');
    await unmount();
  });
});

it('builds initials from the first two words, ignoring extra whitespace', () => {
  expect(initials('Giulia Bianchi')).toBe('GB');
  expect(initials('  Giulia   Bianchi ')).toBe('GB');
  expect(initials('Laura')).toBe('LA');
  expect(initials(null)).toBe('IN');
  expect(initials('')).toBe('IN');
  expect(initials('Carla (cliente)')).toBe('CC');
  expect(initials('(ospite)')).toBe('OS');
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
  // A phone's list keeps its own head with the count; on a desktop the navigation shows it.
  const media = window.matchMedia('(width < 768px)');
  Object.defineProperty(media, 'matches', { value: true });
  const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(media);
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
    matchMedia.mockRestore();
  }
});

it('walks the filter tabs with the keyboard and labels the list by the selected tab', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  vi.mocked(api.get).mockResolvedValue({ items: [], nextCursor: null });
  const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const selected = () => tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true');
  const press = (key: string) =>
    act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  const expectOn = (label: string) => {
    expect(selected().map((tab) => tab.textContent)).toEqual([label]);
    expect(document.activeElement).toBe(selected()[0]);
    // Roving tabindex: one tab stop, on the selected tab.
    expect(tabs().filter((tab) => tab.tabIndex === 0)).toEqual(selected());
    const panel = host.querySelector('[role="tabpanel"]');
    expect(panel?.getAttribute('aria-labelledby')).toBe(selected()[0]?.id);
    expect(selected()[0]?.getAttribute('aria-controls')).toBe(panel?.id);
  };
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
    tabs()[0]?.focus();
    expectOn('notifications.tabs.all');
    const focused = () => document.activeElement?.textContent;
    await press('ArrowRight');
    expect(focused()).toBe('notifications.tabs.mentions');
    await press('ArrowLeft');
    expect(focused()).toBe('notifications.tabs.all');
    await press('ArrowLeft');
    expect(focused()).toBe('notifications.tabs.tasks');
    await press('ArrowRight');
    expect(focused()).toBe('notifications.tabs.all');
    await press('Home');
    expect(focused()).toBe('notifications.tabs.all');
    await press('End');
    expect(focused()).toBe('notifications.tabs.tasks');
    // Walking the tabs chooses nothing, so it reads nothing.
    expect(selected().map((tab) => tab.textContent)).toEqual(['notifications.tabs.all']);
    expect(api.post).not.toHaveBeenCalled();
    // A button answers Enter and Space with a click.
    await act(async () => (document.activeElement as HTMLElement).click());
    expectOn('notifications.tabs.tasks');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('has no tabs and no tabpanel in the peek of the bell', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  vi.mocked(api.get).mockResolvedValue({ items: [], nextCursor: null });
  await act(async () =>
    root.render(
      <MemoryRouter>
        <NotificationList unread={0} onClose={vi.fn()} onNavigate={vi.fn()} onCount={vi.fn()} />
      </MemoryRouter>,
    ),
  );
  expect(host.querySelector('[role="tab"]')).toBeNull();
  expect(host.querySelector('[role="tabpanel"]')).toBeNull();
  await act(async () => root.unmount());
});

it('renders the two-pane view and opens and reads a notification only when it is clicked', async () => {
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
            mentions: [],
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
                mentions: [],
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

    // Nothing opens or is read by itself.
    expect(api.post).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-current="true"]')).toBeNull();
    expect(host.querySelector('.inbox-detail__empty')?.textContent).toBe(
      'notifications.detailEmptyTitlenotifications.detailEmptyHint',
    );

    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-notification-id="n-unread"]')?.click(),
    );
    expect(api.post).toHaveBeenCalledWith('/me/notifications/n-unread/read', {});
    expect(host.querySelector('.inbox-detail__empty')).toBeNull();
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

    // ArrowDown only moves the focus to the second item
    await act(async () => {
      host
        .querySelector('[data-notification-id="n1"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    await act(async () => vi.advanceTimersByTime(400));
    expect(api.post).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-current="true"]')).toBeNull();

    // Enter is the focused button's native click
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-notification-id="n2"]')?.click(),
    );
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
    mentions: [],
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
        mentions: [],
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

    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-notification-id="n1"]')?.click(),
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
    expect(second.getAttribute('aria-current')).toBeNull();
    await act(async () => second.click());
    expect(second.getAttribute('aria-current')).toBe('true');
    const detailAction = host.querySelector<HTMLButtonElement>('.inbox-detail__actions button')!;
    await act(async () => {
      detailAction.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('skips pathless items, focuses the first enabled item from the panel and reads nothing on the way', async () => {
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

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(second);
    await act(async () => vi.advanceTimersByTime(400));
    expect(api.post).not.toHaveBeenCalled();
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
        .find((button) => button.textContent === 'notifications.tabs.tasks')
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

it('reads nothing when the Inbox opens, then only the notification clicked', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const items = ['n1', 'n2', 'n3', 'n4'].map((id, i) => ({
    ...baseNotification,
    id,
    type: 'comment',
    readAt: null,
    createdAt: `2026-10-25T1${4 - i}:00:00Z`,
  }));
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
            unread={4}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onCount={vi.fn().mockResolvedValue(undefined)}
          />
        </MemoryRouter>,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(api.post).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.notification.is-unread')).toHaveLength(4);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-notification-id="n2"]')?.click(),
    );
    expect(vi.mocked(api.post).mock.calls).toEqual([['/me/notifications/n2/read', {}]]);
    expect(host.querySelectorAll('.notification.is-unread')).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
  }
});

it('puts Mark all as read over the list and stays open on a press outside, on a desktop', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onNavigate = vi.fn();
  vi.mocked(api.get).mockResolvedValue({
    items: [{ ...baseNotification, id: 'n1', type: 'comment', readAt: null }],
    nextCursor: null,
  });
  vi.mocked(api.post).mockResolvedValue({});
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={2}
            onClose={vi.fn()}
            onNavigate={onNavigate}
            onCount={vi.fn().mockResolvedValue(undefined)}
          />
        </MemoryRouter>,
      ),
    );
    expect(host.querySelector('.notifications__head')).toBeNull();
    // It heads the list it reads, on the line of the first day.
    const readAll = host.querySelector<HTMLButtonElement>('.notifications__day-head button');
    expect(readAll?.textContent).toBe('notifications.readAll');
    await act(async () => readAll?.click());
    expect(api.post).toHaveBeenCalledWith(
      '/me/notifications/read-all',
      expect.objectContaining({ before: expect.any(String) }),
    );
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onNavigate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('shows placeholder lines, not a word, while the detail loads', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  vi.mocked(api.get).mockImplementation((path: string) =>
    path.startsWith('/me/notifications')
      ? Promise.resolve({ items: [{ ...baseNotification, id: 'n1' }], nextCursor: null })
      : new Promise(() => {}),
  );
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
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-notification-id="n1"]')?.click(),
    );
    const status = host.querySelector('.inbox-detail__conversation [role="status"]');
    expect(status?.querySelectorAll('.ink-skeleton')).toHaveLength(3);
    expect(status?.querySelector('.ink-sr-only')?.textContent).toBe('comments.loading');
  } finally {
    await act(async () => root.unmount());
  }
});

describe('relativeTime', () => {
  afterEach(() => vi.useRealTimers());
  it('counts calendar days, as the day headings of the list', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 6, 17, 0));
    expect(relativeTime(new Date(2026, 10, 4, 22, 0).toISOString(), 'en')).toBe('2 days ago');
    expect(relativeTime(new Date(2026, 10, 5, 9, 0).toISOString(), 'en')).toBe('yesterday');
    expect(relativeTime(new Date(2026, 10, 6, 15, 0).toISOString(), 'en')).toBe('2 hr. ago');
  });
});

it('folds the in-app reports of a day into one row that unfolds (decision 0124)', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const report = (id: string, createdAt: string) => ({
    ...baseNotification,
    id,
    type: 'feedback_received',
    projectId: null,
    boardId: null,
    elementId: null,
    commentId: null,
    threadId: null,
    readAt: null,
    createdAt,
  });
  vi.mocked(api.get).mockResolvedValue({
    items: [
      report('r1', '2026-10-25T11:30:00Z'),
      { ...baseNotification, id: 'n1', type: 'comment' },
      report('r2', '2026-10-25T10:00:00Z'),
    ],
    nextCursor: null,
  });
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <NotificationList
            fixed
            unread={2}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onCount={vi.fn()}
          />
        </MemoryRouter>,
      ),
    );
    const folded = host.querySelector<HTMLButtonElement>('.notification--reports > button');
    expect(folded?.getAttribute('aria-expanded')).toBe('false');
    expect(folded?.textContent).toContain('notifications.reports');
    // Every notification stays: the reports are only out of sight.
    expect(host.querySelector('[data-notification-id="r1"]')).toBeNull();
    expect(host.querySelector('[data-notification-id="n1"]')).not.toBeNull();
    await act(async () => folded?.click());
    expect(folded?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-notification-id="r1"]')).not.toBeNull();
    expect(host.querySelector('[data-notification-id="r2"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
