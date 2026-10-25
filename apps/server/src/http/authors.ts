import type { Author, UserSummary } from '@inkadra/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { shareGuest, shareLink, user } from '../db/schema.ts';

/** Longest share link label sent, like the limit on writing one (decision 0013). */
export const MAX_LINK_LABEL = 80;

/**
 * Accounts, guests and share link labels named in an answer, loaded once for all its rows.
 * Only for answers to people with a role on the board: guests never receive link labels.
 */
export interface People {
  users: Map<string, UserSummary>;
  guests: Map<string, { name: string | null; shareLinkId: string }>;
  /** Label of each link named in the answer or behind one of its guests; null without one. */
  links: Map<string, string | null>;
}

const ids = (values: Iterable<string | null | undefined>) => [
  ...new Set([...values].filter((v): v is string => !!v)),
];

/** A stored label as sent: trimmed, null when empty, at most MAX_LINK_LABEL characters. */
export function linkLabel(label: string | null | undefined): string | null {
  const text = label?.trim();
  if (!text) return null;
  const chars = [...text];
  return chars.length > MAX_LINK_LABEL ? chars.slice(0, MAX_LINK_LABEL).join('').trim() : text;
}

export async function loadPeople(
  db: Database,
  userIds: Iterable<string | null | undefined>,
  guestIds: Iterable<string | null | undefined> = [],
  linkIds: Iterable<string | null | undefined> = [],
): Promise<People> {
  const u = ids(userIds);
  const g = ids(guestIds);
  const l = ids(linkIds);
  const [users, guests, links] = await Promise.all([
    u.length === 0
      ? []
      : db
          .select({ id: user.id, name: user.name, image: user.image })
          .from(user)
          .where(inArray(user.id, u)),
    g.length === 0
      ? []
      : db
          .select({
            id: shareGuest.id,
            name: shareGuest.name,
            shareLinkId: shareGuest.shareLinkId,
            label: shareLink.label,
          })
          .from(shareGuest)
          .leftJoin(shareLink, eq(shareLink.id, shareGuest.shareLinkId))
          .where(inArray(shareGuest.id, g)),
    l.length === 0
      ? []
      : db
          .select({ id: shareLink.id, label: shareLink.label })
          .from(shareLink)
          .where(inArray(shareLink.id, l)),
  ]);
  return {
    users: new Map(users.map((r) => [r.id, r])),
    guests: new Map(guests.map((r) => [r.id, { name: r.name, shareLinkId: r.shareLinkId }])),
    links: new Map([
      ...guests.map((r) => [r.shareLinkId, linkLabel(r.label)] as const),
      ...links.map((r) => [r.id, linkLabel(r.label)] as const),
    ]),
  };
}

/** Label of a link for the team; null without a link, once it is gone, or without a label. */
export function labelOf(people: People, linkId: string | null | undefined): string | null {
  return linkId ? (people.links.get(linkId) ?? null) : null;
}

/**
 * Who wrote or changed something, as the team sees it. A deleted account, or a guest whose
 * name retention has cleared, has no author to show. A guest comes with the label of their
 * link, which people with a role on the board may read even when they cannot list links.
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
    if (g?.name)
      return {
        kind: 'guest',
        guestId,
        name: g.name,
        shareLinkId: g.shareLinkId,
        shareLinkLabel: labelOf(people, g.shareLinkId),
      };
  }
  return { kind: 'deleted' };
}
