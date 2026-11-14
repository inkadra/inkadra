// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CURRENT_SCHEMA_VERSION } from '@inkadra/doc-schema';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { installWebLocks } from '../test/web-locks.ts';
import {
  discardKept,
  dropLocalBoard,
  hasKept,
  keepAside,
  keptBoards,
  keptFile,
  localBoardName,
  openLocalBoard,
  sweepLocalBoards,
  unsavedLocalBoards,
} from './local-boards.ts';

installWebLocks();

/** The copies on the device of one board (#791), as two tabs or two views have them open. */
const turn = () => new Promise((resolve) => setTimeout(resolve, 30));
const titleOf = (doc: Y.Doc) => doc.getMap('meta').get('title');
async function stored(name: string, boardId = 'board') {
  const doc = new Y.Doc();
  const copy = await openLocalBoard(name, boardId, doc, () => {});
  await copy.close();
  return doc;
}

it('never deletes a copy another view has open, and sweeps it once nobody has it', async () => {
  const name = localBoardName('person', 'two-views');
  const a = new Y.Doc();
  const b = new Y.Doc();
  const viewA = await openLocalBoard(name, 'two-views', a, () => {});
  const viewB = await openLocalBoard(name, 'two-views', b, () => {});
  a.getMap('meta').set('title', 'Confirmed');
  viewA.mark(false);
  await viewA.close();
  // The first view closed with everything confirmed: the other one still has the copy.
  await sweepLocalBoards();
  b.getMap('meta').set('author', 'B');
  await turn();
  await viewB.close();
  expect((await stored(name)).getMap('meta').get('author')).toBe('B');
  // Nobody has it open and nothing in it is unsaved: it goes.
  await sweepLocalBoards();
  expect((await stored(name)).getMap('meta').get('author')).toBeUndefined();
});

it('keeps a copy with unsaved edits when it sweeps', async () => {
  const name = localBoardName('person', 'unsaved');
  const doc = new Y.Doc();
  const copy = await openLocalBoard(name, 'unsaved', doc, () => {});
  doc.getMap('meta').set('title', 'Offline');
  copy.mark(true);
  await copy.close();
  await sweepLocalBoards();
  expect(titleOf(await stored(name))).toBe('Offline');
  expect(await unsavedLocalBoards('person')).toContain('unsaved');
});

it('lets a copy deleted elsewhere go without breaking the document', async () => {
  const name = localBoardName('person', 'deleted-under');
  const doc = new Y.Doc();
  const lost = vi.fn();
  const copy = await openLocalBoard(name, 'deleted-under', doc, lost);
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  // Signing out in another tab, or a lost access, deletes it while this view edits.
  await dropLocalBoard(name);
  expect(lost).toHaveBeenCalledOnce();
  doc.getMap('meta').set('title', 'First');
  doc.getMap('meta').set('title', 'Second');
  // The document goes on: every edit is still emitted, so the server still gets it.
  expect(updates).toHaveLength(2);
  const server = new Y.Doc();
  for (const update of updates) Y.applyUpdate(server, update);
  expect(titleOf(server)).toBe('Second');
  await copy.close();
});

it('migrates a copy of an older schema before it reaches the board', async () => {
  const name = localBoardName('person', 'older');
  const old = new Y.Doc();
  const writer = await openLocalBoard(name, 'older', old, () => {});
  old.transact(() => {
    old.getMap('meta').set('schemaVersion', 25);
    const plan = new Y.Map<unknown>();
    plan.set('type', 'plan');
    const icon = new Y.Map<unknown>();
    icon.set('steps', [{ x: 1, y: 1 }]);
    icon.set('note', 'Enters left');
    plan.set('icons', Y.Array.from([icon]));
    old.getMap('elements').set('plan-1', plan);
  });
  await turn();
  await writer.close();
  const doc = new Y.Doc();
  const copy = await openLocalBoard(name, 'older', doc, () => {});
  expect(doc.getMap('meta').get('schemaVersion')).toBe(CURRENT_SCHEMA_VERSION);
  const plan = doc.getMap('elements').get('plan-1') as Y.Map<unknown>;
  const [icon] = (plan.get('icons') as Y.Array<Y.Map<unknown>>).toArray();
  // Version 26 moved a blocked icon's note: the edit made under 25 means what it meant.
  expect(icon?.get('stepNote')).toBe('Enters left');
  expect(icon?.has('note')).toBe(false);
  await copy.close();
});

it('never merges a copy of a newer schema, and keeps it', async () => {
  const name = localBoardName('person', 'newer');
  const ahead = new Y.Doc();
  const writer = await openLocalBoard(name, 'newer', ahead, () => {});
  ahead.getMap('meta').set('schemaVersion', CURRENT_SCHEMA_VERSION + 1);
  ahead.getMap('meta').set('title', 'From a newer build');
  writer.mark(true);
  await turn();
  await writer.close();
  const doc = new Y.Doc();
  const copy = await openLocalBoard(name, 'newer', doc, () => {});
  expect(copy.tooNew).toBe(true);
  expect(titleOf(doc)).toBeUndefined();
  await copy.close();
  await sweepLocalBoards();
  expect(await unsavedLocalBoards('person')).toContain('newer');
});

it('sets refused edits aside, counted as unsaved', async () => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('title', 'Too big');
  await keepAside('keeper', 'limited', doc);
  expect(await unsavedLocalBoards('keeper')).toEqual(['limited']);
});

it('keeps one copy set aside per board, merging later ones into it', async () => {
  const first = new Y.Doc();
  first.getMap('meta').set('title', 'First refusal');
  await keepAside('merger', 'board', first);
  const second = new Y.Doc();
  second.getMap('meta').set('author', 'Second refusal');
  await keepAside('merger', 'board', second);
  const names = (await indexedDB.databases()).filter((db) => db.name?.includes('merger'));
  expect(names).toHaveLength(1);
  const { blob, name } = await keptFile('merger', 'board');
  expect(name).toBe('inkadra-kept-changes-board.json');
  const file = JSON.parse(await blob.text());
  expect(file.content.meta).toEqual({ title: 'First refusal', author: 'Second refusal' });
  // The update restores the same document.
  const restored = new Y.Doc();
  Y.applyUpdate(
    restored,
    Uint8Array.from(atob(file.update), (c) => c.charCodeAt(0)),
  );
  expect(restored.getMap('meta').get('author')).toBe('Second refusal');
});

it('stops counting edits set aside once discarded', async () => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('title', 'Not wanted');
  await keepAside('discarder', 'board', doc);
  expect(await hasKept('discarder', 'board')).toBe(true);
  await discardKept('discarder', 'board');
  expect(await hasKept('discarder', 'board')).toBe(false);
  expect(await keptBoards('discarder')).toEqual([]);
  expect(await unsavedLocalBoards('discarder')).toEqual([]);
});

it('keeps the copy, still unsaved, when its edits could not be set aside', async () => {
  const name = localBoardName('person', 'disk-full');
  const doc = new Y.Doc();
  const copy = await openLocalBoard(name, 'disk-full', doc, () => {});
  doc.getMap('meta').set('title', 'Only here');
  copy.mark(true);
  // keepAside failed (QuotaExceededError, say): the deletion is called off.
  await dropLocalBoard(name, Promise.all([copy.close(), Promise.reject(new Error('Quota'))]));
  await sweepLocalBoards();
  expect(await unsavedLocalBoards('person')).toContain('disk-full');
  // Not merged again in this tab, where the server would refuse it again.
  await expect(openLocalBoard(name, 'disk-full', new Y.Doc(), () => {})).rejects.toThrow();
});

it('says a copy is unsaved no later than it stores the first edit (#791)', async () => {
  const edits = { before: () => false, is: (origin: unknown) => origin === 'here' };
  const name = localBoardName('person', 'crash');
  const doc = new Y.Doc();
  const copy = await openLocalBoard(name, 'crash', doc, () => {}, edits);
  // An edit made here, and the tab crashes before anything else runs: never marked by hand.
  doc.transact(() => doc.getMap('meta').set('title', 'Before the crash'), 'here');
  await turn();
  expect(await unsavedLocalBoards('person')).toContain('crash');
  // Closing writes nothing more: the flag was stored with the edit.
  await copy.close();
  await sweepLocalBoards();
  expect(titleOf(await stored(name))).toBe('Before the crash');
  // Edits made before the copy opened are flagged before they are stored.
  const early = localBoardName('person', 'early');
  const edited = new Y.Doc();
  edited.getMap('meta').set('title', 'Typed while it opened');
  const opened = await openLocalBoard(early, 'early', edited, () => {}, {
    ...edits,
    before: () => true,
  });
  await opened.close();
  await sweepLocalBoards();
  expect(titleOf(await stored(early, 'early'))).toBe('Typed while it opened');
});
