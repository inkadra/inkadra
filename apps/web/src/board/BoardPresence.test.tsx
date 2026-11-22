// @vitest-environment happy-dom
import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { BoardPresence } from './BoardPage.tsx';
import { type BoardConnection, createSaveStore } from './connection.ts';
import { PresenceLayer } from './PresenceLayer.tsx';
import { usePeerSource } from './presence.ts';

it('shows the picture of a person on the board', async () => {
  const image = 'https://example.com/paola.png';
  const states = new Map([
    [
      2,
      {
        user: { id: 'u2', name: 'Paola Rossi', image },
        readOnly: false,
        cursor: null,
        selection: [],
        editing: null,
      },
    ],
  ]);
  const conn = {
    provider: { awareness: { clientID: 1, getStates: () => states, on() {}, off() {} } },
    status: 'connected',
    readOnly: false,
    saves: createSaveStore(),
  } as unknown as BoardConnection;
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<BoardPresence conn={conn} selfId="me" />));
  expect(host.querySelector('.peers__one img')?.getAttribute('src')).toBe(image);
  await act(async () => root.unmount());
});

/** The canvas side: the pointers, from the connection's source. */
function Cursors({ conn }: { conn: BoardConnection }) {
  return <PresenceLayer peers={usePeerSource(conn.provider)} zoom={1} rectOf={() => null} />;
}

it('shares the canvas source and stays as it is while someone only moves their pointer', async () => {
  const listeners = new Set<() => void>();
  const paola = {
    user: { id: 'u2', name: 'Paola Rossi', image: null },
    readOnly: false,
    cursor: null as { x: number; y: number } | null,
    selection: [] as string[],
    editing: null as string | null,
  };
  const states = new Map([[2, paola]]);
  const set = (change: Partial<typeof paola>) => {
    states.set(2, { ...(states.get(2) ?? paola), ...change });
    for (const l of [...listeners]) l();
  };
  const conn = {
    provider: {
      awareness: {
        clientID: 1,
        getStates: () => states,
        on: (_: string, l: () => void) => listeners.add(l),
        off: (_: string, l: () => void) => listeners.delete(l),
      },
    },
    status: 'connected',
    readOnly: false,
    saves: createSaveStore(),
    store: { map: () => undefined },
  } as unknown as BoardConnection;
  let renders = 0;
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <Profiler id="header" onRender={() => renders++}>
          <BoardPresence conn={conn} selfId="me" />
        </Profiler>
        <Cursors conn={conn} />
      </>,
    ),
  );
  // One awareness listener for the header and the canvas: they share the source.
  expect(listeners.size).toBe(1);
  const before = renders;
  await act(async () => set({ cursor: { x: 1, y: 2 } }));
  await act(async () => set({ cursor: { x: 3, y: 4 } }));
  expect(renders).toBe(before);
  expect(host.querySelector('.peer-cursor')).not.toBeNull();
  await act(async () => set({ user: { ...paola.user, name: 'Paola Bianchi' } }));
  expect(renders).toBe(before + 1);
  expect(host.querySelector('.peers__one')?.getAttribute('title')).toBe('Paola Bianchi');
  await act(async () => root.unmount());
});
