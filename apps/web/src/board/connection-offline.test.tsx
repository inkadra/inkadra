// @vitest-environment happy-dom
import { CURRENT_SCHEMA_VERSION } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { RequestError } from '../lib/api.ts';
import {
  type BoardConnection,
  CACHED_BOARDS,
  cachedBoards,
  SOCKET_DOCS,
  useBoardConnection,
} from './connection.ts';

type Options = {
  document: Y.Doc;
  onAuthenticated: (event: { scope: string }) => void;
  onDisconnect: () => void;
  onAuthenticationFailed: (event: { reason: string }) => void;
  websocketProvider?: object;
};
const person = vi.hoisted(() => ({ id: 'offline-test' }));
const sockets = vi.hoisted(() => [] as Options[]);
/** What was destroyed, in order: a shared socket must close after its providers flushed. */
const destroyed = vi.hoisted(() => [] as string[]);
const me = vi.hoisted(() => ({ get: vi.fn(async () => ({})) }));
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api: me,
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ user: person }) }));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    document: Y.Doc;
    constructor(options: Options) {
      this.document = options.document;
      sockets.push(options);
    }
    on() {}
    off() {}
    attach() {}
    destroy() {
      destroyed.push('provider');
    }
  },
  HocuspocusProviderWebsocket: class {
    destroy() {
      destroyed.push('socket');
    }
  },
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot> | undefined;
let connection: BoardConnection | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  sockets.length = 0;
  destroyed.length = 0;
  person.id = 'offline-test';
  me.get.mockReset();
  me.get.mockResolvedValue({});
});
function Board({ id, share = false }: { id: string; share?: boolean }) {
  connection = useBoardConnection(id, false, share);
  return null;
}
async function open(id: string) {
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  await act(async () => root!.render(<Board id={id} />));
  return sockets.at(-1)!;
}
it('starts editable without a read-only flash and restores cached offline edits and role', async () => {
  const socket = await open('offline-editor');
  expect(connection?.readOnly).toBe(false);
  await act(async () => {
    socket.onAuthenticated({ scope: 'read-write' });
    connection!.store.doc.getMap('meta').set('schemaVersion', CURRENT_SCHEMA_VERSION);
    connection!.store.doc.getMap('meta').set('title', 'Queued offline');
    socket.onDisconnect();
  });
  await act(async () => root!.unmount());
  root = undefined;
  const reopened = await open('offline-editor');
  await act(async () => reopened.onDisconnect());
  expect(connection?.status).toBe('offline');
  expect(connection?.readOnly).toBe(false);
  expect(connection?.store.doc.getMap('meta').get('title')).toBe('Queued offline');
});
it('keeps a cached viewer and a cached newer-schema document read-only offline', async () => {
  let socket = await open('offline-viewer');
  await act(async () => socket.onAuthenticated({ scope: 'readonly' }));
  await act(async () => root!.unmount());
  root = undefined;
  await open('offline-viewer');
  expect(connection?.readOnly).toBe(true);
  await act(async () => root!.unmount());
  root = undefined;
  socket = await open('offline-future');
  await act(async () => {
    socket.onAuthenticated({ scope: 'read-write' });
    connection!.store.doc.getMap('meta').set('schemaVersion', CURRENT_SCHEMA_VERSION + 1);
  });
  await act(async () => root!.unmount());
  root = undefined;
  await open('offline-future');
  expect(connection?.schemaTooNew).toBe(true);
  expect(connection?.readOnly).toBe(true);
});

it("does not reuse another signed-in person's cached document or role", async () => {
  const socket = await open('private-board');
  await act(async () => {
    socket.onAuthenticated({ scope: 'readonly' });
    connection!.store.doc.getMap('meta').set('title', 'Private cached content');
  });
  await act(async () => root!.unmount());
  root = undefined;
  person.id = 'another-person';
  await open('private-board');
  expect(connection?.store.doc.getMap('meta').get('title')).toBeUndefined();
  expect(connection?.readOnly).toBe(false);
});

it('discards cached content after the server denies access', async () => {
  const socket = await open('revoked-board');
  await act(async () => {
    connection!.store.doc.getMap('meta').set('title', 'Revoked content');
    socket.onAuthenticationFailed({ reason: 'permission-denied' });
  });
  expect(connection?.status).toBe('denied');
  await act(async () => root!.unmount());
  root = undefined;
  await open('revoked-board');
  expect(connection?.store.doc.getMap('meta').get('title')).toBeUndefined();
});

it('tells a session that expired while away from a lost access, and keeps its edits', async () => {
  // Reconnecting after sleep with an expired cookie: the server only says "permission denied".
  me.get.mockRejectedValue(new RequestError(401, 'unauthorized', 'Not signed in'));
  const socket = await open('slept-board');
  await act(async () => {
    socket.onAuthenticated({ scope: 'read-write' });
    connection!.store.doc.getMap('meta').set('title', 'Edited on the train');
    socket.onDisconnect();
    socket.onAuthenticationFailed({ reason: 'permission-denied' });
  });
  expect(connection?.status).toBe('signedOut');
  await act(async () => root!.unmount());
  root = undefined;
  await open('slept-board');
  expect(connection?.store.doc.getMap('meta').get('title')).toBe('Edited on the train');
});

it('stays offline, not denied, when the server cannot say who is signed in', async () => {
  me.get.mockRejectedValue(new TypeError('Failed to fetch'));
  const socket = await open('unreachable-board');
  await act(async () => socket.onAuthenticationFailed({ reason: 'permission-denied' }));
  expect(connection?.status).toBe('offline');
});

it('keeps only the last boards, but never one with edits the server has not confirmed', async () => {
  cachedBoards.clear();
  let socket = await open('unsaved-early');
  await act(async () => {
    socket.onAuthenticated({ scope: 'read-write' });
    connection!.store.doc.getMap('meta').set('title', 'Not saved yet');
    socket.onDisconnect();
  });
  await act(async () => root!.unmount());
  for (let i = 0; i < CACHED_BOARDS + 2; i++) {
    socket = await open(`seen-${i}`);
    await act(async () => socket.onAuthenticated({ scope: 'read-write' }));
    await act(async () => root!.unmount());
  }
  root = undefined;
  expect(cachedBoards.size).toBe(CACHED_BOARDS);
  // The oldest saved boards went first; the unsaved one stayed although it is older.
  expect(cachedBoards.has(`${person.id}:seen-0`)).toBe(false);
  expect(cachedBoards.has(`${person.id}:seen-${CACHED_BOARDS + 1}`)).toBe(true);
  await open('unsaved-early');
  expect(connection?.store.doc.getMap('meta').get('title')).toBe('Not saved yet');
});

it('opens shared-socket boards over one socket, closed only after every provider flushed', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  await act(async () =>
    root!.render(
      <>
        <Board id="story-a" share />
        <Board id="story-b" share />
      </>,
    ),
  );
  expect(sockets).toHaveLength(2);
  expect(sockets[0]!.websocketProvider).toBeDefined();
  expect(sockets[1]!.websocketProvider).toBe(sockets[0]!.websocketProvider);
  await act(async () => root!.unmount());
  root = undefined;
  expect(destroyed).toEqual(['provider', 'provider', 'socket']);
});

it('fills a socket up to SOCKET_DOCS boards, and never with the same board twice', async () => {
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  const ids = Array.from({ length: SOCKET_DOCS + 1 }, (_, i) => `story-${i}`);
  const last = ids.at(-1)!;
  await act(async () =>
    root!.render(
      <>
        {ids.map((id) => (
          <Board key={id} id={id} share />
        ))}
        <Board id={last} share />
      </>,
    ),
  );
  const used = sockets.map((s) => s.websocketProvider);
  expect(used).toHaveLength(SOCKET_DOCS + 2);
  expect(new Set(used.slice(0, SOCKET_DOCS)).size).toBe(1);
  // Past the cap, a second socket; a second view of the same board, a third with its own document.
  expect(new Set(used).size).toBe(3);
  expect(sockets.at(-1)!.document).not.toBe(sockets.at(-2)!.document);
  await act(async () => root!.unmount());
  root = undefined;
  expect(destroyed.filter((d) => d === 'socket')).toHaveLength(3);
});
