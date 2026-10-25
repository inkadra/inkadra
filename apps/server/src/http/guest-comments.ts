import {
  API_PREFIX,
  type CommentCount,
  CommentQuery,
  type GuestAuthor,
  type GuestComment,
  type GuestCommentThread,
  GuestCreateComment,
  GuestUpdateComment,
  Id,
  INLINE_REPLIES,
  ReplyQuery,
  renderMentions,
  z,
} from '@inkadra/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { boardAccess } from '../access.ts';
import type { Database } from '../db/client.ts';
import { comment, shareGuest, user } from '../db/schema.ts';
import { iso } from './api-routes.ts';
import { HttpError } from './errors.ts';
import type { GuestAuth, GuestContext } from './guest-context.ts';
import { RateLimiter } from './link-previews.ts';

/**
 * Comments as guests of a share link see and write them (decision 0013): only `everyone`
 * threads for every link or for theirs, about the board or a card they can see, and within
 * them only replies of the team or of their own link.
 */

type CommentRow = typeof comment.$inferSelect;

/** What a guest write tells the team about; see afterGuestWrite in guest-routes.ts. */
export type GuestCommentEvent = {
  kind: 'comment';
  projectId: string;
  action: 'created' | 'edited' | 'deleted';
  boardId: string;
  elementId: string | null;
  commentId: string;
  threadId: string;
  guestId: string;
};

const BoardParams = z.object({ linkId: Id, boardId: Id });
const CommentParams = z.object({ linkId: Id, commentId: Id });

/** Replies a guest may read: of the team (no link) or of their own link. */
const replyOfLink = (linkId: string) =>
  or(isNull(comment.shareLinkId), eq(comment.shareLinkId, linkId));

/** SQL for: the thread `comment` has at least one reply guests of the link may read. */
const hasReadableReply = (linkId: string) => sql`exists (
  select 1 from ${comment} r
  where r.thread_id = ${comment.id} and (r.share_link_id is null or r.share_link_id = ${linkId}))`;

/**
 * Thread starts guests of the link may read on a board: `everyone`, for every link or this
 * one, about the board or a visible card, and not an empty placeholder for them.
 */
function readableThreads(linkId: string, boardId: string, visibleIds: string[]): SQL {
  return and(
    eq(comment.boardId, boardId),
    isNull(comment.threadId),
    eq(comment.visibility, 'everyone'),
    or(isNull(comment.shareLinkId), eq(comment.shareLinkId, linkId)),
    visibleIds.length > 0
      ? or(isNull(comment.elementId), inArray(comment.elementId, visibleIds))
      : isNull(comment.elementId),
    or(isNull(comment.deletedAt), hasReadableReply(linkId)),
  ) as SQL;
}

const cursorKey = sql<string>`to_char(${comment.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const encodeCursor = (key: string, id: string) => Buffer.from(`${key}|${id}`).toString('base64url');

function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id, extra] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (
    !at ||
    !id ||
    extra !== undefined ||
    !Id.safeParse(id).success ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(at) ||
    Number.isNaN(Date.parse(at)) ||
    new Date(at).toISOString().slice(0, 19) !== at.slice(0, 19)
  )
    throw new HttpError('bad_request', 'Invalid cursor.');
  return { at, id };
}

/** Threads this guest can read, per visible card and for the board. */
export async function guestCommentCounts(
  db: Database,
  ctx: GuestContext,
  boardId: string,
  visibleIds: string[],
): Promise<CommentCount[]> {
  const rows = await db
    .select({
      elementId: comment.elementId,
      open: sql<number>`count(*) filter (where ${comment.resolvedAt} is null)`.mapWith(Number),
      resolved: sql<number>`count(*) filter (where ${comment.resolvedAt} is not null)`.mapWith(
        Number,
      ),
    })
    .from(comment)
    .where(readableThreads(ctx.link.id, boardId, visibleIds))
    .groupBy(comment.elementId);
  return rows.sort((a, b) => (a.elementId ?? '').localeCompare(b.elementId ?? ''));
}

/** Includes edits and replies, even when the thread counts in the snapshot stay the same. */
export async function guestCommentVersion(
  db: Database,
  ctx: GuestContext,
  boardId: string,
  visibleIds: string[],
) {
  const threads = db
    .select({ id: comment.id })
    .from(comment)
    .where(readableThreads(ctx.link.id, boardId, visibleIds));
  return db
    .select({
      id: comment.id,
      updatedAt: sql<string>`${comment.updatedAt}::text`,
      userName: user.name,
      guestName: shareGuest.name,
    })
    .from(comment)
    .leftJoin(user, eq(user.id, comment.authorId))
    .leftJoin(shareGuest, eq(shareGuest.id, comment.authorGuestId))
    .where(
      and(
        or(inArray(comment.id, threads), inArray(comment.threadId, threads)),
        replyOfLink(ctx.link.id),
      ),
    )
    .orderBy(asc(comment.id));
}

/** Names guests may see on a page of comments. */
async function namesFor(db: Database, ctx: GuestContext, boardId: string, rows: CommentRow[]) {
  const userIds = new Set<string>();
  const guestIds = new Set<string>();
  const mentioned = new Set<string>();
  for (const r of rows) {
    if (r.authorId) userIds.add(r.authorId);
    if (r.resolvedBy) userIds.add(r.resolvedBy);
    if (r.authorGuestId) guestIds.add(r.authorGuestId);
    if (r.authorId) for (const m of r.mentions) mentioned.add(m);
  }
  const all = [...new Set([...userIds, ...mentioned])];
  const [users, guests] = await Promise.all([
    all.length > 0
      ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, all))
      : [],
    guestIds.size > 0
      ? db
          .select({ id: shareGuest.id, name: shareGuest.name })
          .from(shareGuest)
          // Guests of other links never appear, even by mistake.
          .where(
            and(inArray(shareGuest.id, [...guestIds]), eq(shareGuest.shareLinkId, ctx.link.id)),
          )
      : [],
  ]);
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  // Mentions show only people who can still read the board; the others become `@…`.
  const mentionNames = new Map<string, string>();
  for (const id of mentioned) {
    const name = userNames.get(id);
    if (!name) continue;
    const access = await boardAccess(db, { id }, boardId);
    if (access?.role) mentionNames.set(id, name);
  }
  return { userNames, guestNames: new Map(guests.map((g) => [g.id, g.name])), mentionNames };
}

type Names = Awaited<ReturnType<typeof namesFor>>;

function toGuestComment(row: CommentRow, ctx: GuestContext, names: Names): GuestComment {
  const mine = row.authorGuestId === ctx.guest.id;
  let author: GuestAuthor;
  if (row.authorId)
    author = { kind: 'team', name: names.userNames.get(row.authorId) ?? null, isYou: false };
  else if (row.authorGuestId)
    author = { kind: 'guest', name: names.guestNames.get(row.authorGuestId) ?? null, isYou: mine };
  else author = { kind: 'deleted', name: null, isYou: false };
  // Guests cannot mention: what a guest typed stays as typed. Team mentions become names.
  const body = row.deletedAt
    ? ''
    : row.authorId
      ? renderMentions(row.body, names.mentionNames)
      : row.body;
  return {
    id: row.id,
    boardId: row.boardId,
    elementId: row.elementId,
    parentId: row.threadId,
    pin: row.pin ?? null,
    createdAt: iso(row.createdAt),
    editedAt: row.editedAt ? iso(row.editedAt) : null,
    deletedAt: row.deletedAt ? iso(row.deletedAt) : null,
    author,
    body,
    canEdit: mine && !row.deletedAt,
    canDelete: mine && !row.deletedAt,
  };
}

export function registerGuestCommentRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    guests: GuestAuth;
    afterWrite: (event: GuestCommentEvent) => Promise<void>;
  },
) {
  const { db, guests, afterWrite } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  const perGuest = new RateLimiter(30, 60 * 60_000);
  const perLink = new RateLimiter(300, 60 * 60_000);

  const visibleIds = async (ctx: GuestContext, boardId: string) =>
    (await guests.shown(ctx, boardId)).map((e) => e.id);

  /** A thread start this guest can read, on a board of the link; else 404. */
  async function readableThread(ctx: GuestContext, threadId: string): Promise<CommentRow> {
    const [row] = await db.select().from(comment).where(eq(comment.id, threadId));
    if (!row || !ctx.boards.has(row.boardId))
      throw new HttpError('not_found', 'Comment not found.');
    const [ok] = await db
      .select({ id: comment.id })
      .from(comment)
      .where(
        and(
          eq(comment.id, threadId),
          readableThreads(ctx.link.id, row.boardId, await visibleIds(ctx, row.boardId)),
        ),
      );
    if (!ok) throw new HttpError('not_found', 'Comment not found.');
    return row;
  }

  /** A comment this guest wrote, still readable by them; else 404. */
  async function ownComment(ctx: GuestContext, commentId: string): Promise<CommentRow> {
    const [row] = await db.select().from(comment).where(eq(comment.id, commentId));
    if (
      !row ||
      row.authorGuestId !== ctx.guest.id ||
      row.shareLinkId !== ctx.link.id ||
      row.deletedAt
    )
      throw new HttpError('not_found', 'Comment not found.');
    await readableThread(ctx, row.threadId ?? row.id);
    return row;
  }

  /** The latest replies this guest can read of each thread, oldest first, and their number. */
  async function repliesOf(ctx: GuestContext, threadIds: string[]) {
    if (threadIds.length === 0)
      return { replies: new Map<string, CommentRow[]>(), counts: new Map<string, number>() };
    const where = and(inArray(comment.threadId, threadIds), replyOfLink(ctx.link.id));
    const ranked = db
      .select({
        id: comment.id,
        rn: sql<number>`row_number() over (partition by ${comment.threadId} order by ${comment.createdAt} desc, ${comment.id} desc)`.as(
          'rn',
        ),
      })
      .from(comment)
      .where(where)
      .as('ranked');
    const [rows, counts] = await Promise.all([
      db
        .select({ c: comment })
        .from(comment)
        .innerJoin(ranked, eq(ranked.id, comment.id))
        .where(lte(ranked.rn, INLINE_REPLIES))
        .orderBy(asc(comment.createdAt), asc(comment.id)),
      db
        .select({ threadId: comment.threadId, n: count() })
        .from(comment)
        .where(where)
        .groupBy(comment.threadId),
    ]);
    const replies = new Map<string, CommentRow[]>();
    for (const { c } of rows) {
      const key = c.threadId as string;
      replies.set(key, [...(replies.get(key) ?? []), c]);
    }
    return { replies, counts: new Map(counts.map((r) => [r.threadId as string, r.n])) };
  }

  app.get(v1('/guest/links/:linkId/boards/:boardId/comments'), async (req, reply) => {
    const { linkId, boardId } = BoardParams.parse(req.params);
    const query = CommentQuery.parse(req.query ?? {});
    const ctx = await guests.requireGuest(req, reply, linkId);
    guests.requireCan(ctx, 'read_comments');
    guests.requireBoard(ctx, boardId);
    const visible = await visibleIds(ctx, boardId);
    if (query.elementId && !visible.includes(query.elementId))
      throw new HttpError('not_found', 'Card not found.');
    const filters: Array<SQL | undefined> = [readableThreads(linkId, boardId, visible)];
    if (query.elementId) filters.push(eq(comment.elementId, query.elementId));
    else if (query.scope === 'board') filters.push(isNull(comment.elementId));
    else if (query.scope === 'elements') filters.push(isNotNull(comment.elementId));
    if (query.status === 'open') filters.push(isNull(comment.resolvedAt));
    if (query.status === 'resolved') filters.push(isNotNull(comment.resolvedAt));
    if (query.cursor) {
      const { at, id } = decodeCursor(query.cursor);
      filters.push(sql`(${comment.createdAt}, ${comment.id}) < (${at}::timestamptz, ${id}::uuid)`);
    }
    const rows = await db
      .select({ c: comment, key: cursorKey })
      .from(comment)
      .where(and(...filters))
      .orderBy(desc(comment.createdAt), desc(comment.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(last.key, last.c.id) : null;
    const { replies, counts } = await repliesOf(
      ctx,
      page.map((r) => r.c.id),
    );
    const names = await namesFor(db, ctx, boardId, [
      ...page.map((r) => r.c),
      ...[...replies.values()].flat(),
    ]);
    const items: GuestCommentThread[] = page.map(({ c }) => ({
      ...toGuestComment(c, ctx, names),
      resolvedAt: c.resolvedAt ? iso(c.resolvedAt) : null,
      resolvedBy: c.resolvedAt
        ? c.resolvedBy
          ? { kind: 'team', name: names.userNames.get(c.resolvedBy) ?? null, isYou: false }
          : { kind: 'deleted', name: null, isYou: false }
        : null,
      replyCount: counts.get(c.id) ?? 0,
      replies: (replies.get(c.id) ?? []).map((r) => toGuestComment(r, ctx, names)),
    }));
    return { items, nextCursor };
  });

  app.get(v1('/guest/links/:linkId/comments/:commentId/replies'), async (req, reply) => {
    const { linkId, commentId } = CommentParams.parse(req.params);
    const query = ReplyQuery.parse(req.query ?? {});
    const ctx = await guests.requireGuest(req, reply, linkId);
    guests.requireCan(ctx, 'read_comments');
    const thread = await readableThread(ctx, commentId);
    const filters: Array<SQL | undefined> = [
      eq(comment.threadId, thread.id),
      replyOfLink(ctx.link.id),
    ];
    if (query.cursor) {
      const { at, id } = decodeCursor(query.cursor);
      filters.push(sql`(${comment.createdAt}, ${comment.id}) > (${at}::timestamptz, ${id}::uuid)`);
    }
    const rows = await db
      .select({ c: comment, key: cursorKey })
      .from(comment)
      .where(and(...filters))
      .orderBy(asc(comment.createdAt), asc(comment.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const names = await namesFor(
      db,
      ctx,
      thread.boardId,
      page.map((r) => r.c),
    );
    return {
      items: page.map((r) => toGuestComment(r.c, ctx, names)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.key, last.c.id) : null,
    };
  });

  app.post(v1('/guest/links/:linkId/boards/:boardId/comments'), async (req, reply) => {
    const { linkId, boardId } = BoardParams.parse(req.params);
    const input = GuestCreateComment.parse(req.body ?? {});
    const ctx = await guests.requireGuest(req, reply, linkId);
    guests.requireCan(ctx, 'write_comments');
    guests.requireBoard(ctx, boardId);
    let elementId: string | null = null;
    let threadId: string | null = null;
    if (input.parentId) {
      const thread = await readableThread(ctx, input.parentId);
      if (thread.boardId !== boardId) throw new HttpError('not_found', 'Comment not found.');
      threadId = thread.id;
      elementId = thread.elementId;
    } else if (input.elementId) {
      elementId = input.elementId;
      await guests.requireElement(ctx, boardId, elementId);
    }
    guests.requireName(ctx);
    guests.takeWrite(ctx, reply);
    if (!perGuest.take(ctx.guest.id) || !perLink.take(ctx.link.id)) {
      reply.header(
        'retry-after',
        Math.max(perGuest.retryAfterSeconds(ctx.guest.id), perLink.retryAfterSeconds(ctx.link.id)),
      );
      throw new HttpError('rate_limited', 'Too many comments: try again later.');
    }
    const [row] = await db
      .insert(comment)
      .values({
        projectId: ctx.link.projectId,
        boardId,
        elementId,
        threadId,
        authorGuestId: ctx.guest.id,
        shareLinkId: ctx.link.id,
        visibility: 'everyone',
        body: input.body,
        pin: threadId ? null : (input.pin ?? null),
      })
      .returning();
    if (!row) throw new Error('Comment insert returned nothing');
    await afterWrite({
      kind: 'comment',
      projectId: ctx.link.projectId,
      action: 'created',
      boardId,
      elementId,
      commentId: row.id,
      threadId: threadId ?? row.id,
      guestId: ctx.guest.id,
    });
    const names = await namesFor(db, ctx, boardId, [row]);
    return reply.status(201).send(toGuestComment(row, ctx, names));
  });

  app.patch(v1('/guest/links/:linkId/comments/:commentId'), async (req, reply) => {
    const { linkId, commentId } = CommentParams.parse(req.params);
    const { body } = GuestUpdateComment.parse(req.body ?? {});
    const ctx = await guests.requireGuest(req, reply, linkId);
    guests.requireCan(ctx, 'write_comments');
    const row = await ownComment(ctx, commentId);
    guests.takeWrite(ctx, reply);
    const [updated] = await db
      .update(comment)
      .set({ body, editedAt: new Date() })
      .where(eq(comment.id, row.id))
      .returning();
    if (!updated) throw new HttpError('not_found', 'Comment not found.');
    await afterWrite({
      kind: 'comment',
      projectId: ctx.link.projectId,
      action: 'edited',
      boardId: row.boardId,
      elementId: row.elementId,
      commentId: row.id,
      threadId: row.threadId ?? row.id,
      guestId: ctx.guest.id,
    });
    return toGuestComment(updated, ctx, await namesFor(db, ctx, row.boardId, [updated]));
  });

  app.delete(v1('/guest/links/:linkId/comments/:commentId'), async (req, reply) => {
    const { linkId, commentId } = CommentParams.parse(req.params);
    const ctx = await guests.requireGuest(req, reply, linkId);
    guests.requireCan(ctx, 'write_comments');
    const row = await ownComment(ctx, commentId);
    guests.takeWrite(ctx, reply);
    await db.transaction(async (tx) => {
      if (row.threadId) {
        await tx.delete(comment).where(eq(comment.id, row.id));
        // A placeholder whose last reply went goes too.
        await tx
          .delete(comment)
          .where(
            and(
              eq(comment.id, row.threadId),
              isNotNull(comment.deletedAt),
              sql`not exists (select 1 from ${comment} r where r.thread_id = ${row.threadId})`,
            ),
          );
        return;
      }
      const [reply] = await tx
        .select({ id: comment.id })
        .from(comment)
        .where(eq(comment.threadId, row.id))
        .limit(1);
      // A thread start with replies stays as an empty placeholder.
      if (reply)
        await tx
          .update(comment)
          .set({ body: '', deletedAt: new Date() })
          .where(eq(comment.id, row.id));
      else await tx.delete(comment).where(eq(comment.id, row.id));
    });
    await afterWrite({
      kind: 'comment',
      projectId: ctx.link.projectId,
      action: 'deleted',
      boardId: row.boardId,
      elementId: row.elementId,
      commentId: row.id,
      threadId: row.threadId ?? row.id,
      guestId: ctx.guest.id,
    });
    return reply.status(204).send();
  });
}
