// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { type BoardConnection, useBoardConnection } from './connection.ts';

const mocks = vi.hoisted(() => ({
  providers: [] as Array<{
    document: Y.Doc;
    options: { onStateless: (event: { payload: string }) => void; onSynced: () => void };
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ user: { id: 'limit-reader' } }) }));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    document: Y.Doc;
    destroy = vi.fn();
    constructor(
      public options: {
        document: Y.Doc;
        onStateless: (event: { payload: string }) => void;
        onSynced: () => void;
      },
    ) {
      this.document = options.document;
      mocks.providers.push(this);
    }
    on() {}
    off() {}
  },
}));

let connection: BoardConnection | null = null;
function Board() {
  connection = useBoardConnection('limited-board', false);
  return null;
}

it('reopens confirmed state after a limit refusal, without caching rejected additions or disabling deletions', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Board />));
    const first = mocks.providers[0]!;
    first.document.getMap('elements').set('refused-addition', new Y.Map());
    await act(async () =>
      first.options.onStateless({
        payload: JSON.stringify({ type: 'writeRefused', reason: 'frozen' }),
      }),
    );
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(mocks.providers).toHaveLength(2);
    expect(mocks.providers[1]!.document.getMap('elements').has('refused-addition')).toBe(false);
    expect(connection).toMatchObject({ sizeLimited: true, readOnly: false });
  } finally {
    await act(async () => root.unmount());
  }
});

it('makes the deletions of the refused document again once the reopened one has synced', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.providers.length = 0;
  const server = new Y.Doc();
  server.getMap('elements').set('kept', new Y.Map());
  server.getMap('elements').set('deleted', new Y.Map());
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Board />));
    const first = mocks.providers[0]!;
    Y.applyUpdate(first.document, Y.encodeStateAsUpdate(server));
    // Not yet confirmed when the server refuses the addition sent with it.
    first.document.getMap('elements').delete('deleted');
    first.document.getMap('elements').set('refused-addition', new Y.Map());
    first.document.getMap('elements').delete('refused-addition');
    first.document.getMap('elements').set('refused-again', new Y.Map());
    await act(async () =>
      first.options.onStateless({
        payload: JSON.stringify({ type: 'writeRefused', reason: 'frozen' }),
      }),
    );
    const second = mocks.providers.at(-1)!;
    expect(second).not.toBe(first);
    const sent: Uint8Array[] = [];
    // The provider sends every update it did not apply from the server.
    second.document.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== second) sent.push(update);
    });
    Y.applyUpdate(second.document, Y.encodeStateAsUpdate(server), second);
    await act(async () => second.options.onSynced());
    expect([...second.document.getMap('elements').keys()]).toEqual(['kept']);
    expect(second.document.store.pendingDs).toBeNull();
    // What the provider sends deletes on the server too, and names nothing it lacks.
    expect(sent).toHaveLength(1);
    for (const update of sent) Y.applyUpdate(server, update);
    expect([...server.getMap('elements').keys()]).toEqual(['kept']);
    expect(server.store.pendingDs).toBeNull();
  } finally {
    await act(async () => root.unmount());
    server.destroy();
  }
});

const seen = new Set<BoardConnection | null>();
// The board page's effects depend on this object: a new one on every render reruns them.
function Probe(_: { render: number }) {
  seen.add(useBoardConnection('stable-board', false));
  return null;
}

it('keeps the same connection object across renders that change nothing', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  seen.clear();
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Probe render={1} />));
    await act(async () => root.render(<Probe render={2} />));
    await act(async () => root.render(<Probe render={3} />));
    expect([...seen].filter(Boolean)).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
  }
});
