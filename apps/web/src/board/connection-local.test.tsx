// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createElement, deleteElements } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { authApi, RequestError } from '../lib/api.ts';
import { signOut } from '../lib/sign-out.ts';
import { installWebLocks } from '../test/web-locks.ts';
import {
  type BoardConnection,
  cachedBoards,
  MERGE_TIMEOUT_MS,
  RESET_BACKOFF_MS,
  RESET_LIMIT,
  RESET_PAUSE_MS,
  RESET_REASON,
  RESET_WINDOW_MS,
  refusalStatus,
  useBoardConnection,
} from './connection.ts';
import {
  keepAside,
  keptBoards,
  RestoreError,
  sweepLocalBoards,
  unsavedLocalBoards,
} from './local-boards.ts';

/** The copy of a board on the device (#791): a reload, a second account, signing out. */
type Options = {
  document: Y.Doc;
  onAuthenticated: (event: { scope: string }) => void;
  onSynced: () => void;
  onDisconnect: () => void;
  onAuthenticationFailed: (event: { reason: string }) => void;
  onStateless: (event: { payload: string }) => void;
  onClose: (event: { event: { code: number; reason: string } }) => void;
};
type Provider = Options & {
  emit: (event: string, payload: unknown) => void;
  /** How often it signed in again over its socket. */
  reattached: () => number;
  /** The provider itself: updates it applies are the server's. */
  self: unknown;
};
const person = vi.hoisted(() => ({ id: 'person-a' }));
const providers = vi.hoisted(() => [] as Provider[]);
const me = vi.hoisted(() => ({ get: vi.fn(async () => ({})) }));
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api: me,
}));
// A full disk: setting refused edits aside fails.
const diskFull = vi.hoisted(() => ({ on: false }));
vi.mock('./local-boards.ts', async (original) => {
  const actual = await original<typeof import('./local-boards.ts')>();
  return {
    ...actual,
    keepAside: (...args: Parameters<typeof actual.keepAside>) =>
      diskFull.on ? Promise.reject(new Error('QuotaExceededError')) : actual.keepAside(...args),
  };
});
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ user: person }) }));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    document: Y.Doc;
    listeners = new Map<string, (payload: unknown) => void>();
    // What the provider says after sending an edit: the server has not confirmed it yet.
    hasUnsyncedChanges = true;
    attached = 0;
    configuration = { websocketProvider: { attach: () => this.attached++ } };
    constructor(options: Options) {
      this.document = options.document;
      providers.push({
        ...options,
        emit: (event, payload) => this.listeners.get(event)?.(payload),
        reattached: () => this.attached,
        self: this,
      });
    }
    on(event: string, listener: (payload: unknown) => void) {
      this.listeners.set(event, listener);
    }
    off() {}
    attach() {}
    destroy() {}
  },
  HocuspocusProviderWebsocket: class {
    destroy() {}
  },
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
installWebLocks();

let root: ReturnType<typeof createRoot> | undefined;
let connection: BoardConnection | null = null;
afterEach(async () => {
  await close();
  person.id = 'person-a';
  diskFull.on = false;
  vi.restoreAllMocks();
});
function Board({ id }: { id: string }) {
  connection = useBoardConnection(id, false);
  return null;
}
/** IndexedDB answers on later turns of the event loop. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));
async function open(id: string) {
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  await act(async () => root!.render(<Board id={id} />));
  await settle();
  return providers.at(-1)!;
}
async function close() {
  await act(async () => root?.unmount());
  root = undefined;
  await settle();
}
/** A new page: what the tab kept in memory is gone. */
async function reload() {
  await close();
  cachedBoards.clear();
}
const title = () => connection?.store.doc.getMap('meta').get('title');
/** An edit made while the server cannot be reached. */
async function editOffline(id: string, text: string) {
  const provider = await open(id);
  await act(async () => {
    provider.onAuthenticated({ scope: 'read-write' });
    provider.onDisconnect();
    connection!.store.doc.getMap('meta').set('title', text);
  });
  await settle();
}

it('brings back offline edits after a reload and lets them go once the server has them', async () => {
  await editOffline('trip', 'Written on the train');
  await reload();
  const provider = await open('trip');
  // The provider is given the document with them: its handshake sends them to the server.
  expect(provider.document.getMap('meta').get('title')).toBe('Written on the train');
  await act(async () => {
    provider.onSynced();
    provider.emit('unsyncedChanges', { number: 1 });
    provider.emit('unsyncedChanges', { number: 0 });
  });
  await settle();
  // Confirmed: the copy stays while a view may have it open, and goes at the next sweep.
  await reload();
  await sweepLocalBoards();
  await open('trip');
  expect(title()).toBeUndefined();
});

it('keeps the copy while the server has not confirmed it, across several reloads', async () => {
  await editOffline('tunnel', 'Still offline');
  await reload();
  await open('tunnel');
  await reload();
  await open('tunnel');
  expect(title()).toBe('Still offline');
});

it("never shows one person's copy to another account on the same browser", async () => {
  await editOffline('shared-laptop', 'Private notes');
  await reload();
  person.id = 'person-b';
  await open('shared-laptop');
  expect(title()).toBeUndefined();
  await reload();
  person.id = 'person-a';
  await open('shared-laptop');
  expect(title()).toBe('Private notes');
});

it("deletes the person's copies when they sign out", async () => {
  await editOffline('signed-out', 'Left behind');
  await reload();
  vi.spyOn(authApi, 'signOut').mockResolvedValueOnce(null);
  const reloadPage = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  await signOut(person.id);
  expect(reloadPage).toHaveBeenCalledOnce();
  await open('signed-out');
  expect(title()).toBeUndefined();
});

it('deletes the copy of a board the person can no longer open', async () => {
  await editOffline('revoked', 'No longer mine');
  await reload();
  const provider = await open('revoked');
  expect(title()).toBe('No longer mine');
  await act(async () => provider.onAuthenticationFailed({ reason: 'Forbidden' }));
  expect(connection?.status).toBe('denied');
  await settle();
  await reload();
  await open('revoked');
  expect(title()).toBeUndefined();
  // Its unsaved edits were set aside first: the board may be in the trash and come back.
  expect(await keptBoards(person.id)).toContain('revoked');
  expect(connection?.kept).toBeTruthy();
});

it('deletes the copy of a lost board at once when nothing in it is unsaved', async () => {
  const provider = await open('revoked-clean');
  await act(async () => {
    provider.onAuthenticated({ scope: 'read-write' });
    provider.onSynced();
  });
  await settle();
  await act(async () => provider.onAuthenticationFailed({ reason: 'Forbidden' }));
  await settle();
  expect(await keptBoards(person.id)).not.toContain('revoked-clean');
});

it('keeps the copy when the refusal does not say the access is lost', async () => {
  await editOffline('flaky-auth', 'Kept through a refusal');
  await reload();
  // The collab server's generic refusal (a database error, say), and the account still works.
  const provider = await open('flaky-auth');
  await act(async () => provider.onAuthenticationFailed({ reason: 'permission-denied' }));
  await settle();
  expect(connection?.status).toBe('denied');
  await reload();
  await sweepLocalBoards();
  await open('flaky-auth');
  expect(title()).toBe('Kept through a refusal');
});

it('keeps edits a read-only connection was answered without applying', async () => {
  const provider = await open('read-only');
  await act(async () => {
    provider.onAuthenticated({ scope: 'readonly' });
    provider.onSynced();
    connection!.store.doc.getMap('meta').set('title', 'Typed as the role changed');
    provider.emit('unsyncedChanges', { number: 1 });
    provider.emit('unsyncedChanges', { number: 0 });
  });
  await settle();
  await reload();
  await sweepLocalBoards();
  await open('read-only');
  expect(title()).toBe('Typed as the role changed');
});

it('sets edits refused at the size limit aside and says so', async () => {
  await editOffline('too-big', 'Does not fit');
  await reload();
  const provider = await open('too-big');
  await act(async () =>
    provider.onStateless({ payload: JSON.stringify({ type: 'writeRefused', reason: 'frozen' }) }),
  );
  await settle();
  // Reopened from what the server confirmed, with the person told the edits are on the device.
  expect(providers.at(-1)).not.toBe(provider);
  expect(title()).toBeUndefined();
  expect(connection?.kept).toBeTruthy();
  expect(await unsavedLocalBoards(person.id)).toContain('too-big');
  // Discarded: it no longer counts, and the notice goes.
  await act(async () => connection!.kept!.discard());
  expect(connection?.kept).toBeNull();
  expect(await unsavedLocalBoards(person.id)).not.toContain('too-big');
});

it('keeps the copy when refused edits cannot be set aside, without reopening into them', async () => {
  await editOffline('too-big-full', 'Does not fit either');
  await reload();
  const provider = await open('too-big-full');
  diskFull.on = true;
  await act(async () =>
    provider.onStateless({ payload: JSON.stringify({ type: 'writeRefused', reason: 'frozen' }) }),
  );
  await settle();
  // Reopened once, from the server: the copy is not merged again, so no refusal loop.
  const reopened = providers.at(-1)!;
  expect(reopened).not.toBe(provider);
  expect(title()).toBeUndefined();
  await settle();
  expect(providers.at(-1)).toBe(reopened);
  expect(connection?.kept).toBeFalsy();
  // Still on the device, still unsaved: signing out asks first.
  await reload();
  await sweepLocalBoards();
  expect(await unsavedLocalBoards(person.id)).toContain('too-big-full');
});

it('keeps the copy when the server fails rather than refuses', async () => {
  me.get.mockRejectedValueOnce(new RequestError(503, 'unavailable', 'Down'));
  expect(await refusalStatus()).toBe('offline');
  me.get.mockRejectedValueOnce(new RequestError(403, 'forbidden', 'No'));
  expect(await refusalStatus()).toBe('denied');
});

/** Edits the server refused earlier, set aside on the device, then a board that takes them. */
async function openWithKept(id: string, title: string) {
  const aside = new Y.Doc();
  aside.getMap('meta').set('title', title);
  await keepAside(person.id, id, aside);
  const provider = await open(id);
  await act(async () => {
    provider.onAuthenticated({ scope: 'read-write' });
    provider.onSynced();
  });
  await settle();
  expect(connection?.kept).toBeTruthy();
  return provider;
}

it('merges edits set aside into the board, deleting them once the server confirms (#898)', async () => {
  const provider = await openWithKept('back', 'Restored from the trash');
  let restored = false;
  let restoring: Promise<void> = Promise.resolve();
  await act(async () => {
    restoring = connection!.kept!.restore().then(() => {
      restored = true;
    });
  });
  await settle();
  expect(title()).toBe('Restored from the trash');
  // Sent, not confirmed: still set aside.
  expect(restored).toBe(false);
  expect(await keptBoards(person.id)).toContain('back');
  await act(async () => provider.emit('unsyncedChanges', { number: 0 }));
  await act(async () => restoring);
  await settle();
  expect(restored).toBe(true);
  expect(await keptBoards(person.id)).not.toContain('back');
  expect(connection?.kept).toBeNull();
});

it('keeps edits set aside when the server refuses them again, or cannot take them (#898)', async () => {
  const provider = await openWithKept('still-full', 'Still too big');
  let error: unknown;
  let restoring: Promise<void> = Promise.resolve();
  await act(async () => {
    restoring = connection!.kept!.restore().catch((err) => {
      error = err;
    });
  });
  await settle();
  await act(async () =>
    provider.onStateless({ payload: JSON.stringify({ type: 'writeRefused', reason: 'frozen' }) }),
  );
  await act(async () => restoring);
  await settle();
  expect(error).toBeInstanceOf(RestoreError);
  expect((error as RestoreError).reason).toBe('refused');
  expect(await keptBoards(person.id)).toContain('still-full');
  expect(connection?.kept).toBeTruthy();
  // Offline: nothing is merged, and they stay.
  const reopened = providers.at(-1)!;
  await act(async () => reopened.onDisconnect());
  await act(async () => {
    restoring = connection!.kept!.restore().catch((err) => {
      error = err;
    });
  });
  await act(async () => restoring);
  expect((error as RestoreError).reason).toBe('notWritable');
  expect(await keptBoards(person.id)).toContain('still-full');
});

it('keeps edits set aside that merging would lose, and restores them as new cards (#898)', async () => {
  const base = createBoardDoc('lost-card');
  const note = createElement(base, 'note', { x: 0, y: 0 }, {}, { userId: 'someone' });
  const aside = new Y.Doc();
  Y.applyUpdate(aside, Y.encodeStateAsUpdate(base));
  aside.getMap<Y.Map<unknown>>('elements').get(note.id)?.set('x', 120);
  await keepAside(person.id, 'lost-card', aside);
  const provider = await open('lost-card');
  await act(async () => {
    // The board as the server has it: the card was deleted since, to make room.
    Y.applyUpdate(provider.document, Y.encodeStateAsUpdate(base), provider);
    deleteElements(provider.document, [note.id], provider);
    provider.onAuthenticated({ scope: 'read-write' });
    provider.onSynced();
  });
  await settle();
  let error: unknown;
  await act(async () => {
    await connection!.kept!.restore().catch((err) => {
      error = err;
    });
  });
  // Nothing merged, nothing discarded: the person is told what would be lost.
  expect((error as RestoreError).reason).toBe('conflict');
  expect((error as RestoreError).conflict?.deleted).toEqual([note.id]);
  expect(provider.document.getMap('elements').size).toBe(0);
  expect(await keptBoards(person.id)).toContain('lost-card');
  let restoring: Promise<void> = Promise.resolve();
  await act(async () => {
    restoring = connection!.kept!.restore([note.id]);
  });
  await settle();
  const cards = [...provider.document.getMap<Y.Map<unknown>>('elements').values()];
  expect(cards.map((card) => [card.get('id') === note.id, card.get('x')])).toEqual([[false, 120]]);
  expect(await keptBoards(person.id)).toContain('lost-card');
  await act(async () => provider.emit('unsyncedChanges', { number: 0 }));
  await act(async () => restoring);
  await settle();
  expect(await keptBoards(person.id)).not.toContain('lost-card');
});

it('stops waiting for a merge the server never answers, and keeps the edits (#898)', async () => {
  await openWithKept('silent', 'Never answered');
  const timers = vi.spyOn(globalThis, 'setTimeout');
  let error: unknown;
  let restoring: Promise<void> = Promise.resolve();
  await act(async () => {
    restoring = connection!.kept!.restore().catch((err) => {
      error = err;
    });
  });
  await settle();
  const wait = timers.mock.calls.find(([, ms]) => ms === MERGE_TIMEOUT_MS);
  const giveUp = wait?.[0] as (() => void) | undefined;
  expect(giveUp).toBeDefined();
  await act(async () => giveUp?.());
  await act(async () => restoring);
  expect((error as RestoreError).reason).toBe('refused');
  expect(await keptBoards(person.id)).toContain('silent');
  expect(connection?.kept).toBeTruthy();
});

/** An edit on a synced board that the server has not confirmed yet. */
async function editSynced(id: string, text: string) {
  const provider = await open(id);
  await act(async () => {
    provider.onAuthenticated({ scope: 'read-write' });
    provider.onSynced();
    connection!.store.doc.getMap('meta').set('title', text);
    provider.emit('unsyncedChanges', { number: 1 });
  });
  await settle();
  return provider;
}
const resetBy = (provider: Provider, code = 1000) =>
  act(async () => provider.onClose({ event: { code, reason: RESET_REASON } }));
/** Past the wait before the `attempt`th retry. */
const retryWait = (attempt: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, RESET_BACKOFF_MS * attempt + 30)));

it('says a board went to the trash while open and sets its unsaved edits aside (#951)', async () => {
  const provider = await editSynced('trashed', 'Typed as it went');
  await act(async () =>
    provider.onStateless({ payload: JSON.stringify({ type: 'boardGone', reason: 'trash' }) }),
  );
  await settle();
  expect(connection?.status).toBe('denied');
  expect(connection?.gone).toBe('trash');
  expect(connection?.kept).toBeTruthy();
  // The close that follows changes nothing.
  await act(async () => provider.onClose({ event: { code: 1000, reason: 'Forbidden' } }));
  expect(connection?.gone).toBe('trash');
});

it('syncs again after a reset, and sets the edits aside once resets repeat', async () => {
  const now = vi.spyOn(Date, 'now');
  let clock = 1_000_000;
  now.mockImplementation(() => clock);
  const provider = await editSynced('reset', 'Refused each time');
  // A socket closing with the same reason reconnects on its own: not a refusal.
  await resetBy(provider, 4205);
  expect(provider.reattached()).toBe(0);
  for (let attempt = 1; attempt < RESET_LIMIT; attempt++) {
    await resetBy(provider);
    // Not at once: a short blip would use up every attempt.
    expect(provider.reattached()).toBe(attempt - 1);
    expect(connection?.status).toBe('connecting');
    expect(connection?.retrying).toBe(true);
    await retryWait(attempt);
    expect(provider.reattached()).toBe(attempt);
    // The handshake counts back to zero before the server refuses the edit again.
    await act(async () => {
      provider.onSynced();
      provider.emit('unsyncedChanges', { number: 0 });
    });
    clock += 1000;
  }
  expect(connection?.status).toBe('synced');
  expect(connection?.retrying).toBe(false);
  expect(providers.at(-1)).toBe(provider);
  await resetBy(provider);
  await settle();
  // Reopened from the server, the edits set aside with the notice for them.
  expect(providers.at(-1)).not.toBe(provider);
  expect(title()).toBeUndefined();
  expect(connection?.kept).toBeTruthy();
  expect(connection?.updateRefused).toBe(true);
  await act(async () => connection!.kept!.discard());
  expect(connection?.updateRefused).toBe(false);
});

it('counts only the resets of the last minute', async () => {
  const now = vi.spyOn(Date, 'now');
  let clock = 5_000_000;
  now.mockImplementation(() => clock);
  const provider = await editSynced('slow-resets', 'Now and then');
  for (let i = 0; i < RESET_LIMIT + 1; i++) {
    await resetBy(provider);
    // Two in the window at most: the second attempt's wait.
    await retryWait(2);
    clock += RESET_WINDOW_MS / 2 + 1;
  }
  expect(providers.at(-1)).toBe(provider);
  expect(provider.reattached()).toBe(RESET_LIMIT + 1);
});

/** A board as the server has it, with a title. */
async function openFromServer(id: string, serverTitle: string) {
  const server = new Y.Doc();
  server.getMap('meta').set('title', serverTitle);
  const state = Y.encodeStateAsUpdate(server);
  const provider = await open(id);
  await act(async () => {
    provider.onAuthenticated({ scope: 'read-write' });
    Y.applyUpdate(provider.document, state, provider.self);
    provider.onSynced();
  });
  await settle();
  return { provider, state };
}

it('reloads a board reset again and again from the server with its values intact', async () => {
  const { provider, state } = await openFromServer('reset-key', 'Original');
  await act(async () => {
    connection!.store.doc.getMap('meta').set('title', 'Changed here');
    provider.emit('unsyncedChanges', { number: 1 });
  });
  for (let i = 0; i < RESET_LIMIT; i++) await resetBy(provider);
  await settle();
  const reopened = providers.at(-1)!;
  expect(reopened).not.toBe(provider);
  await act(async () => {
    reopened.onAuthenticated({ scope: 'read-write' });
    Y.applyUpdate(reopened.document, state, reopened.self);
    reopened.onSynced();
  });
  await settle();
  // The refused change of the title is set aside; the server's title stays.
  expect(title()).toBe('Original');
  expect(connection?.kept).toBeTruthy();

  // Reset again with nothing unconfirmed: no reload loop, the board waits offline.
  for (let i = 1; i <= RESET_LIMIT; i++) {
    await resetBy(reopened);
    if (i < RESET_LIMIT) await retryWait(i);
  }
  await settle();
  expect(providers.at(-1)).toBe(reopened);
  expect(reopened.reattached()).toBe(RESET_LIMIT - 1);
  expect(connection?.status).toBe('offline');
  expect(connection?.retrying).toBe(false);
});

it('does not reload a board reset again and again without unconfirmed edits', async () => {
  const { provider } = await openFromServer('reset-clean', 'Server title');
  for (let i = 0; i < RESET_LIMIT; i++) await resetBy(provider);
  await settle();
  expect(providers.at(-1)).toBe(provider);
  expect(connection?.status).toBe('offline');
  expect(connection?.kept).toBeFalsy();
  expect(connection?.updateRefused).toBeFalsy();
  expect(title()).toBe('Server title');
});

it('counts a merge of set-aside edits refused when the server resets the board', async () => {
  const { provider } = await openFromServer('reset-merge', 'Merged into');
  const other = new Y.Doc();
  other.getMap('meta').set('subtitle', 'From the device');
  let merging!: Promise<void>;
  await act(async () => {
    merging = connection!.merge!(Y.encodeStateAsUpdate(other));
  });
  const outcome = merging.then(
    () => 'resolved',
    (err: { reason?: string }) => err.reason,
  );
  await resetBy(provider);
  // The retry's handshake counts back to zero: that is not the server taking the merge.
  await act(async () => {
    provider.onSynced();
    provider.emit('unsyncedChanges', { number: 0 });
  });
  expect(await outcome).toBe('refused');
});

it('stays gone when the socket of a deleted board syncs again (#951)', async () => {
  const { provider } = await openFromServer('gone-sync', 'Gone');
  await act(async () =>
    provider.onStateless({ payload: JSON.stringify({ type: 'boardGone', reason: 'deleted' }) }),
  );
  await act(async () => provider.onSynced());
  expect(connection?.status).toBe('denied');
  expect(connection?.gone).toBe('deleted');
});

it('waits offline after resets without edits, then tries again on its own or when back online', async () => {
  const { provider } = await openFromServer('reset-pause', 'Paused');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const run = async () => {
      for (let i = 1; i <= RESET_LIMIT; i++) {
        await resetBy(provider);
        if (i < RESET_LIMIT) await act(async () => vi.advanceTimersByTime(RESET_BACKOFF_MS * i));
      }
    };
    await run();
    expect(connection?.status).toBe('offline');
    const before = provider.reattached();
    // The socket stays open, so nothing else would bring the board back.
    await act(async () => vi.advanceTimersByTime(RESET_PAUSE_MS));
    expect(provider.reattached()).toBe(before + 1);
    expect(connection?.status).toBe('connecting');
    // A fresh count: the next reset is retried, not the end of the run.
    await resetBy(provider);
    expect(connection?.retrying).toBe(true);
    await act(async () => vi.advanceTimersByTime(RESET_BACKOFF_MS));
    await act(async () => {
      provider.onSynced();
    });
    // A minute later, a new run of resets.
    await act(async () => vi.advanceTimersByTime(RESET_WINDOW_MS));
    await run();
    expect(connection?.status).toBe('offline');
    const paused = provider.reattached();
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(provider.reattached()).toBe(paused + 1);
  } finally {
    vi.useRealTimers();
  }
});

it('forgets an edit reset long ago once it was saved', async () => {
  const now = vi.spyOn(Date, 'now');
  let clock = 9_000_000;
  now.mockImplementation(() => clock);
  const { provider } = await openFromServer('reset-latch', 'Saved long ago');
  await act(async () => {
    connection!.store.doc.getMap('meta').set('title', 'Edited once');
    provider.emit('unsyncedChanges', { number: 1 });
  });
  await resetBy(provider);
  await retryWait(1);
  // The retry took it: saved.
  await act(async () => {
    provider.onSynced();
    provider.emit('unsyncedChanges', { number: 0 });
  });
  clock += RESET_WINDOW_MS * 60;
  for (let i = 1; i <= RESET_LIMIT; i++) {
    await resetBy(provider);
    if (i < RESET_LIMIT) await retryWait(i);
  }
  await settle();
  expect(providers.at(-1)).toBe(provider);
  expect(connection?.kept).toBeFalsy();
  expect(connection?.status).toBe('offline');
});

it('stays signed out when a reset follows the end of the session', async () => {
  const { provider } = await openFromServer('reset-signed-out', 'Signed out');
  await act(async () => provider.onClose({ event: { code: 1000, reason: 'Unauthorized' } }));
  for (let i = 0; i < RESET_LIMIT; i++) await resetBy(provider);
  expect(connection?.status).toBe('signedOut');
  expect(provider.reattached()).toBe(0);
});

it('stops retrying as soon as the connection is no longer connecting', async () => {
  const { provider } = await openFromServer('reset-drop', 'Dropped');
  await resetBy(provider);
  expect(connection?.retrying).toBe(true);
  await act(async () => provider.onDisconnect());
  expect(connection?.status).toBe('offline');
  expect(connection?.retrying).toBe(false);
  // The dropped socket reconnects on its own: the pending retry does not attach as well.
  await retryWait(1);
  expect(provider.reattached()).toBe(0);
});

it('keeps saying a board went whatever the connection says after (#951)', async () => {
  const { provider } = await openFromServer('gone-after', 'Gone');
  await act(async () =>
    provider.onStateless({ payload: JSON.stringify({ type: 'boardGone', reason: 'trash' }) }),
  );
  await act(async () => provider.onAuthenticationFailed({ reason: 'Unauthorized' }));
  await act(async () =>
    provider.onStateless({ payload: JSON.stringify({ type: 'access', readOnly: true }) }),
  );
  expect(connection?.status).toBe('denied');
  expect(connection?.gone).toBe('trash');
});
