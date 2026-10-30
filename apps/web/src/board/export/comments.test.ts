import type { CommentThread } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { commentEntries } from './comments.ts';

const user = { kind: 'user', user: { id: 'u1', name: 'Giulia', image: null } } as const;
const guest = { kind: 'guest', guestId: 'g1', name: 'Client', shareLinkId: 'l1' } as const;

function thread(id: string, fields: Partial<CommentThread> = {}): CommentThread {
  return {
    id,
    boardId: 'b1',
    elementId: 'card0001',
    parentId: null,
    pin: null,
    createdAt: `2026-10-30T10:0${id.length % 10}:00.000Z`,
    author: user,
    body: `Body ${id}`,
    mentions: [],
    visibility: 'everyone',
    shareLinkId: null,
    resolvedAt: null,
    resolvedBy: null,
    replyCount: 0,
    replies: [],
    ...fields,
  } as unknown as CommentThread;
}
const reply = (body: string, author: CommentThread['author'] = user) =>
  ({ ...thread('r'), body, author, parentId: 't' }) as unknown as CommentThread['replies'][number];

const options = (audience: 'client' | 'team') => ({
  audience,
  shown: new Set(['card0001']),
  exists: (id: string) => id === 'card0001' || id === 'hidden01',
  label: () => '1A',
  date: (iso: string) => iso.slice(0, 10),
  words: {
    onBoard: 'On the board',
    onCard: (l: string) => `On ${l}`,
    removedCard: 'On a removed card',
    deleted: 'Comment deleted',
    deletedAuthor: 'Deleted account',
  },
});

describe('commentEntries', () => {
  it('keeps for clients only threads open to every link, without guests', () => {
    const threads = [
      thread('team', { visibility: 'team' }),
      thread('one-link', { shareLinkId: 'l2' }),
      thread('by-guest', { author: guest }),
      thread('open', { replies: [reply('From the team'), reply('From a guest', guest)] }),
    ];
    const out = commentEntries(threads, options('client'));
    expect(out.map((e) => e.body)).toEqual(['Body open']);
    expect(out[0]?.replies.map((r) => r.body)).toEqual(['From the team']);
    expect(commentEntries(threads, options('team'))).toHaveLength(4);
  });

  it('keeps a deleted start with readable replies as a placeholder', () => {
    const out = commentEntries(
      [thread('gone', { body: '', replies: [reply('Still here')] }), thread('empty', { body: '' })],
      options('client'),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ body: 'Comment deleted', author: '' });
  });

  it('leaves out threads on cards the export does not show', () => {
    const threads = [
      thread('hidden', { elementId: 'hidden01' }),
      thread('removed', { elementId: 'gone0001' }),
      thread('board', { elementId: null }),
    ];
    expect(commentEntries(threads, options('client')).map((e) => e.target)).toEqual([
      'On the board',
    ]);
    // The team still sees threads about removed cards, not those of cards left out.
    expect(commentEntries(threads, options('team')).map((e) => e.target)).toEqual([
      'On the board',
      'On a removed card',
    ]);
  });

  it('writes mentions with names', () => {
    const t = thread('m', {
      body: 'Ask @{u2}',
      mentions: [{ id: 'u2', name: 'Luca', image: null }],
    });
    expect(commentEntries([t], options('team'))[0]?.body).toBe('Ask @Luca');
  });
});
