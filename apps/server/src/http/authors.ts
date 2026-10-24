import type { Author, UserSummary } from '@inkadra/shared';
import { inArray } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { shareGuest, user } from '../db/schema.ts';

/** Accounts and guests named in an answer, loaded once for all its rows. */
export interface People {
  users: Map<string, UserSummary>;
  guests: Map<string, { name: string | null; shareLinkId: string }>;
}

const ids = (values: Iterable<string | null | undefined>) => [
  ...new Set([...values].filter((v): v is string => !!v)),
];

export async function loadPeople(
  db: Database,
  userIds: Iterable<string | null | undefined>,
  guestIds: Iterable<string | null | undefined> = [],
): Promise<People> {
  const u = ids(userIds);
  const g = ids(guestIds);
  const [users, guests] = await Promise.all([
    u.length === 0
      ? []
      : db
          .select({ id: user.id, name: user.name, image: user.image })
          .from(user)
          .where(inArray(user.id, u)),
    g.length === 0
      ? []
      : db
          .select({ id: shareGuest.id, name: shareGuest.name, shareLinkId: shareGuest.shareLinkId })
          .from(shareGuest)
          .where(inArray(shareGuest.id, g)),
  ]);
  return {
    users: new Map(users.map((r) => [r.id, r])),
    guests: new Map(guests.map((r) => [r.id, { name: r.name, shareLinkId: r.shareLinkId }])),
  };
}

/**
 * Who wrote or changed something, as the team sees it. A deleted account, or a guest whose
 * name retention has cleared, has no author to show.
 */
export function authorOf(
  people: People,
  userId: string | null | undefined,
  guestId: string | null | undefined,
): Author {
  if (userId) {
    const u = people.users.get(userId);
    if (u) return { kind: 'user', user: u };
  }
  if (guestId) {
    const g = people.guests.get(guestId);
    if (g?.name) return { kind: 'guest', guestId, name: g.name, shareLinkId: g.shareLinkId };
  }
  return { kind: 'deleted' };
}
