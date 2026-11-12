// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { BoardWriters, BoardWritersQuery } from './versions.ts';

const item = { client: 0, clock: 0 };

it('takes 1 to 50 lookups of unsigned 32-bit client ids', () => {
  expect(BoardWritersQuery.safeParse({ items: [item] }).success).toBe(true);
  expect(BoardWritersQuery.safeParse({ items: [{ client: 4294967295 }] }).success).toBe(true);
  expect(BoardWritersQuery.safeParse({ items: Array(50).fill(item) }).success).toBe(true);
  expect(BoardWritersQuery.safeParse({ items: [] }).success).toBe(false);
  expect(BoardWritersQuery.safeParse({ items: Array(51).fill(item) }).success).toBe(false);
  expect(BoardWritersQuery.safeParse({ items: [{ client: 4294967296 }] }).success).toBe(false);
  expect(BoardWritersQuery.safeParse({ items: [{ client: -1 }] }).success).toBe(false);
  expect(BoardWritersQuery.safeParse({ items: [{ client: 1, clock: -1 }] }).success).toBe(false);
});

it('answers with one of the known kinds', () => {
  const answer = (kind: string) => ({
    items: [{ client: 7, kind, user: null, changedAt: null, lastSeenAt: null }],
  });
  for (const kind of ['user', 'server', 'deleted', 'unknown', 'contested'])
    expect(BoardWriters.safeParse(answer(kind)).success).toBe(true);
  expect(BoardWriters.safeParse(answer('someone')).success).toBe(false);
});
