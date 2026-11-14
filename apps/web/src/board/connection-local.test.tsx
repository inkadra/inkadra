// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { authApi, RequestError } from '../lib/api.ts';
import { signOut } from '../lib/sign-out.ts';
import {
  type BoardConnection,
  cachedBoards,
  refusalStatus,
  useBoardConnection,
} from './connection.ts';

/** The copy of a board on the device (#791): a reload, a second account, signing out. */
type Options = {
  document: Y.Doc;
  onAuthenticated: (event: { scope: string }) => void;
  onSynced: () => void;
  onDisconnect: () => void;
  onAuthenticationFailed: (event: { reason: string }) => void;
};
type Provider = Options & { emit: (event: string, payload: unknown) => void };
const person = vi.hoisted(() => ({ id: 'person-a' }));
const providers = vi.hoisted(() => [] as Provider[]);
const me = vi.hoisted(() => ({ get: vi.fn(async () => ({})) }));
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api: me,
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ user: person }) }));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    document: Y.Doc;
    listeners = new Map<string, (payload: unknown) => void>();
    constructor(options: Options) {
      this.document = options.document;
      providers.push({
        ...options,
        emit: (event, payload) => this.listeners.get(event)?.(payload),
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

let root: ReturnType<typeof createRoot> | undefined;
let connection: BoardConnection | null = null;
afterEach(async () => {
  await close();
  person.id = 'person-a';
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
  // Confirmed: the copy on the device is deleted when the board closes.
  await reload();
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
  await reload();
  await open('revoked');
  expect(title()).toBeUndefined();
});

it('keeps the copy when the server fails rather than refuses', async () => {
  me.get.mockRejectedValueOnce(new RequestError(503, 'unavailable', 'Down'));
  expect(await refusalStatus()).toBe('offline');
  me.get.mockRejectedValueOnce(new RequestError(403, 'forbidden', 'No'));
  expect(await refusalStatus()).toBe('denied');
});
