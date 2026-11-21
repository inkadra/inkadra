// @vitest-environment happy-dom
import type { CrewMember } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { BoardStore } from '../store.ts';
import { CastPerformers } from './FramePanel.tsx';
import { emptyCrewMember } from './TroupeView.tsx';

/** A frame's cast with who plays it, and "Link" when no one does yet (decision 0091). */

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../lib/modules.ts', () => ({ useModules: () => ({ isOn: () => true }) }));
const dispose: Array<() => void> = [];
afterEach(() => {
  for (const fn of dispose.splice(0).reverse()) fn();
  vi.restoreAllMocks();
});
const ada: CrewMember = {
  ...emptyCrewMember('Ada Prova', 0),
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  revision: 3,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
};

// Plays Leo through the role of a Cast row: not offered for another character.
const leo: CrewMember = {
  ...ada,
  id: crypto.randomUUID(),
  name: 'Leo Verdi',
  department: 'Cast',
  role: 'Leo',
  position: 1,
};

it('links a person to the character, making its card on this board when there is none', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    path.endsWith('/crew') ? { items: [ada, leo], nextCursor: null } : { items: [] },
  );
  const put = vi.spyOn(api, 'put').mockResolvedValue({});
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
      <CastPerformers
        store={store}
        projectId={ada.projectId}
        boardId="board"
        cast={['Marta']}
        userId="me"
        readOnly={false}
      />,
    ),
  );
  expect(host.textContent).toContain('film.frame.noPerformer');
  const link = host.querySelector<HTMLButtonElement>('[aria-label="film.frame.linkPerformer"]');
  await act(async () => link?.click());
  const items = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  expect(items.map((el) => el.textContent)).toEqual(['Ada Prova']);
  const person = items[0];
  await act(async () => person?.click());
  const card = [...store.getSnapshot().byId.values()].find((el) => el.type === 'character');
  expect(card).toMatchObject({ name: 'Marta', actor: 'Ada Prova' });
  expect(put).toHaveBeenCalledWith(
    `/projects/${ada.projectId}/crew/${ada.id}`,
    expect.objectContaining({
      name: 'Ada Prova',
      revision: 3,
      character: { boardId: 'board', elementId: card?.id },
    }),
  );
});
