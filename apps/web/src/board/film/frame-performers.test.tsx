// @vitest-environment happy-dom
import type { CrewMember } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api, RequestError } from '../../lib/api.ts';
import { CrewEditorContext } from '../context.ts';
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

async function mount({ editor = true, crew = [ada, leo] } = {}) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    path.endsWith('/crew') ? { items: crew, nextCursor: null } : { items: [] },
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
      <CrewEditorContext.Provider value={editor}>
        <CastPerformers
          store={store}
          projectId={ada.projectId}
          boardId="board"
          cast={['Marta']}
          userId="me"
          readOnly={false}
        />
      </CrewEditorContext.Provider>,
    ),
  );
  const linkButton = () =>
    host.querySelector<HTMLButtonElement>('[aria-label="film.frame.linkPerformer"]');
  const pick = async (name: string) => {
    await act(async () => linkButton()?.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
      (el) => el.textContent === name,
    );
    await act(async () => item?.click());
  };
  const cards = () =>
    [...store.getSnapshot().byId.values()].filter((el) => el.type === 'character');
  return { host, store, linkButton, pick, cards };
}

it('links a person to the character, making its card on this board when there is none', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({});
  const { host, pick, cards } = await mount();
  expect(host.textContent).toContain('film.frame.noPerformer');
  await pick('Ada Prova');
  const [card] = cards();
  // Who plays it is the crew link, never written on the card ahead of it.
  expect(card).toMatchObject({ name: 'Marta' });
  expect(card && 'actor' in card ? card.actor : undefined).toBeFalsy();
  expect(put).toHaveBeenCalledWith(
    `/projects/${ada.projectId}/crew/${ada.id}`,
    expect.objectContaining({
      name: 'Ada Prova',
      revision: 3,
      character: { boardId: 'board', elementId: card?.id },
    }),
  );
});

it('offers only free people, by the call sheet’s rule', async () => {
  vi.spyOn(api, 'put').mockResolvedValue({});
  const { linkButton } = await mount();
  await act(async () => linkButton()?.click());
  expect(
    [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map((el) => el.textContent),
  ).toEqual(['Ada Prova']);
});

it('leaves no card and no performer when the link fails, and keeps "Link" to try again', async () => {
  // The waits between tries pass at once.
  const wait = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) =>
    ms === 500 ? wait(fn, 0) : wait(fn, ms)) as typeof setTimeout);
  // The server has not seen the new card yet, every time.
  const put = vi
    .spyOn(api, 'put')
    .mockRejectedValue(new RequestError(400, 'bad_request', 'Character not found.'));
  const { host, pick, cards, linkButton } = await mount();
  await pick('Ada Prova');
  await act(async () => {
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(6));
  });
  expect(cards()).toEqual([]);
  expect(host.textContent).toContain('film.frame.noPerformer');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('film.frame.performerFailed');
  expect(linkButton()).not.toBeNull();
  expect(document.activeElement).toBe(linkButton());
});

it('says who already plays the character when a colleague linked it first', async () => {
  const bea = { ...ada, id: crypto.randomUUID(), name: 'Bea' };
  vi.spyOn(api, 'put').mockRejectedValue(
    new RequestError(409, 'conflict', 'Taken', { reason: 'character_taken', member: bea }),
  );
  const { host, pick, cards } = await mount();
  await pick('Ada Prova');
  expect(cards()).toEqual([]);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('film.frame.performerTaken');
});

it('shows "Link" only to people who can write the crew', async () => {
  const { host, linkButton } = await mount({ editor: false });
  expect(host.textContent).toContain('film.frame.noPerformer');
  expect(linkButton()).toBeNull();
});

it('keeps a long list inside a phone screen and gives the focus back to "Link"', async () => {
  const style = document.createElement('style');
  style.textContent = '.menu--canvas { position: fixed; }';
  document.head.append(style);
  dispose.push(() => style.remove());
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  const crew = Array.from({ length: 40 }, (_, n) => ({
    ...ada,
    id: crypto.randomUUID(),
    name: `Person ${n}`,
    position: n,
  }));
  const { linkButton } = await mount({ crew });
  await act(async () => linkButton()?.click());
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  expect(menu?.style.maxHeight).toBe('624px');
  await act(async () =>
    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(document.activeElement).toBe(linkButton());
});
