import type { Author, UserSummary } from '@inkadra/shared';
import { eq, inArray } from 'drizzle-orm';
import { type Actor, boardRoles } from '../access.ts';
import type { Database } from '../db/client.ts';
import { shareGuest, shareLink, user } from '../db/schema.ts';

/** Longest share link label sent, like the limit on writing one (decision 0013). */
export const MAX_LINK_LABEL = 80;

/**
 * Accounts, guests and share link labels named in an answer, loaded once for all its rows.
 * Only for answers to people with a role on the board: guests never receive link labels.
 * A label is kept only when the viewer has a role on the board of its link: someone granted
 * a sub-board alone does not learn the labels of links shared from a board above it.
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
  viewer: Pick<Actor, 'id'>,
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
            boardId: shareLink.boardId,
          })
          .from(shareGuest)
          .leftJoin(shareLink, eq(shareLink.id, shareGuest.shareLinkId))
          .where(inArray(shareGuest.id, g)),
    l.length === 0
      ? []
      : db
          .select({ id: shareLink.id, label: shareLink.label, boardId: shareLink.boardId })
          .from(shareLink)
          .where(inArray(shareLink.id, l)),
  ]);
  const labelled = [
    ...guests.map((r) => ({ id: r.shareLinkId, label: linkLabel(r.label), boardId: r.boardId })),
    ...links.map((r) => ({ id: r.id, label: linkLabel(r.label), boardId: r.boardId })),
  ];
  const named = labelled.flatMap((r) => (r.label && r.boardId ? [r.boardId] : []));
  const readable = named.length === 0 ? new Map() : await boardRoles(db, viewer, named);
  return {
    users: new Map(users.map((r) => [r.id, r])),
    guests: new Map(guests.map((r) => [r.id, { name: r.name, shareLinkId: r.shareLinkId }])),
    links: new Map(
      labelled.map((r) => [r.id, r.boardId && readable.has(r.boardId) ? r.label : null]),
    ),
  };
}

/**
 * Label of a link for the team; null without a link, once it is gone, without a label, or
 * when the viewer has no role on the board of the link.
 */
export function labelOf(people: People, linkId: string | null | undefined): string | null {
  return linkId ? (people.links.get(linkId) ?? null) : null;
}

/**
 * Who wrote or changed something, as the team sees it. A deleted account, or a guest whose
 * name retention has cleared, has no author to show. A guest comes with the label of their
 * link, which people with a role on the link's board may read even when they cannot list links.
 */
export function authorOf(
  people: People,
  userId: string | null | undefined,
  guestId: string | null | undefined,
  /** Came with an imported project: the author's name there, shown instead (decision 0037). */
  importedAuthor?: string | null,
): Author {
  if (importedAuthor) return { kind: 'imported', name: importedAuthor };
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
