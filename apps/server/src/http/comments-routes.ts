import {
  API_PREFIX,
  type Comment,
  type CommentCounts,
  CommentQuery,
  type CommentThread,
  CreateComment,
  Id,
  INLINE_REPLIES,
  mentionedIds,
  type ProjectRole,
  ReplyQuery,
  UpdateComment,
  z,
} from '@inkadra/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  type Actor,
  atLeast,
  type BoardAccess,
  boardAccess,
  boardRolesForPeople,
  linkIncludesBoard,
} from '../access.ts';
import type { Auth } from '../auth.ts';
import { type BoardReader, storedElement } from '../board-content.ts';
import { type BoardNotifier, noNotices } from '../board-notices.ts';
import type { Database } from '../db/client.ts';
import { comment, shareLink } from '../db/schema.ts';
import { afterCommit, notify, Recipients } from '../notifications.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { authorOf, labelOf, loadPeople, type People } from './authors.ts';
import { HttpError } from './errors.ts';
import { afterCursor, atText, decodeCursor, pageOf } from './keyset.ts';
import { RateLimiter } from './link-previews.ts';

interface Deps {
  db: Database;
  auth: Auth;
  notices?: BoardNotifier;
  boardReader?: BoardReader;
}

const BoardParams = z.object({ boardId: Id });
const CommentParams = z.object({ commentId: Id });

/** Comments a person may write in a minute: plenty for a conversation, little for a script. */
const COMMENTS_PER_MINUTE = 30;

type Row = typeof comment.$inferSelect;
type Ranked = Row & { at: string };

const columns = { ...getTableColumns(comment), at: atText(comment.createdAt) };

/** What the caller may do with comments of the board, for canEdit and canDelete. */
interface Viewer {
  actorId: string;
  role: ProjectRole;
}

const canWrite = (v: Viewer) => atLeast(v.role, 'commenter');

/** The mentions of a body that name people who can read the board. */
async function readableMentions(db: Database, boardId: string, body: string): Promise<string[]> {
  const ids = mentionedIds(body);
  const roles = await boardRolesForPeople(db, boardId, ids);
  return ids.filter((id) => roles.has(id));
}

async function peopleOf(db: Database, rows: Row[], viewer: Viewer) {
  const boardId = rows[0]?.boardId;
  if (boardId) {
    const ids = rows.flatMap((r) => r.mentions);
    const roles = await boardRolesForPeople(db, boardId, ids);
    for (const row of rows) row.mentions = row.mentions.filter((id) => roles.has(id));
  }
  return loadPeople(
    db,
    { id: viewer.actorId },
    rows.flatMap((r) => [r.authorId, r.resolvedBy, ...r.mentions]),
    rows.map((r) => r.authorGuestId),
    rows.map((r) => r.shareLinkId),
  );
}

export function toComment(row: Row, people: People, viewer: Viewer): Comment {
  const mine = row.authorId === viewer.actorId && canWrite(viewer) && !row.deletedAt;
  return {
    id: row.id,
    boardId: row.boardId,
    elementId: row.elementId,
    parentId: row.threadId,
    pin: row.pin ?? null,
    createdAt: iso(row.createdAt),
    editedAt: row.editedAt ? iso(row.editedAt) : null,
    deletedAt: row.deletedAt ? iso(row.deletedAt) : null,
    author: authorOf(people, row.authorId, row.authorGuestId),
    body: row.deletedAt ? '' : row.body,
    mentions: row.deletedAt
      ? []
      : row.mentions.flatMap((id) => {
          const u = people.users.get(id);
          return u ? [u] : [];
        }),
    visibility: row.visibility,
    shareLinkId: row.shareLinkId,
    shareLinkLabel: labelOf(people, row.shareLinkId),
    canEdit: mine,
    canDelete: !row.deletedAt && (mine || atLeast(viewer.role, 'editor')),
  };
}

/** Threads with their reply counts and latest replies, in the order of `rows`. */
async function toThreads(db: Database, rows: Row[], viewer: Viewer): Promise<CommentThread[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const ranked = db
    .select({
      ...getTableColumns(comment),
      rank: sql<number>`row_number() over (partition by ${comment.threadId} order by ${comment.createdAt} desc, ${comment.id} desc)`.as(
        'rank',
      ),
    })
    .from(comment)
    .where(inArray(comment.threadId, ids))
    .as('ranked');
  const [replies, counts] = await Promise.all([
    db
      .select()
      .from(ranked)
      .where(lte(ranked.rank, INLINE_REPLIES))
      .orderBy(asc(ranked.createdAt), asc(ranked.id)),
    db
      .select({ threadId: comment.threadId, n: count() })
      .from(comment)
      .where(inArray(comment.threadId, ids))
      .groupBy(comment.threadId),
  ]);
  const replyRows = replies.map(({ rank: _, ...r }) => r as Row);
  const people = await peopleOf(db, [...rows, ...replyRows], viewer);
  const byThread = new Map<string, Comment[]>();
  for (const r of replyRows) {
    const list = byThread.get(r.threadId ?? '') ?? [];
    list.push(toComment(r, people, viewer));
    byThread.set(r.threadId ?? '', list);
  }
  const replyCount = new Map(counts.map((c) => [c.threadId, c.n]));
  return rows.map((r) => ({
    ...toComment(r, people, viewer),
    resolvedAt: r.resolvedAt ? iso(r.resolvedAt) : null,
    resolvedBy: r.resolvedAt ? authorOf(people, r.resolvedBy, null) : null,
    replyCount: replyCount.get(r.id) ?? 0,
    replies: byThread.get(r.id) ?? [],
  }));
}

/**
 * A link a team thread may be limited to: a link of the board, or of a board above it that
 * includes sub-boards, still working (not revoked or expired, and its creator still has at
 * least editor on its board and on this one, decision 0013).
 */
async function checkAudience(db: Database, access: BoardAccess, linkId: string) {
  const [link] = await db
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.id, linkId), eq(shareLink.projectId, access.board.projectId)));
  if (!link) throw new HttpError('bad_request', 'The link does not include this board.');
  if (link.role === 'guest_view')
    throw new HttpError('bad_request', 'The link cannot read comments.');
  const stop = access.chain.findIndex((b) => b.id === link.boardId);
  if (stop < 0 || (stop > 0 && !link.includeSubBoards))
    throw new HttpError('bad_request', 'The link does not include this board.');
  const working =
    !link.revokedAt &&
    (!link.expiresAt || link.expiresAt > new Date()) &&
    (await linkIncludesBoard(db, link, access));
  if (!working) throw new HttpError('bad_request', 'The link is not active.');
}

export function registerCommentRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth, boardReader } = deps;
  const notices = deps.notices ?? noNotices;
  const readElement = boardReader
    ? (boardId: string, elementId: string) => boardReader.element(boardId, elementId)
    : (boardId: string, elementId: string) => storedElement(db, boardId, elementId);
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  const limiter = new RateLimiter(COMMENTS_PER_MINUTE, 60_000);

  async function readableBoard(actor: Actor, boardId: string) {
    const access = await boardAccess(db, actor, boardId);
    if (!access?.role) throw new HttpError('not_found', 'Board not found.');
    return { ...access, role: access.role };
  }

  /** A comment on a board the caller can read; anything else is a 404. */
  async function readableComment(actor: Actor, commentId: string) {
    const [row] = await db.select(columns).from(comment).where(eq(comment.id, commentId));
    if (!row) throw new HttpError('not_found', 'Comment not found.');
    const access = await boardAccess(db, actor, row.boardId);
    if (!access?.role) throw new HttpError('not_found', 'Comment not found.');
    const viewer: Viewer = { actorId: actor.id, role: access.role };
    return { row: row as Ranked, access, viewer };
  }

  function requireWriter(viewer: Viewer) {
    if (!canWrite(viewer)) throw new HttpError('forbidden', 'Needs the commenter role.');
  }

  const tell = (row: Row) =>
    notices.notify(row.boardId, {
      type: 'comments',
      elementId: row.elementId,
      threadId: row.threadId ?? row.id,
    });

  app.get(v1('/boards/:boardId/comments'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const q = CommentQuery.parse(req.query ?? {});
    const cursor = decodeCursor(q.cursor);
    const access = await readableBoard(actor, boardId);
    const where: SQL[] = [eq(comment.boardId, boardId), isNull(comment.threadId)];
    if (q.elementId) where.push(eq(comment.elementId, q.elementId));
    if (q.scope === 'board') where.push(isNull(comment.elementId));
    if (q.scope === 'elements') where.push(isNotNull(comment.elementId));
    if (q.status === 'open') where.push(isNull(comment.resolvedAt));
    if (q.status === 'resolved') where.push(isNotNull(comment.resolvedAt));
    if (cursor) where.push(afterCursor(comment.createdAt, comment.id, cursor));
    const rows = await db
      .select(columns)
      .from(comment)
      .where(and(...where))
      .orderBy(desc(comment.createdAt), desc(comment.id))
      .limit(q.limit + 1);
    const page = pageOf(rows, q.limit);
    const viewer = { actorId: actor.id, role: access.role };
    return { items: await toThreads(db, page.rows, viewer), nextCursor: page.nextCursor };
  });

  app.get(v1('/boards/:boardId/comment-counts'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    await readableBoard(actor, boardId);
    const rows = await db
      .select({
        elementId: comment.elementId,
        open: sql<number>`(count(*) filter (where ${comment.resolvedAt} is null))::int`,
        resolved: sql<number>`(count(*) filter (where ${comment.resolvedAt} is not null))::int`,
      })
      .from(comment)
      .where(and(eq(comment.boardId, boardId), isNull(comment.threadId)))
      .groupBy(comment.elementId);
    const body: CommentCounts = { items: rows };
    return body;
  });

  app.post(v1('/boards/:boardId/comments'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const input = CreateComment.parse(req.body);
    const access = await readableBoard(actor, boardId);
    const viewer: Viewer = { actorId: actor.id, role: access.role };
    requireWriter(viewer);
    if (!limiter.take(actor.id))
      throw new HttpError('rate_limited', 'Too many comments: wait a minute.');

    let thread: Row | undefined;
    if (input.parentId) {
      [thread] = await db
        .select()
        .from(comment)
        .where(and(eq(comment.id, input.parentId), eq(comment.boardId, boardId)));
      if (!thread) throw new HttpError('not_found', 'Thread not found.');
      if (thread.threadId)
        throw new HttpError('bad_request', 'Reply to the first comment of the thread.');
    }
    const elementId = thread ? thread.elementId : (input.elementId ?? null);
    const card = !thread && elementId ? await readElement(boardId, elementId) : null;
    if (!thread && elementId && !card) throw new HttpError('not_found', 'Card not found.');
    if (input.pin && thread)
      throw new HttpError('bad_request', 'Only the first comment of a thread can be pinned.');
    if (input.pin && !elementId) throw new HttpError('bad_request', 'Only a card can be pinned.');
    // Replies take the visibility of their thread; a reply of the team carries no link.
    const visibility = thread ? thread.visibility : (input.visibility ?? 'team');
    const shareLinkId = thread ? null : (input.shareLinkId ?? null);
    if (shareLinkId) {
      if (visibility !== 'everyone')
        throw new HttpError('bad_request', 'Only threads for everyone can be limited to a link.');
      await checkAudience(db, access, shareLinkId);
    }
    const mentions = await readableMentions(db, boardId, input.body);
    const row = await db.transaction(async (tx) => {
      // Serialize with deletion of the thread start. A successful reply must never be
      // cascaded away by a concurrent delete that saw no replies yet.
      if (thread) {
        const [current] = await tx
          .select({ id: comment.id })
          .from(comment)
          .where(eq(comment.id, thread.id))
          .for('update');
        if (!current) throw new HttpError('not_found', 'Thread not found.');
      }
      const [created] = await tx
        .insert(comment)
        .values({
          projectId: access.board.projectId,
          boardId,
          elementId,
          threadId: thread?.id ?? null,
          authorId: actor.id,
          shareLinkId,
          body: input.body,
          mentions,
          visibility,
          pin: input.pin ?? null,
        })
        .returning();
      if (!created) throw new Error('Comment insert returned nothing');
      return created;
    });

    await afterCommit(req.log, async () => {
      const recipients = new Recipients(actor.id);
      for (const id of mentions) recipients.add(id, 'mention');
      if (thread) {
        const writers = await db
          .selectDistinct({ id: comment.authorId })
          .from(comment)
          .where(
            and(
              or(eq(comment.id, thread.id), eq(comment.threadId, thread.id)),
              isNotNull(comment.authorId),
              isNull(comment.deletedAt),
            ),
          );
        for (const w of writers) recipients.add(w.id, 'reply');
      } else if (elementId) {
        recipients.add(card?.createdBy, 'comment');
      }
      await notify(
        db,
        {
          actor: { userId: actor.id },
          projectId: access.board.projectId,
          boardId,
          elementId,
          commentId: row.id,
        },
        recipients,
      );
    });
    await afterCommit(req.log, () => tell(row));
    return reply.status(201).send(toComment(row, await peopleOf(db, [row], viewer), viewer));
  });

  app.get(v1('/comments/:commentId/replies'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { commentId } = CommentParams.parse(req.params);
    const q = ReplyQuery.parse(req.query ?? {});
    const cursor = decodeCursor(q.cursor);
    const { row: thread, viewer } = await readableComment(actor, commentId);
    if (thread.threadId) throw new HttpError('bad_request', 'Not the first comment of a thread.');
    const rows = await db
      .select(columns)
      .from(comment)
      .where(
        and(
          eq(comment.threadId, thread.id),
          cursor ? afterCursor(comment.createdAt, comment.id, cursor, 'asc') : undefined,
        ),
      )
      .orderBy(asc(comment.createdAt), asc(comment.id))
      .limit(q.limit + 1);
    const page = pageOf(rows, q.limit);
    const people = await peopleOf(db, page.rows, viewer);
    return {
      items: page.rows.map((r) => toComment(r, people, viewer)),
      nextCursor: page.nextCursor,
    };
  });

  app.patch(v1('/comments/:commentId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { commentId } = CommentParams.parse(req.params);
    const input = UpdateComment.parse(req.body);
    const { row, access, viewer } = await readableComment(actor, commentId);
    if (row.deletedAt) throw new HttpError('not_found', 'Comment not found.');
    if (row.authorId !== actor.id)
      throw new HttpError('forbidden', 'Only the author can edit a comment.');
    requireWriter(viewer);
    if (!limiter.take(actor.id))
      throw new HttpError('rate_limited', 'Too many comment writes: wait a minute.');
    const mentions = await readableMentions(db, row.boardId, input.body);
    const [updated] = await db
      .update(comment)
      .set({ body: input.body, mentions, editedAt: new Date() })
      .where(eq(comment.id, row.id))
      .returning();
    if (!updated) throw new HttpError('not_found', 'Comment not found.');
    await afterCommit(req.log, async () => {
      // Only people mentioned for the first time hear about the edit.
      const recipients = new Recipients(actor.id);
      for (const id of mentions) if (!row.mentions.includes(id)) recipients.add(id, 'mention');
      await notify(
        db,
        {
          actor: { userId: actor.id },
          projectId: access.board.projectId,
          boardId: row.boardId,
          elementId: row.elementId,
          commentId: row.id,
        },
        recipients,
      );
    });
    await afterCommit(req.log, () => tell(updated));
    return toComment(updated, await peopleOf(db, [updated], viewer), viewer);
  });

  app.delete(v1('/comments/:commentId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { commentId } = CommentParams.parse(req.params);
    const { row, viewer } = await readableComment(actor, commentId);
    if (row.deletedAt) throw new HttpError('not_found', 'Comment not found.');
    const own = row.authorId === actor.id && canWrite(viewer);
    if (!own && !atLeast(viewer.role, 'editor'))
      throw new HttpError('forbidden', 'Only the author, an editor or the owner can delete it.');
    await db.transaction(async (tx) => {
      await tx
        .select({ id: comment.id })
        .from(comment)
        .where(eq(comment.id, row.threadId ?? row.id))
        .for('update');
      if (row.threadId === null) {
        const [replies] = await tx
          .select({ n: count() })
          .from(comment)
          .where(eq(comment.threadId, row.id));
        if ((replies?.n ?? 0) > 0) {
          // A thread start with replies stays as an empty placeholder.
          await tx
            .update(comment)
            .set({ body: '', mentions: [], deletedAt: new Date() })
            .where(eq(comment.id, row.id));
          return;
        }
        await tx.delete(comment).where(eq(comment.id, row.id));
        return;
      }
      await tx.delete(comment).where(eq(comment.id, row.id));
      // The placeholder of a deleted thread start goes with its last reply.
      const [left] = await tx
        .select({ n: count() })
        .from(comment)
        .where(eq(comment.threadId, row.threadId));
      if ((left?.n ?? 0) === 0)
        await tx
          .delete(comment)
          .where(and(eq(comment.id, row.threadId), isNotNull(comment.deletedAt)));
    });
    await afterCommit(req.log, () => tell(row));
    return reply.status(204).send();
  });

  for (const action of ['resolve', 'reopen'] as const) {
    app.post(v1(`/comments/:commentId/${action}`), async (req) => {
      const actor = await requireActor(auth, req, db);
      const { commentId } = CommentParams.parse(req.params);
      const { row, viewer } = await readableComment(actor, commentId);
      requireWriter(viewer);
      if (row.deletedAt) throw new HttpError('not_found', 'Comment not found.');
      if (row.threadId)
        throw new HttpError('bad_request', 'Only the first comment of a thread can be resolved.');
      const resolve = action === 'resolve';
      let current: Row = row;
      if (resolve !== (row.resolvedAt !== null)) {
        const [updated] = await db
          .update(comment)
          .set(
            resolve
              ? { resolvedAt: new Date(), resolvedBy: actor.id }
              : { resolvedAt: null, resolvedBy: null },
          )
          .where(
            and(
              eq(comment.id, row.id),
              isNull(comment.deletedAt),
              resolve ? isNull(comment.resolvedAt) : isNotNull(comment.resolvedAt),
            ),
          )
          .returning();
        if (updated) {
          current = updated;
          await afterCommit(req.log, () => tell(current));
        } else {
          // Another resolver won. Return its attribution instead of overwriting it.
          const fresh = await readableComment(actor, commentId);
          if (fresh.row.deletedAt) throw new HttpError('not_found', 'Comment not found.');
          current = fresh.row;
        }
      }
      const [thread] = await toThreads(db, [current], viewer);
      return thread;
    });
  }
}
