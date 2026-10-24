import type { Element } from '@inkadra/doc-schema';
import { API_PREFIX, GUEST_COOKIE, GUEST_SESSION_DAYS, type GuestDenied } from '@inkadra/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type GuestAction, guestCan } from '../access.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { shareGuest, shareLink } from '../db/schema.ts';
import { readCookie } from '../invitations.ts';
import { newSecret, sha256 } from '../secrets.ts';
import {
  type DocViews,
  type LinkBoard,
  linkElements,
  resolveLink,
  type ShareLinkRow,
} from '../share-links.ts';
import { HttpError } from './errors.ts';
import { RateLimiter } from './link-previews.ts';

export type GuestRow = typeof shareGuest.$inferSelect;

/** A guest request that passed every check of decision 0013, with what the link shows now. */
export interface GuestContext {
  link: ShareLinkRow;
  guest: GuestRow;
  boards: Map<string, LinkBoard>;
  /** Per request: elements guests see on each board of the link. */
  shown: Map<string, Element[]>;
}

const DAY = 86_400_000;
const SESSION_MS = GUEST_SESSION_DAYS * DAY;
/** The sliding expiry moves forward at most this often, so polls write nothing. */
const SLIDE_MS = 60 * 60_000;

export const guestDenied = (
  code: 'unauthorized' | 'forbidden',
  reason: GuestDenied['reason'],
  message: string,
) => new HttpError(code, message, { reason } satisfies GuestDenied);

/** 403 for a link that stopped working, with the reason guests may know. */
export function linkStopped(status: 'expired' | 'revoked' | 'suspended') {
  if (status === 'expired') return guestDenied('forbidden', 'expired', 'This link has expired.');
  if (status === 'revoked')
    return guestDenied('forbidden', 'revoked', 'This link is no longer active.');
  // Guests are not told why.
  return guestDenied('forbidden', 'unavailable', 'This link is not available.');
}

export const guestPath = (linkId: string) => `${API_PREFIX}/guest/links/${linkId}`;

export function createGuestAuth(deps: { config: Config; db: Database; docs: DocViews }) {
  const { config, db, docs } = deps;
  const secure = config.PUBLIC_URL.startsWith('https://');
  const cookieName = secure ? `__Secure-${GUEST_COOKIE}` : GUEST_COOKIE;
  const writes = new RateLimiter(60, 60_000);

  /** Never beyond the link's expiry. */
  const sessionEnd = (link: ShareLinkRow, now: Date) =>
    new Date(Math.min(now.getTime() + SESSION_MS, link.expiresAt?.getTime() ?? Infinity));

  function setCookie(reply: FastifyReply, linkId: string, token: string | null, until?: Date) {
    const maxAge =
      token && until ? Math.max(0, Math.floor((until.getTime() - Date.now()) / 1000)) : 0;
    const parts = [
      `${cookieName}=${token ?? ''}`,
      `Path=${guestPath(linkId)}`,
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAge}`,
      ...(secure ? ['Secure'] : []),
    ];
    reply.header('set-cookie', parts.join('; '));
  }

  const cookieToken = (req: FastifyRequest) => readCookie(req.headers.cookie, cookieName);

  /** The guest the request's cookie belongs to, on this link, whatever their session state. */
  async function cookieGuest(req: FastifyRequest, linkId: string): Promise<GuestRow | null> {
    const token = cookieToken(req);
    if (!token) return null;
    const [row] = await db
      .select()
      .from(shareGuest)
      .where(and(eq(shareGuest.tokenHash, sha256(token)), eq(shareGuest.shareLinkId, linkId)));
    return row ?? null;
  }

  /** Starts a session for a guest (new or returning): a new cookie token, a fresh expiry. */
  async function startSession(
    reply: FastifyReply,
    link: ShareLinkRow,
    guest: GuestRow | null,
    name: string | undefined,
    writer: Pick<Database, 'update' | 'insert'> = db,
  ): Promise<GuestRow> {
    const now = new Date();
    const token = newSecret('', 32);
    const until = sessionEnd(link, now);
    const values = {
      tokenHash: sha256(token),
      authenticatedAt: now,
      sessionExpiresAt: until,
      lastSeenAt: now,
      ...(name ? { name } : {}),
    };
    const [row] = guest
      ? await writer.update(shareGuest).set(values).where(eq(shareGuest.id, guest.id)).returning()
      : await writer
          .insert(shareGuest)
          .values({ shareLinkId: link.id, ...values })
          .returning();
    if (!row) throw new Error('Guest not saved');
    setCookie(reply, link.id, token, until);
    return row;
  }

  /**
   * Checks a guest request: a cookie of a guest of this link, a link that still works for its
   * creator, a session that has not expired nor predates a password change. Slides the session.
   */
  async function requireGuest(
    req: FastifyRequest,
    reply: FastifyReply,
    linkId: string,
  ): Promise<GuestContext> {
    const [link] = await db.select().from(shareLink).where(eq(shareLink.id, linkId));
    if (!link) throw new HttpError('not_found', 'Share link not found.');
    const guest = await cookieGuest(req, link.id);
    if (!guest) throw guestDenied('unauthorized', 'no_session', 'Open the link again to continue.');
    const now = new Date();
    const resolved = await resolveLink(db, docs, link, now);
    if (resolved.status !== 'active') throw linkStopped(resolved.status);
    if (guest.sessionExpiresAt <= now)
      throw guestDenied('unauthorized', 'no_session', 'Open the link again to continue.');
    if (guest.authenticatedAt < link.sessionsValidAfter)
      throw guestDenied('forbidden', 'password_required', 'The password of this link changed.');
    let current = guest;
    if (now.getTime() - guest.lastSeenAt.getTime() >= SLIDE_MS) {
      const until = sessionEnd(link, now);
      const [slid] = await db
        .update(shareGuest)
        .set({ lastSeenAt: now, sessionExpiresAt: until })
        .where(eq(shareGuest.id, guest.id))
        .returning();
      current = slid ?? guest;
      const token = cookieToken(req);
      if (token) setCookie(reply, link.id, token, until);
    }
    return { link, guest: current, boards: resolved.boards, shown: new Map() };
  }

  /** Elements guests see on a board of the link. */
  async function shown(ctx: GuestContext, boardId: string): Promise<Element[]> {
    const known = ctx.shown.get(boardId);
    if (known) return known;
    const elements = linkElements(await docs.get(db, boardId), ctx.boards);
    ctx.shown.set(boardId, elements);
    return elements;
  }

  /** A visible element of a board of the link, else 404 (hidden cards included). */
  async function requireElement(ctx: GuestContext, boardId: string, elementId: string) {
    const el = (await shown(ctx, boardId)).find((e) => e.id === elementId);
    if (!el) throw new HttpError('not_found', 'Card not found.');
    return el;
  }

  return {
    cookieName,
    setCookie,
    cookieGuest,
    startSession,
    requireGuest,

    /** Throws 403 unless the guest's link allows the action. */
    requireCan(ctx: GuestContext, action: GuestAction) {
      if (!guestCan(ctx.link, action))
        throw new HttpError('forbidden', 'This link does not allow that.');
    },

    /** Comments, reviews and picks carry the guest's name. */
    requireName(ctx: GuestContext) {
      if (!ctx.guest.name)
        throw guestDenied('forbidden', 'name_required', 'Enter your name first.');
    },

    /** Guest writes: 60 a minute per guest. */
    takeWrite(ctx: GuestContext) {
      if (!writes.take(ctx.guest.id))
        throw new HttpError('rate_limited', 'Too many changes: wait a minute.');
    },

    /** A board of the link, else 404. */
    requireBoard(ctx: GuestContext, boardId: string): LinkBoard {
      const found = ctx.boards.get(boardId);
      if (!found) throw new HttpError('not_found', 'Board not found.');
      return found;
    },

    shown,
    requireElement,
  };
}

export type GuestAuth = ReturnType<typeof createGuestAuth>;
