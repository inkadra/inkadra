// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { type BoardConnection, useBoardConnection } from './connection.ts';

type Options = {
  document: Y.Doc;
  onAuthenticated: (event: { scope: string }) => void;
  onDisconnect: () => void;
  onAuthenticationFailed: () => void;
};
const person = vi.hoisted(() => ({ id: 'offline-test' }));
const sockets = vi.hoisted(() => [] as Options[]);
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
    destroy() {}
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
  person.id = 'offline-test';
});
function Board({ id }: { id: string }) {
  connection = useBoardConnection(id, false);
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
    connection!.store.doc.getMap('meta').set('schemaVersion', 16);
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
    connection!.store.doc.getMap('meta').set('schemaVersion', 17);
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
    socket.onAuthenticationFailed();
  });
  await act(async () => root!.unmount());
  root = undefined;
  await open('revoked-board');
  expect(connection?.store.doc.getMap('meta').get('title')).toBeUndefined();
});
