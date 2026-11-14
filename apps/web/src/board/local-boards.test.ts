// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CURRENT_SCHEMA_VERSION } from '@inkadra/doc-schema';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { installWebLocks } from '../test/web-locks.ts';
import {
  dropLocalBoard,
  keepAside,
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
