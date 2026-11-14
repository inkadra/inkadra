// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  keepAside,
  localBoardName,
  openLocalBoard,
  unsavedLocalBoards,
} from '../board/local-boards.ts';
import { authApi } from './api.ts';
import { useSignOut } from './SignOut.tsx';

const { t } = vi.hoisted(() => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
const saved = vi.hoisted(() => [] as string[]);
vi.mock('../board/export/engine.ts', () => ({
  downloadBlob: (_blob: Blob, name: string) => saved.push(name),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.restoreAllMocks());

let start = () => {};
function Probe() {
  const leave = useSignOut('leaver', () => {});
  start = leave.start;
  return leave.dialog;
}
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label);

it('asks before signing out deletes edits only this device has (#791)', async () => {
  const doc = new Y.Doc();
  const copy = await openLocalBoard(localBoardName('leaver', 'draft'), 'draft', doc, () => {});
  doc.getMap('meta').set('title', 'Not on the server yet');
  copy.mark(true);
  await copy.close();
  const signOut = vi.spyOn(authApi, 'signOut').mockResolvedValue(null);
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root.render(<Probe />));
  await act(async () => start());
  await settle();
  expect(document.body.textContent).toContain('auth.signOutUnsaved.body {"count":1}');
  // Staying signed in keeps them.
  await act(async () => button('auth.signOutUnsaved.stay')?.click());
  expect(signOut).not.toHaveBeenCalled();
  expect(await unsavedLocalBoards('leaver')).toEqual(['draft']);
  // Signing out anyway deletes them.
  await act(async () => start());
  await settle();
  await act(async () => button('auth.signOutUnsaved.confirm')?.click());
  await settle();
  expect(signOut).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
  expect(await unsavedLocalBoards('leaver')).toEqual([]);
  await act(async () => root.unmount());
});

it('signs out at once when nothing is unsaved', async () => {
  const signOut = vi.spyOn(authApi, 'signOut').mockResolvedValue(null);
  vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root.render(<Probe />));
  await act(async () => start());
  await settle();
  expect(signOut).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
});

it('downloads edits set aside, which then no longer hold the sign-out back (#791)', async () => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('title', 'Refused at the size limit');
  await keepAside('leaver', 'full', doc);
  const signOut = vi.spyOn(authApi, 'signOut').mockResolvedValue(null);
  vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root.render(<Probe />));
  await act(async () => start());
  await settle();
  expect(document.body.textContent).toContain('auth.signOutUnsaved.kept {"count":1}');
  // Opening the board would not save them: the offline-edits text is not shown for it.
  expect(document.body.textContent).not.toContain('auth.signOutUnsaved.body');
  await act(async () => button('auth.signOutUnsaved.download')?.click());
  await settle();
  expect(saved).toEqual(['inkadra-kept-changes-full.json']);
  // Downloaded: nothing else unsaved, so the question closes and signing out goes at once.
  expect(document.body.textContent).not.toContain('auth.signOutUnsaved.title');
  expect(await unsavedLocalBoards('leaver')).toEqual([]);
  await act(async () => start());
  await settle();
  expect(signOut).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
});
