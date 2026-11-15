// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createElement, deleteElements } from '@inkadra/canvas-core';
import { CURRENT_SCHEMA_VERSION, createBoardDoc } from '@inkadra/doc-schema';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { installWebLocks } from '../test/web-locks.ts';
import {
  discardKept,
  dropLocalBoard,
  hasKept,
  KEPT_FILE_MAX_BYTES,
  keepAside,
  keptBoards,
  keptFile,
  keptFileUpdate,
  localBoardName,
  openLocalBoard,
  RestoreError,
  restorableUpdate,
  restoreAsNew,
  restoreConflict,
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

/** The reason a restore was refused, or undefined when it was not (#898). */
const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (err) {
    return err instanceof RestoreError ? err.reason : 'thrown';
  }
};

it('restores a downloaded file only into its own board, and only a file it made (#898)', async () => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('title', 'From the file');
  await keepAside('restorer', 'board', doc);
  const text = await (await keptFile('restorer', 'board')).blob.text();
  const into = new Y.Doc();
  Y.applyUpdate(into, keptFileUpdate(text, 'board'));
  expect(titleOf(into)).toBe('From the file');
  expect(refusal(() => keptFileUpdate(text, 'another'))).toBe('otherBoard');
  expect(refusal(() => keptFileUpdate('not json', 'board'))).toBe('invalid');
  expect(refusal(() => keptFileUpdate('{"format":"inkadra-board"}', 'board'))).toBe('invalid');
  const file = { format: 'inkadra-kept-changes', version: 1, boardId: 'board', update: '!!' };
  expect(refusal(() => keptFileUpdate(JSON.stringify(file), 'board'))).toBe('invalid');
  expect(refusal(() => keptFileUpdate(JSON.stringify({ ...file, version: 2 }), 'board'))).toBe(
    'tooNew',
  );
});

/** A board and the copy of it set aside on a device, which share its history (#898). */
function sharedBoard(keptClient: number, boardClient: number) {
  const base = createBoardDoc('board');
  const opts = { userId: 'someone' };
  const note = createElement(base, 'note', { x: 0, y: 0 }, {}, opts);
  const other = createElement(base, 'note', { x: 400, y: 0 }, {}, opts);
  const copy = (clientID: number) => {
    const doc = new Y.Doc();
    doc.clientID = clientID;
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(base));
    return doc;
  };
  const card = (doc: Y.Doc, id: string) => doc.getMap<Y.Map<unknown>>('elements').get(id);
  return { kept: copy(keptClient), board: copy(boardClient), note: note.id, other: other.id, card };
}

it('says what merging edits set aside would lose: a card deleted on the board since (#898)', () => {
  const { kept, board, note, card } = sharedBoard(1, 2);
  card(kept, note)?.set('x', 120);
  // Someone deleted the card to make room while the edit was set aside.
  deleteElements(board, [note]);
  const update = Y.encodeStateAsUpdate(kept);
  const conflict = restoreConflict(board, update);
  expect(conflict).toMatchObject({ deleted: [note], changed: [], older: false, cards: [note] });
  // What a blind merge did: the edit integrates as deleted, and nothing says so.
  Y.applyUpdate(board, update);
  expect(card(board, note)).toBeUndefined();
});

it('says what merging edits set aside would lose or overwrite in a field written since (#898)', () => {
  // The board's write wins (its client sorts last): the edit set aside would be lost.
  const lost = sharedBoard(1, 2);
  lost.card(lost.kept, lost.note)?.set('x', 120);
  lost.card(lost.board, lost.note)?.set('x', 300);
  expect(restoreConflict(lost.board, Y.encodeStateAsUpdate(lost.kept))).toMatchObject({
    deleted: [],
    changed: [lost.note],
  });
  // The edit set aside wins: the newer write on the board would be overwritten.
  const over = sharedBoard(3, 2);
  over.card(over.kept, over.note)?.set('x', 120);
  over.card(over.board, over.note)?.set('x', 300);
  expect(restoreConflict(over.board, Y.encodeStateAsUpdate(over.kept))).toMatchObject({
    changed: [over.note],
  });
  // The same value written on both sides loses nothing.
  const same = sharedBoard(1, 2);
  same.card(same.kept, same.note)?.set('x', 120);
  same.card(same.board, same.note)?.set('x', 120);
  expect(restoreConflict(same.board, Y.encodeStateAsUpdate(same.kept))).toBeNull();
});

it('merges edits set aside that lose nothing, beside other edits made since (#898)', () => {
  const { kept, board, note, other, card } = sharedBoard(1, 2);
  card(kept, note)?.set('x', 120);
  card(board, other)?.set('x', 500);
  const update = Y.encodeStateAsUpdate(kept);
  expect(restoreConflict(board, update)).toBeNull();
  Y.applyUpdate(board, update);
  expect(card(board, note)?.get('x')).toBe(120);
  expect(card(board, other)?.get('x')).toBe(500);
});

it('restores the cards of edits set aside as new ones, leaving the board as it is (#898)', () => {
  const { kept, board, note, other, card } = sharedBoard(1, 2);
  card(kept, note)?.set('x', 120);
  deleteElements(board, [note]);
  card(board, other)?.set('x', 500);
  const update = Y.encodeStateAsUpdate(kept);
  const conflict = restoreConflict(board, update);
  const ids = restoreAsNew(board, update, conflict?.cards ?? [], {
    boardId: 'board',
    userId: 'me',
  });
  expect(ids).toHaveLength(1);
  expect(ids[0]).not.toBe(note);
  expect(card(board, ids[0] ?? '')?.get('x')).toBe(120);
  expect(card(board, note)).toBeUndefined();
  expect(card(board, other)?.get('x')).toBe(500);
  // A card still on the board: the copy lands beside it, not over it.
  const [beside] = restoreAsNew(board, update, [other], { boardId: 'board', userId: 'me' });
  expect(card(board, beside ?? '')?.get('x')).toBe(424);
  expect(card(board, beside ?? '')?.get('y')).toBe(24);
});

it('refuses newer edits set aside and those missing what they build on (#898)', () => {
  const ahead = new Y.Doc();
  ahead.getMap('meta').set('schemaVersion', CURRENT_SCHEMA_VERSION + 1);
  expect(refusal(() => restorableUpdate(Y.encodeStateAsUpdate(ahead)))).toBe('tooNew');
  const doc = new Y.Doc();
  doc.getText('text').insert(0, 'abc');
  const first = Y.encodeStateVector(doc);
  doc.getText('text').insert(3, 'def');
  // Without the first insertion, the second builds on what is not there.
  const partial = Y.encodeStateAsUpdate(doc, first);
  expect(refusal(() => restorableUpdate(partial))).toBe('invalid');
});

it('refuses a file larger than a board can be, before decoding it (#898)', () => {
  const update = 'A'.repeat(Math.ceil((KEPT_FILE_MAX_BYTES / 3) * 4) + 4);
  const file = { format: 'inkadra-kept-changes', version: 1, boardId: 'board', update };
  expect(refusal(() => keptFileUpdate(JSON.stringify(file), 'board'))).toBe('tooBig');
});

it('does not merge edits set aside under an older schema, and restores them as new cards (#898)', () => {
  const old = createBoardDoc('board');
  const card = createElement(old, 'note', { x: 40, y: 60 }, {}, { userId: 'me' });
  old.getMap('meta').set('schemaVersion', CURRENT_SCHEMA_VERSION - 1);
  const board = createBoardDoc('board');
  const update = restorableUpdate(Y.encodeStateAsUpdate(old));
  const conflict = restoreConflict(board, update);
  expect(conflict).toMatchObject({ older: true, cards: [card.id] });
  const [id] = restoreAsNew(board, update, conflict?.cards ?? [], {
    boardId: 'board',
    userId: 'me',
  });
  expect(id).toBeDefined();
  const copy = board.getMap<Y.Map<unknown>>('elements').get(id ?? '');
  expect(copy?.get('x')).toBe(40);
  expect(board.getMap('meta').get('schemaVersion')).toBe(CURRENT_SCHEMA_VERSION);
});
