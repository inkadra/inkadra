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
  RESET_RESUME_MS,
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
  onClose: (event: { event: { code: number; reason: string; wasClean?: boolean } }) => void;
};
type Provider = Options & {
  emit: (event: string, payload: unknown) => void;
  /** How often it signed in again over its socket. */
  reattached: () => number;
  /** Whether its socket routes the document's messages, both ways. */
  attached: () => boolean;
  /** Edits it sent to the server as they were made, not with a sign-in's handshake. */
  sent: () => number;
  /** How often it told the server the document is left. */
  closesSent: () => number;
  /** The server confirms the last change: as Hocuspocus 4.8 counts back to zero. */
  confirm: () => void;
  /** The server's sync step 2 of a sign-in's handshake. */
  handshake: () => void;
  /** The server closes the document, keeping the socket. */
  closeDocument: (reason: string) => void;
  /** The socket itself closes (it reconnects on its own). */
  closeSocket: (code: number, reason?: string) => void;
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
/**
 * As Hocuspocus 4.8 does: a provider sends only while attached, and its socket's map lists it;
 * `synced` emits on its change to true, and a count back to zero sets it before it is emitted.
 */
vi.mock('@hocuspocus/provider', () => {
  class Socket {
    configuration = { providerMap: new Map<string, unknown>() };
    destroy() {}
  }
  return {
    HocuspocusProvider: class {
      document: Y.Doc;
      options: Options & { name: string };
      listeners = new Map<string, (payload: unknown) => void>();
      // What the provider says after sending an edit: the server has not confirmed it yet.
      hasUnsyncedChanges = true;
      effectiveName: string;
      isAttached: boolean;
      isSynced = false;
      attaches = 0;
      sent = 0;
      closes = 0;
      configuration: { websocketProvider: Socket };
      constructor(options: Options & { name: string; websocketProvider?: Socket }) {
        this.options = options;
        this.document = options.document;
        this.effectiveName = options.name;
        // Its own socket attaches it at once; a shared one when it is told to.
        this.isAttached = !options.websocketProvider;
        this.configuration = { websocketProvider: options.websocketProvider ?? new Socket() };
        if (this.isAttached) this.providerMap.set(this.effectiveName, this);
        this.document.on('update', (_update: Uint8Array, origin: unknown) => {
          if (origin !== this && this.isAttached) this.sent++;
        });
        const emit = (event: string, payload: unknown) => this.listeners.get(event)?.(payload);
        providers.push({
          ...options,
          emit,
          reattached: () => this.attaches,
          attached: () => this.isAttached,
          sent: () => this.sent,
          closesSent: () => this.closes,
          // `decrementUnsyncedChanges`: synced first, then the count.
          confirm: () => {
            this.synced = true;
            emit('unsyncedChanges', { number: 0 });
          },
          // The server's sync step 2: the provider hears the message, then applies it.
          handshake: () => {
            const parts = [0, 1];
            emit('message', {
              message: {
                readVarString: () => this.effectiveName,
                readVarUint: () => parts.shift(),
              },
            });
            this.synced = true;
          },
          closeDocument: (reason) => {
            this.isSynced = false;
            options.onClose({ event: { code: 1000, reason } });
          },
          closeSocket: (code, reason = '') => {
            this.isSynced = false;
            options.onDisconnect();
            options.onClose({ event: { code, reason, wasClean: true } });
          },
          self: this,
        });
      }
      get providerMap() {
        return this.configuration.websocketProvider.configuration.providerMap;
      }
      get synced() {
        return this.isSynced;
      }
      set synced(state: boolean) {
        if (this.isSynced === state) return;
        this.isSynced = state;
        if (state) this.options.onSynced();
      }
      on(event: string, listener: (payload: unknown) => void) {
        this.listeners.set(event, listener);
      }
      off() {}
      attach() {
        if (this.isAttached) return;
        this.isAttached = true;
        this.attaches++;
        this.providerMap.set(this.effectiveName, this);
      }
      detach() {
        // The socket tells the server the document is left while its map lists it.
        if (this.providerMap.has(this.effectiveName)) this.closes++;
        this.providerMap.delete(this.effectiveName);
        this.isAttached = false;
      }
      destroy() {
        this.detach();
      }
    },
    HocuspocusProviderWebsocket: Socket,
    MessageType: { Sync: 0 },
  };
});
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
const resetBy = (provider: Provider) => act(async () => provider.closeDocument(RESET_REASON));
/** Past the longest wait before the `attempt`th retry: up to twice its base, spread at random. */
const retryWait = (attempt: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, 2 * RESET_BACKOFF_MS * attempt + 30)));

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
  await act(async () => provider.closeSocket(4205, RESET_REASON));
  expect(provider.reattached()).toBe(0);
  for (let attempt = 1; attempt < RESET_LIMIT; attempt++) {
    await resetBy(provider);
    // Not at once: a short blip would use up every attempt.
    expect(provider.reattached()).toBe(attempt - 1);
    expect(connection?.status).toBe('connecting');
    expect(connection?.retrying).toBe(true);
    await retryWait(attempt);
    expect(provider.reattached()).toBe(attempt);
    // Signed in again: synced, then the server refuses the edit the handshake carries.
    await act(async () => provider.handshake());
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
        if (i < RESET_LIMIT)
          await act(async () => vi.advanceTimersByTime(2 * RESET_BACKOFF_MS * i));
      }
    };
    await run();
    expect(connection?.status).toBe('offline');
    const before = provider.reattached();
    // The socket stays open, so nothing else would bring the board back.
    await act(async () => vi.advanceTimersByTime(2 * RESET_PAUSE_MS));
    expect(provider.reattached()).toBe(before + 1);
    expect(connection?.status).toBe('connecting');
    // A fresh count: the next reset is retried, not the end of the run.
    await resetBy(provider);
    expect(connection?.retrying).toBe(true);
    await act(async () => vi.advanceTimersByTime(2 * RESET_BACKOFF_MS));
    await act(async () => provider.handshake());
    // A minute later, a new run of resets.
    await act(async () => vi.advanceTimersByTime(RESET_WINDOW_MS));
    await run();
    expect(connection?.status).toBe('offline');
    const paused = provider.reattached();
    await act(async () => vi.advanceTimersByTime(RESET_RESUME_MS));
    await act(async () => window.dispatchEvent(new Event('online')));
    await act(async () => vi.advanceTimersByTime(2 * RESET_BACKOFF_MS));
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
    provider.handshake();
    provider.confirm();
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

it('leaves a socket that drops while signing in again to sign the board in on its return', async () => {
  const { provider } = await openFromServer('reset-drop', 'Dropped');
  await resetBy(provider);
  await retryWait(1);
  expect(provider.reattached()).toBe(1);
  expect(connection?.retrying).toBe(true);
  await act(async () => provider.onDisconnect());
  expect(connection?.status).toBe('offline');
  expect(connection?.retrying).toBe(false);
  // Attached again: the socket's own reconnection signs it in, nothing else attaches it.
  await retryWait(2);
  expect(provider.reattached()).toBe(1);
  expect(provider.attached()).toBe(true);
});

it('tells the server nothing more about a board it closed, so a later visit is not closed (#951)', async () => {
  const { provider } = await openFromServer('closed-by-server', 'Closed');
  await act(async () =>
    provider.onStateless({ payload: JSON.stringify({ type: 'boardGone', reason: 'trash' }) }),
  );
  await act(async () => provider.onClose({ event: { code: 1000, reason: 'Forbidden' } }));
  await close();
  // A close the server queues for a document it no longer has is replayed on the next sign-in
  // of that board on a shared socket, and closes it.
  expect(provider.closesSent()).toBe(0);

  // A board still open on the server is told it is left, as before.
  const open = await openFromServer('left-by-us', 'Open');
  await close();
  expect(open.provider.closesSent()).toBe(1);
});

it('tells the server nothing about a reset board until it signs in again (B2)', async () => {
  const { provider } = await openFromServer('reset-leave', 'Reset');
  await resetBy(provider);
  // Left while waiting to try again: the server already closed it.
  await close();
  expect(provider.closesSent()).toBe(0);

  // Signed in again, it is open on the server: leaving it says so.
  const again = await openFromServer('reset-back', 'Back');
  await resetBy(again.provider);
  await retryWait(1);
  await act(async () => again.provider.handshake());
  await close();
  expect(again.provider.closesSent()).toBe(1);
});

it('sends nothing for a reset board until it signs in again, whose handshake carries the edits (B1)', async () => {
  const { provider } = await openFromServer('reset-quiet', 'Quiet');
  await resetBy(provider);
  expect(provider.attached()).toBe(false);
  const sent = provider.sent();
  // Sent now, the server would queue it and replay it before the next handshake.
  await act(async () => connection!.store.doc.getMap('meta').set('title', 'While waiting'));
  expect(provider.sent()).toBe(sent);
  await retryWait(1);
  expect(provider.attached()).toBe(true);
});

it('sets aside edits made while signing in again, even when a late answer counts back to zero (B1)', async () => {
  const { provider } = await openFromServer('reset-late', 'Late');
  // A reset with nothing of ours unconfirmed.
  await resetBy(provider);
  await act(async () => {
    connection!.store.doc.getMap('meta').set('title', 'Typed while retrying');
    provider.emit('unsyncedChanges', { number: 1 });
  });
  await retryWait(1);
  // The server answers for a message it got after closing the document, before the handshake:
  // Hocuspocus 4.8 says synced, then counts back to zero.
  await act(async () => provider.confirm());
  expect(connection?.retrying).toBe(true);
  // Then refuses the edit again, and again.
  await resetBy(provider);
  await retryWait(2);
  await resetBy(provider);
  await settle();
  expect(providers.at(-1)).not.toBe(provider);
  expect(connection?.kept).toBeTruthy();
  expect(connection?.updateRefused).toBe(true);
});

it('stops trying again once the session ended or the access was lost (M3)', async () => {
  const { provider } = await openFromServer('reset-ended', 'Ended');
  await resetBy(provider);
  await act(async () => provider.onClose({ event: { code: 1000, reason: 'Unauthorized' } }));
  await retryWait(1);
  expect(provider.reattached()).toBe(0);
  expect(connection?.status).toBe('signedOut');

  await close();
  me.get.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const lost = await openFromServer('pause-lost', 'Lost');
  await act(async () => lost.provider.onAuthenticationFailed({ reason: 'permission-denied' }));
  await settle();
  expect(connection?.status).toBe('offline');
  await act(async () => lost.provider.onClose({ event: { code: 1000, reason: 'Forbidden' } }));
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(lost.provider.reattached()).toBe(0);
  expect(connection?.status).toBe('denied');
});

it('spreads the retries of boards on a shared socket over twice the wait (M4)', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.9);
  const { provider } = await openFromServer('reset-spread', 'Spread');
  await resetBy(provider);
  await act(() => new Promise((resolve) => setTimeout(resolve, RESET_BACKOFF_MS * 1.5)));
  expect(provider.reattached()).toBe(0);
  await act(() => new Promise((resolve) => setTimeout(resolve, RESET_BACKOFF_MS * 0.5)));
  expect(provider.reattached()).toBe(1);
});

it('tries again later after a sign-in refused for a passing reason, the socket staying open (M4)', async () => {
  me.get.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const { provider } = await openFromServer('auth-pause', 'Paused');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await act(async () => provider.onAuthenticationFailed({ reason: 'permission-denied' }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(connection?.status).toBe('offline');
    // Nothing more goes to the server for a document it refused.
    expect(provider.attached()).toBe(false);
    await act(async () => vi.advanceTimersByTime(2 * RESET_PAUSE_MS));
    expect(provider.reattached()).toBe(1);
    expect(connection?.status).toBe('connecting');
  } finally {
    vi.useRealTimers();
  }
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

it('takes a late answer before the handshake for nothing saved, as Hocuspocus 4.8 orders it', async () => {
  const provider = await editSynced('reset-order', 'Not saved yet');
  await resetBy(provider);
  await retryWait(1);
  // Synced, then zero: the answer to a message sent before the server closed the document.
  await act(async () => provider.confirm());
  expect(connection?.status).toBe('connecting');
  expect(connection?.retrying).toBe(true);
  expect(await unsavedLocalBoards(person.id)).toContain('reset-order');
  // The handshake's own sync step 2, then the server takes the edits it carried.
  await act(async () => provider.handshake());
  expect(connection?.status).toBe('synced');
  expect(await unsavedLocalBoards(person.id)).toContain('reset-order');
  await act(async () => provider.confirm());
  await settle();
  expect(await unsavedLocalBoards(person.id)).not.toContain('reset-order');
});

it('takes a socket closing normally for a socket that reconnects, not a board closed by the server', async () => {
  const provider = await editSynced('socket-close', 'Not saved yet');
  for (let i = 1; i <= RESET_LIMIT; i++) {
    await act(async () => provider.closeSocket(1000));
    await retryWait(i);
  }
  await settle();
  expect(providers.at(-1)).toBe(provider);
  expect(provider.attached()).toBe(true);
  expect(provider.reattached()).toBe(0);
  expect(connection?.kept).toBeFalsy();
  expect(connection?.status).toBe('offline');
  // A socket closed because the session ended still says so.
  await act(async () => provider.closeSocket(4401, 'Unauthorized'));
  expect(connection?.status).toBe('signedOut');
});

it('does not set a board aside for resets after its reset edits were saved', async () => {
  const now = vi.spyOn(Date, 'now');
  let clock = 7_000_000;
  now.mockImplementation(() => clock);
  const provider = await editSynced('reset-saved', 'Saved after a reset');
  await resetBy(provider);
  await retryWait(1);
  await act(async () => {
    provider.handshake();
    provider.confirm();
  });
  // Within the minute, resets with nothing of ours unconfirmed.
  for (let i = 2; i <= RESET_LIMIT; i++) {
    clock += 1000;
    await resetBy(provider);
    if (i < RESET_LIMIT) await retryWait(i);
  }
  await settle();
  expect(providers.at(-1)).toBe(provider);
  expect(connection?.kept).toBeFalsy();
  expect(connection?.updateRefused).toBeFalsy();
  expect(connection?.status).toBe('offline');
});

it('waits a while before the network or the tab coming back cuts a pause short, then spreads it', async () => {
  const { provider } = await openFromServer('resume-spread', 'Resume');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    for (let i = 1; i <= RESET_LIMIT; i++) {
      await resetBy(provider);
      if (i < RESET_LIMIT) await act(async () => vi.advanceTimersByTime(2 * RESET_BACKOFF_MS * i));
    }
    expect(connection?.status).toBe('offline');
    const paused = provider.reattached();
    // Just paused: the tab shown again does not end it.
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTime(2 * RESET_BACKOFF_MS));
    expect(provider.reattached()).toBe(paused);
    await act(async () => vi.advanceTimersByTime(RESET_RESUME_MS));
    // Every board on a shared socket hears it: not all at once.
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(provider.reattached()).toBe(paused);
    await act(async () => vi.advanceTimersByTime(2 * RESET_BACKOFF_MS));
    expect(provider.reattached()).toBe(paused + 1);
  } finally {
    vi.useRealTimers();
  }
});

let views: (BoardConnection | null)[] = [];
function TwoViews({ id }: { id: string }) {
  views = [useBoardConnection(id, false), useBoardConnection(id, false)];
  return null;
}
let shared: Record<string, BoardConnection | null> = {};
function SharedBoards({ a, b }: { a: string; b: string }) {
  shared = { [a]: useBoardConnection(a, false, true), [b]: useBoardConnection(b, false, true) };
  return null;
}
async function mount(element: React.ReactElement) {
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  await act(async () => root!.render(element));
  await settle();
  const opened = providers.slice(-2);
  await act(async () => {
    for (const provider of opened) {
      provider.onAuthenticated({ scope: 'read-write' });
      provider.onSynced();
    }
  });
  return opened;
}

it('counts the resets of each view of a board on its own', async () => {
  const [first, second] = await mount(<TwoViews id="two-views" />);
  // The server closing both views at once is one reset for each.
  await resetBy(first!);
  await resetBy(second!);
  await retryWait(1);
  await resetBy(first!);
  expect(views[0]?.status).toBe('connecting');
  expect(views[0]?.retrying).toBe(true);
});

it('resets one board of a shared socket and leaves the other open on the server', async () => {
  const [a, b] = await mount(<SharedBoards a="shared-a" b="shared-b" />);
  expect(a!.attached()).toBe(true);
  expect(b!.attached()).toBe(true);
  await resetBy(a!);
  expect(a!.attached()).toBe(false);
  expect(b!.attached()).toBe(true);
  expect(shared['shared-a']?.retrying).toBe(true);
  expect(shared['shared-b']?.status).toBe('synced');
  await close();
  // Only the board the server still has open is told it is left.
  expect(a!.closesSent()).toBe(0);
  expect(b!.closesSent()).toBe(1);
});

it('says the server refused the edits only once they are set aside', async () => {
  // Edits set aside earlier are still on the device.
  const earlier = new Y.Doc();
  earlier.getMap('meta').set('subtitle', 'Set aside earlier');
  await keepAside(person.id, 'refused-full', earlier);
  const provider = await editSynced('refused-full', 'Refused, the disk full');
  expect(connection?.kept).toBeTruthy();
  diskFull.on = true;
  for (let i = 1; i <= RESET_LIMIT; i++) {
    await resetBy(provider);
    if (i < RESET_LIMIT) await retryWait(i);
  }
  await settle();
  expect(providers.at(-1)).not.toBe(provider);
  expect(connection?.updateRefused).toBe(false);
});
