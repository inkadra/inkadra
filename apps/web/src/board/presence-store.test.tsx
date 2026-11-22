// @vitest-environment happy-dom
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { act, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { PresenceLayer } from './PresenceLayer.tsx';
import { type PeerSource, peerSource, sameSelections, selections, usePeers } from './presence.ts';

/** An awareness with one other tab on the board whose state the test changes. */
function board() {
  const states = new Map<number, Record<string, unknown>>();
  const listeners = new Set<() => void>();
  const set = (
    state: Partial<{ cursor: unknown; selection: string[]; editing: string | null }>,
  ) => {
    states.set(2, {
      user: { id: 'u2', name: 'Paola Rossi', image: null },
      readOnly: false,
      cursor: null,
      selection: [],
      editing: null,
      ...states.get(2),
      ...state,
    });
    for (const l of listeners) l();
  };
  const provider = {
    awareness: {
      clientID: 1,
      getStates: () => states,
      on: (_: string, l: () => void) => listeners.add(l),
      off: (_: string, l: () => void) => listeners.delete(l),
    },
  } as unknown as HocuspocusProvider;
  set({});
  return { provider, set, listeners };
}

const A = 'card-0001';

const renders = { canvas: 0, outlines: 0 };

/** Stand-in for a part that reads the selections. */
function Outlines({ peers }: { peers: PeerSource }) {
  renders.outlines++;
  const shown = usePeers(peers, selections, sameSelections);
  return <i data-selected={shown.flatMap((p) => p.selection).join(',')} />;
}

/** Stand-in for the canvas: it gets the source only. */
const Canvas = memo(function Canvas({ peers }: { peers: PeerSource }) {
  renders.canvas++;
  return (
    <>
      <Outlines peers={peers} />
      <PresenceLayer peers={peers} zoom={1} rectOf={() => ({ x: 0, y: 0, w: 10, h: 10 })} />
    </>
  );
});

it('redraws only the pointers when someone moves theirs, the outlines when they select', async () => {
  const { provider, set, listeners } = board();
  const source = peerSource(provider);
  renders.canvas = 0;
  renders.outlines = 0;
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<Canvas peers={source} />));
  expect(renders).toEqual({ canvas: 1, outlines: 1 });

  await act(async () => set({ cursor: { x: 5, y: 6 } }));
  await act(async () => set({ cursor: { x: 7, y: 8 } }));
  expect(renders).toEqual({ canvas: 1, outlines: 1 });
  expect(host.querySelector<HTMLElement>('.peer-cursor')?.style.transform).toContain('7px, 8px');

  await act(async () => set({ selection: [A], editing: A }));
  expect(renders).toEqual({ canvas: 1, outlines: 2 });
  expect(host.querySelector('i')?.getAttribute('data-selected')).toBe(A);
  expect(host.querySelector('.peer-outline--editing')).not.toBeNull();

  await act(async () => set({ cursor: { x: 1, y: 1 } }));
  expect(renders).toEqual({ canvas: 1, outlines: 2 });

  await act(async () => root.unmount());
  expect(listeners.size).toBe(0);
});
