// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { BoardPresence } from './BoardPage.tsx';
import { type BoardConnection, createSaveStore } from './connection.ts';

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
