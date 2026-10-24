// SPDX-License-Identifier: AGPL-3.0-only
import type { CommentThread } from '@inkadra/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  authorName,
  commentParts,
  editableText,
  encodeMentions,
  findThread,
  groupByDay,
  mentionQuery,
  mergeReplies,
  reviewKey,
} from './review-model.ts';
import { pinsByElement } from './review-store.ts';

const giulia = { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10', name: 'Giulia Bianchi', image: null };
const anna = { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a12', name: 'Anna', image: null };
const annaMaria = { id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a13', name: 'Anna Maria', image: null };
const stranger = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';

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
  expect(await findThread([thread], 'old', 'card', get)).toBe('t');
  expect(get.mock.calls).toEqual([
    ['t', null],
    ['t', 'next'],
  ]);
  get.mockClear();
  expect(await findThread([thread], 't', null, get)).toBe('t');
  expect(get).not.toHaveBeenCalled();
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
