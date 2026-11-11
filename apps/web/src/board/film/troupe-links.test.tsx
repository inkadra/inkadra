// @vitest-environment happy-dom
import type { CrewMember } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import type { SessionState } from '../../lib/session.tsx';
import { SessionContext } from '../../lib/session-context.ts';
import { BoardStore } from '../store.ts';
import { emptyCrewMember, TroupeView } from './TroupeView.tsx';

/** The two links of a crew row: its character card and its Inkadra account. */

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../lib/phone.ts', () => ({ useIsPhone: () => false }));
const dispose: Array<() => void> = [];
afterEach(() => {
  for (const fn of dispose.splice(0).reverse()) fn();
  vi.restoreAllMocks();
});
const member: CrewMember = {
  ...emptyCrewMember('Anna Greco', 0),
  role: 'Elena',
  department: 'Cast',
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  revision: 1,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
};
const session = {
  user: { id: 'me', name: 'Matteo Rossi', email: 'matteo@example.com', image: null },
} as unknown as SessionState;
async function open() {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    path.includes('/crew') && !path.endsWith('/characters')
      ? { items: [member], nextCursor: null }
      : { items: [] },
  );
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  dispose.push(() => {
    act(() => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  });
  await act(async () =>
    root.render(
      <SessionContext.Provider value={session}>
        <TroupeView store={store} boardId="board" projectId={member.projectId} />
      </SessionContext.Provider>,
    ),
  );
  await act(async () => (host.querySelector('.troupe__person') as HTMLButtonElement).click());
  return host;
}
const links = (host: ParentNode) =>
  [...host.querySelectorAll('button')].filter((el) => el.textContent === 'troupe.link');
async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Past the search's wait, with its answer in.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
}

it('says why a character card cannot be linked yet', async () => {
  const host = await open();
  const [character] = links(host);
  expect(character?.disabled).toBe(true);
  const hint = character?.getAttribute('aria-describedby')?.split(' ').at(-1);
  expect(hint && document.getElementById(hint)?.textContent).toBe('troupe.characterNone');
});

it('links your own account and says when nobody matches', async () => {
  const host = await open();
  await act(async () =>
    links(host)
      .find((el) => !el.disabled)
      ?.click(),
  );
  const field = host.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (!field) throw new Error('no account field');
  await type(field, 'Matteo');
  expect(host.querySelector('[role="option"]')?.textContent).toContain('Matteo Rossi');
  await type(field, 'Zeno');
  expect(host.querySelector('[role="option"]')).toBeNull();
  expect(host.querySelector('.people-picker__empty')?.textContent).toBe('troupe.noResults');
});
