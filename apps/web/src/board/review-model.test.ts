// SPDX-License-Identifier: AGPL-3.0-only
import { addElement, createBoardDoc, type Element } from '@inkadra/doc-schema';
import type { Comment, CommentThread } from '@inkadra/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { cardLabelOf } from './CommentsPanel.tsx';
import { fillFragment } from './note.tsx';
import {
  authorName,
  commentParts,
  editableText,
  encodeMentions,
  findThread,
  groupByDay,
  mentionQuery,
  mergeReplies,
  mergeThreads,
  refreshOlderReplies,
  reviewKey,
} from './review-model.ts';
import {
  addOlderReplies,
  getDraft,
  getReviews,
  pinsByElement,
  queueCommentScopes,
  resetReviews,
  saveDraft,
  takeCommentScopes,
} from './review-store.ts';
import { BoardStore } from './store.ts';

const giulia = { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10', name: 'Giulia Bianchi', image: null };
const anna = { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a12', name: 'Anna', image: null };
const annaMaria = { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a13', name: 'Anna Maria', image: null };
const stranger = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';

beforeEach(() => {
  resetReviews();
});

describe('mentions', () => {
  it('shows names only for the ids the server listed, and anything else as typed', () => {
    const body = `Ciao @{${giulia.id.toUpperCase()}}, @{${stranger}} e <b>`;
    expect(commentParts({ body, mentions: [giulia] })).toEqual([
      { text: 'Ciao ' },
      { mention: 'Giulia Bianchi' },
      { text: `, @{${stranger}} e <b>` },
    ]);
  });

  it('encodes only people picked from the suggestions, longest name first', () => {
    expect(encodeMentions('@Anna Maria e @Anna, non @Paolo', [anna, annaMaria])).toBe(
      `@{${annaMaria.id}} e @{${anna.id}}, non @Paolo`,
    );
  });

  it('encodes whole names only', () => {
    expect(encodeMentions('@Annalisa, x@Anna e @Anna.', [anna])).toBe(
      `@Annalisa, x@Anna e @{${anna.id}}.`,
    );
    const dotted = { ...anna, name: 'A.(B)' };
    expect(encodeMentions('@A.(B) @AX(B)', [dotted])).toBe(`@{${anna.id}} @AX(B)`);
  });

  it('gives back the body it was edited from', () => {
    const body = `@{${giulia.id}}: luce`;
    expect(encodeMentions(editableText({ body, mentions: [giulia] }), [giulia])).toBe(body);
  });

  it('knows when the caret is in a mention being typed', () => {
    expect(mentionQuery('Vedi @Giu', 9)).toBe('Giu');
    expect(mentionQuery('@', 1)).toBe('');
    expect(mentionQuery('mail@example', 12)).toBeNull();
    expect(mentionQuery('Vedi @Giu\nciao', 14)).toBeNull();
  });
});

it('merges older pages with the inline replies, oldest first, without duplicates', () => {
  const a = { id: 'a', createdAt: '2026-10-24T10:00:00Z' };
  const b = { id: 'b', createdAt: a.createdAt };
  const c = { id: 'c', createdAt: '2026-10-24T11:00:00Z' };
  expect(mergeReplies([b, a], [b, c])).toEqual([a, b, c]);
});

it('shows statuses and authors it does not know without breaking', () => {
  expect(reviewKey('approved')).toBe('approved');
  expect(reviewKey('future_value')).toBe('in_review');
  expect(authorName({ kind: 'guest', name: 'Cliente', guestId: 'g', shareLinkId: 'l' })).toBe(
    'Cliente',
  );
  expect(authorName(JSON.parse('{"kind":"future"}'))).toBeNull();
  expect(authorName(null)).toBeNull();
});

it('pages the replies of the notified card only to find an older reply', async () => {
  const thread = { id: 't', elementId: 'card', replyCount: 52, replies: [] } as never;
  const get = vi
    .fn()
    .mockResolvedValueOnce({ items: [], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [{ id: 'old' }], nextCursor: null });
  expect(await findThread([thread], 'old', 'other-card', get)).toBeNull();
  expect(get).not.toHaveBeenCalled();
  expect(await findThread([thread], 'old', 'card', get)).toEqual({
    threadId: 't',
    older: { items: [{ id: 'old' }], cursor: null },
  });
  expect(get.mock.calls).toEqual([
    ['t', null],
    ['t', 'next'],
  ]);
  get.mockClear();
  expect(await findThread([thread], 't', null, get)).toEqual({ threadId: 't' });
  expect(get).not.toHaveBeenCalled();
});

it('refreshes older replies for the fetched scopes and drops obsolete ones', async () => {
  const reply = (id: string, body: string, createdAt: string) =>
    ({ id, body, createdAt }) as unknown as Comment;
  addOlderReplies('t1', [reply('r1', 'prima', '2026-10-24T10:00:00Z')], 'earlier');
  addOlderReplies('t2', [reply('r2', 'altra', '2026-10-24T10:00:00Z')], null);
  addOlderReplies('t3', [reply('r3', 'corta', '2026-10-24T10:00:00Z')], null);

  const threads = [
    { id: 't1', elementId: 'card-a', replyCount: 52, replies: new Array(50) },
    { id: 't2', elementId: 'card-b', replyCount: 52, replies: new Array(50) },
    { id: 't3', elementId: 'card-a', replyCount: 1, replies: [reply('r3', 'corta', '')] },
  ] as unknown as CommentThread[];

  const get = vi.fn().mockResolvedValueOnce({
    items: [reply('r1', 'modificata', '2026-10-24T10:00:00Z')],
    nextCursor: 'earlier',
  });
  const updated = await refreshOlderReplies(
    threads,
    getReviews().olderReplies,
    new Set(['card-a']),
    get,
  );
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('t1', null);
  expect(updated.get('t1')?.items.map((r) => r.body)).toEqual(['modificata']);
  expect(updated.get('t2')?.items.map((r) => r.body)).toEqual(['altra']);
  expect(updated.has('t3')).toBe(false);
});

it('queues interrupted card scopes with newer notices instead of refetching everything', () => {
  expect(takeCommentScopes()).toBe('all');
  queueCommentScopes('card-a');
  const first = takeCommentScopes();
  expect(first).toEqual(new Set(['card-a']));

  // A notice for card-b arrives while card-a is in flight; card-a is re-queued on cleanup.
  queueCommentScopes('card-b');
  queueCommentScopes(first);
  expect(takeCommentScopes()).toEqual(new Set(['card-b', 'card-a']));

  // An interrupted full fetch stays a full fetch even if a card notice arrived meanwhile.
  queueCommentScopes('card-a');
  queueCommentScopes('all');
  queueCommentScopes('card-b');
  expect(takeCommentScopes()).toBe('all');
});

it('keeps separate drafts for each card and for the board', () => {
  saveDraft({ elementId: 'card-a', text: 'bozza A', picked: [anna], visibility: 'team' });
  saveDraft({ elementId: null, text: 'bozza board', picked: [], visibility: 'everyone' });
  // Opening card-b mounts an empty composer that clears only card-b's own scope.
  saveDraft(null, 'card-b');

  expect(getDraft('card-a')?.text).toBe('bozza A');
  expect(getDraft(null)?.text).toBe('bozza board');
  expect(getDraft('card-b')).toBeNull();

  saveDraft(null, 'card-a');
  expect(getDraft('card-a')).toBeNull();
  expect(getDraft(null)?.text).toBe('bozza board');
});

it('reads updated note text without waiting for the card object to change', () => {
  const doc = createBoardDoc('board');
  const noteId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20';
  addElement(doc, {
    id: noteId,
    type: 'note',
    x: 0,
    y: 0,
    w: 200,
    z: 'a0',
    parent: null,
    color: 'none',
    locked: false,
    tags: [],
    createdBy: giulia.id,
    createdAt: 1,
  });
  const store = new BoardStore(doc);
  const body = store.map(noteId)?.get('body') as Y.XmlFragment;
  fillFragment(body, 'Prima riga');
  const cache = new WeakMap<Element, string>();
  const cardBefore = store.getSnapshot().byId.get(noteId);

  expect(cardLabelOf(store.getSnapshot(), store, cache, (k) => k, noteId)).toBe('Prima riga');

  body.delete(0, body.length);
  fillFragment(body, 'Testo aggiornato');

  // Rich-text edits keep the same element object in the snapshot, yet the label updates.
  expect(store.getSnapshot().byId.get(noteId)).toBe(cardBefore);
  expect(cardLabelOf(store.getSnapshot(), store, cache, (k) => k, noteId)).toBe('Testo aggiornato');
  store.destroy();
});

it('replaces only the threads of the cards fetched again, newest first', () => {
  const t = (id: string, elementId: string | null, createdAt: string, body = '') =>
    ({ id, elementId, createdAt, body }) as unknown as CommentThread;
  const current = [
    t('c', 'card', '2026-10-24T12:00:00Z'),
    t('b', null, '2026-10-24T11:00:00Z'),
    t('a', 'card', '2026-10-24T10:00:00Z'),
    t('x', 'other', '2026-10-24T09:00:00Z'),
  ];
  const fetched = [
    t('d', 'card', '2026-10-24T13:00:00Z'),
    t('a', 'card', '2026-10-24T10:00:00Z', 'edited'),
  ];
  const merged = mergeThreads(current, fetched, new Set(['card']));
  expect(merged.map((x) => x.id)).toEqual(['d', 'b', 'a', 'x']);
  expect(merged.find((x) => x.id === 'a')?.body).toBe('edited');
  expect(mergeThreads(current, [], new Set([null])).map((x) => x.id)).toEqual(['c', 'a', 'x']);
});

it('numbers the pins of a card by age and leaves out resolved threads', () => {
  const t = (id: string, extra: Partial<CommentThread>) =>
    ({
      id,
      elementId: 'card',
      pin: { x: 0.5, y: 0.5 },
      resolvedAt: null,
      deletedAt: null,
      ...extra,
    }) as CommentThread;
  // The list comes newest first.
  const pins = pinsByElement([
    t('new', {}),
    t('done', { resolvedAt: '2026-10-24T10:00:00Z' }),
    t('board', { elementId: null }),
    t('plain', { pin: null }),
    t('old', {}),
  ]);
  expect(pins.get('card')?.map((x) => x.id)).toEqual(['old', 'new']);
  expect(pins.size).toBe(1);
});

it('groups by local day keeping the order', () => {
  const items = [
    { id: 1, createdAt: '2026-10-24T18:00:00Z' },
    { id: 2, createdAt: '2026-10-24T08:00:00Z' },
    { id: 3, createdAt: '2026-10-23T08:00:00Z' },
  ];
  const groups = groupByDay(items, (d) => d.toISOString().slice(0, 10));
  expect(groups.map(([day, list]) => [day, list.map((i) => i.id)])).toEqual([
    ['2026-10-24', [1, 2]],
    ['2026-10-23', [3]],
  ]);
});
