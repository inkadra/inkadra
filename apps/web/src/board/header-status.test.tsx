import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createSaveStore } from './connection.ts';
import {
  boardPeople,
  connectionAnnouncement,
  EditingLine,
  editingPeople,
  onlineCount,
  SyncStatus,
  syncSummary,
} from './header-status.tsx';
import type { Peer } from './presence.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}(${Object.entries(values)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')})`
        : key,
  }),
}));

const peer = (id: string, name: string, editing: string | null = null, readOnly = false): Peer => ({
  clientId: 1,
  color: 'var(--ink-tag-blue)',
  user: { id, name, image: null },
  readOnly,
  cursor: null,
  selection: [],
  editing,
});

const storeOf = (pending: number, savedAt: number | null) => {
  const store = createSaveStore();
  store.set({ pending, savedAt });
  return store;
};

describe('sync summary', () => {
  it('says when the last change was saved', () => {
    const now = 1_000_000;
    expect(
      syncSummary({ status: 'synced', readOnly: false, pending: 0, savedAt: now - 12_000 }, now),
    ).toEqual({ kind: 'saved', seconds: 12 });
  });

  it('says it is saving while the server has not confirmed', () => {
    expect(
      syncSummary({ status: 'synced', readOnly: false, pending: 3, savedAt: 10 }, 20_000),
    ).toEqual({ kind: 'saving' });
  });

  it('is saved with no timer before the first change of the session', () => {
    expect(
      syncSummary({ status: 'synced', readOnly: false, pending: 0, savedAt: null }, 20_000),
    ).toEqual({ kind: 'saved', seconds: null });
  });

  it('never counts back from a clock that is behind', () => {
    expect(
      syncSummary({ status: 'synced', readOnly: false, pending: 0, savedAt: 30_000 }, 20_000),
    ).toEqual({ kind: 'saved', seconds: 0 });
  });

  it('reports the connection when it is not synced, and read-only before anything', () => {
    expect(syncSummary({ status: 'offline', readOnly: false, pending: 2, savedAt: 1 }, 2)).toEqual({
      kind: 'offline',
    });
    expect(
      syncSummary({ status: 'connecting', readOnly: false, pending: 0, savedAt: null }, 2),
    ).toEqual({ kind: 'connecting' });
    expect(
      syncSummary({ status: 'synced', readOnly: true, pending: 0, savedAt: 5 }, 9_000),
    ).toEqual({
      kind: 'readOnly',
    });
  });
});

describe('people on the board', () => {
  it('counts each person once, this tab included', () => {
    expect(onlineCount([], 'me')).toBe(1);
    expect(onlineCount([peer('a', 'Giulia'), peer('a', 'Giulia'), peer('b', 'Anna')], 'me')).toBe(
      3,
    );
  });

  it('counts the other tabs of this account as this person', () => {
    expect(onlineCount([peer('me', 'Matteo')], 'me')).toBe(1);
    expect(onlineCount([peer('me', 'Matteo'), peer('me', 'Matteo', 'note-1')], 'me')).toBe(1);
    expect(onlineCount([peer('me', 'Matteo'), peer('a', 'Giulia')], 'me')).toBe(2);
  });

  it('still counts this tab before the account is known', () => {
    expect(onlineCount([], null)).toBe(1);
    expect(onlineCount([peer('a', 'Giulia'), peer('a', 'Giulia')], null)).toBe(2);
  });

  it('shows who writes in a card even when their first tab is idle', () => {
    const label = (id: string) => `card:${id}`;
    // Giulia has an idle tab and one writing in a note; Anna only views.
    const tabs = [
      { ...peer('a', 'Giulia'), clientId: 1 },
      { ...peer('a', 'Giulia', 'note-1'), clientId: 2 },
      { ...peer('b', 'Anna', null, true), clientId: 3 },
    ];
    const { people, online, writing } = boardPeople(tabs, 'me');
    expect(online).toBe(3);
    expect(people.map((p) => p.user.id)).toEqual(['a', 'b']);
    expect(editingPeople(writing, label)).toEqual([
      { id: 'a', name: 'Giulia', label: 'card:note-1', color: 'var(--ink-tag-blue)' },
    ]);
  });

  it('names one card per person when they write in several tabs', () => {
    const label = (id: string) => `card:${id}`;
    const tabs = [
      { ...peer('me', 'Matteo'), clientId: 1 },
      { ...peer('me', 'Matteo', 'frame-2'), clientId: 2 },
      { ...peer('a', 'Giulia', 'note-1'), clientId: 3 },
      { ...peer('a', 'Giulia', 'note-2'), clientId: 4 },
    ];
    const { online, writing } = boardPeople(tabs, 'me');
    expect(online).toBe(2);
    expect(editingPeople(writing, label)).toEqual([
      { id: 'a', name: 'Giulia', label: 'card:note-1', color: 'var(--ink-tag-blue)' },
      { id: 'me', name: 'Matteo', label: 'card:frame-2', color: 'var(--ink-tag-blue)' },
    ]);
  });

  it('tells who is writing in which card, one line per person', () => {
    const label = (id: string) => `card:${id}`;
    const people = [
      peer('b', 'Anna', 'frame-1'),
      peer('a', 'Giulia', 'note-1'),
      peer('c', 'Marco', null),
    ];
    expect(editingPeople(people, label)).toEqual([
      { id: 'b', name: 'Anna', label: 'card:frame-1', color: 'var(--ink-tag-blue)' },
      { id: 'a', name: 'Giulia', label: 'card:note-1', color: 'var(--ink-tag-blue)' },
    ]);
    expect(editingPeople([peer('a', 'Giulia'), peer('b', 'Anna', null)], label)).toEqual([]);
  });
});

describe('header status', () => {
  it('shows the online count next to what the connection is doing', () => {
    const html = renderToStaticMarkup(
      <SyncStatus
        status="synced"
        readOnly={false}
        saves={storeOf(0, Date.now() - 12_000)}
        online={3}
      />,
    );
    expect(html).toContain('board.status.online(count=3)');
    expect(html).toContain('board.status.savedAgo(count=12)');
    expect(html).toContain('sync--synced');
  });

  it('says saving, and reads as saved right after a change', () => {
    const saving = renderToStaticMarkup(
      <SyncStatus status="synced" readOnly={false} saves={storeOf(2, null)} online={2} />,
    );
    expect(saving).toContain('board.status.saving');
    expect(saving).toContain('sync--saving');

    const fresh = renderToStaticMarkup(
      <SyncStatus status="synced" readOnly={false} saves={storeOf(0, Date.now())} online={2} />,
    );
    expect(fresh).toContain('board.status.saved');
  });

  it('says who is online only while presence is live', () => {
    const html = renderToStaticMarkup(
      <SyncStatus status="offline" readOnly={false} saves={storeOf(1, null)} online={4} />,
    );
    expect(html).toContain('board.status.offline');
    expect(html).not.toContain('board.status.online');
  });

  it('names the card someone has open, and counts the others', () => {
    const editors = [
      { id: 'a', name: 'Giulia', label: 'Logline', color: 'var(--ink-tag-blue)' },
      { id: 'b', name: 'Anna', label: 'Script', color: 'var(--ink-tag-orange)' },
    ];
    const html = renderToStaticMarkup(<EditingLine editors={editors} />);
    expect(html).toContain('board.editing.one(name=Giulia,label=Logline)');
    expect(html).toContain('board.editing.more(count=1)');
    expect(html).toContain('title="board.editing.one(name=Giulia,label=Logline)');
    expect(html).toContain('board.editing.one(name=Anna,label=Script)');
    expect(renderToStaticMarkup(<EditingLine editors={[]} />)).toBe('');
  });
});

describe('sync announcements', () => {
  const t = (key: string) => key;

  it('speaks only when the connection changes', () => {
    expect(connectionAnnouncement('synced', 'offline', t)).toBe('board.status.offline');
    expect(connectionAnnouncement('offline', 'synced', t)).toBe('board.status.backOnline');
    expect(connectionAnnouncement('synced', 'denied', t)).toBe('board.status.denied');
    expect(connectionAnnouncement('synced', 'synced', t)).toBe('');
  });

  it('keeps the visible state quiet and announces nothing while saving', () => {
    const html = renderToStaticMarkup(
      <SyncStatus status="synced" readOnly={false} saves={storeOf(2, null)} online={2} />,
    );
    expect(html).toMatch(/role="status" aria-live="off"/);
    expect(html).toMatch(/<span class="sync__announce" aria-live="polite"><\/span>/);
  });
});
