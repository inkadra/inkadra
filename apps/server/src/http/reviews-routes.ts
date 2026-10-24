import {
  API_PREFIX,
  type BoardReviews,
  ElementRef,
  type ElementReview,
  type ElementReviewEvent,
  Id,
  ReviewHistoryQuery,
  SetElementReview,
  z,
} from '@inkadra/shared';
import { and, desc, eq, getTableColumns, isNull, ne, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireBoardRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import { storedElement } from '../board-content.ts';
import { type BoardNotifier, noNotices } from '../board-notices.ts';
import type { Database } from '../db/client.ts';
import { elementReview, elementReviewEvent } from '../db/schema.ts';
import { notify, Recipients } from '../notifications.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { authorOf, loadPeople, type People } from './authors.ts';
import { HttpError } from './errors.ts';
import { afterCursor, atText, decodeCursor, pageOf } from './keyset.ts';

interface Deps {
  db: Database;
  auth: Auth;
  notices?: BoardNotifier;
}

const BoardParams = z.object({ boardId: Id });
const ElementParams = z.object({ boardId: Id, elementId: ElementRef });

type ReviewRow = typeof elementReview.$inferSelect;

function toElementReview(row: ReviewRow, people: People): ElementReview {
  return {
    elementId: row.elementId,
    status: row.status,
    note: row.note,
    changedBy: authorOf(people, row.changedBy, row.changedByGuest),
    changedAt: iso(row.changedAt),
  };
}

const peopleOf = (db: Database, rows: ReviewRow[]) =>
  loadPeople(
    db,
    rows.map((r) => r.changedBy),
    rows.map((r) => r.changedByGuest),
  );

export function registerReviewRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth } = deps;
  const notices = deps.notices ?? noNotices;
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  app.get(v1('/boards/:boardId/reviews'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'viewer');
    // Let Postgres compare full timestamp precision; the team wins an exact tie.
    const latest = await db
      .selectDistinctOn([elementReview.elementId])
      .from(elementReview)
      .where(
        and(
          eq(elementReview.boardId, boardId),
          or(isNull(elementReview.shareLinkId), ne(elementReview.status, 'none')),
        ),
      )
      .orderBy(
        elementReview.elementId,
        desc(elementReview.changedAt),
        desc(isNull(elementReview.shareLinkId)),
      );
    const rows = latest.filter((r) => r.status !== 'none');
    const people = await peopleOf(db, rows);
    const body: BoardReviews = { items: rows.map((r) => toElementReview(r, people)) };
    return body;
  });

  app.put(v1('/boards/:boardId/elements/:elementId/review'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, elementId } = ElementParams.parse(req.params);
    const input = SetElementReview.parse(req.body);
    const access = await requireBoardRole(db, actor, boardId, 'commenter');
    const card = await storedElement(db, boardId, elementId);
    if (!card) throw new HttpError('not_found', 'Card not found.');
    const note = input.note ? input.note : null;
    const teamRow = and(
      eq(elementReview.boardId, boardId),
      eq(elementReview.elementId, elementId),
      isNull(elementReview.shareLinkId),
    );
    const result = await db.transaction(async (tx) => {
      // The team row exists from the first change on; lock it so changes queue up.
      const inserted = await tx
        .insert(elementReview)
        .values({ boardId, elementId, projectId: access.board.projectId, status: 'none' })
        .onConflictDoNothing()
        .returning({ id: elementReview.id });
      const [current] = await tx.select().from(elementReview).where(teamRow).for('update');
      if (!current) throw new Error('Team review row missing');
      if (inserted.length === 0 && current.status === input.status && current.note === note)
        return { row: current, previous: current.status, requestedBy: current.requestedBy };
      const [row] = await tx
        .update(elementReview)
        .set({
          status: input.status,
          note,
          changedBy: actor.id,
          changedAt: new Date(),
          // Who asked for review hears about the decisions that follow.
          requestedBy: input.status === 'in_review' ? actor.id : current.requestedBy,
        })
        .where(eq(elementReview.id, current.id))
        .returning();
      if (!row) throw new Error('Team review row missing');
      await tx.insert(elementReviewEvent).values({
        boardId,
        elementId,
        previous: current.status,
        status: input.status,
        note,
        userId: actor.id,
      });
      return { row, previous: current.status, requestedBy: current.requestedBy, changed: true };
    });
    if ('changed' in result) {
      if (result.previous !== input.status)
        await notify(
          db,
          {
            actor: { userId: actor.id },
            projectId: access.board.projectId,
            boardId,
            elementId,
            reviewStatus: input.status,
          },
          new Recipients(actor.id).add(card.createdBy, 'review').add(result.requestedBy, 'review'),
        );
      notices.notify(boardId, { type: 'review', elementId });
    }
    return toElementReview(result.row, await peopleOf(db, [result.row]));
  });

  app.get(v1('/boards/:boardId/elements/:elementId/review/history'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, elementId } = ElementParams.parse(req.params);
    const q = ReviewHistoryQuery.parse(req.query ?? {});
    const cursor = decodeCursor(q.cursor);
    await requireBoardRole(db, actor, boardId, 'viewer');
    const rows = await db
      .select({ ...getTableColumns(elementReviewEvent), at: atText(elementReviewEvent.createdAt) })
      .from(elementReviewEvent)
      .where(
        and(
          eq(elementReviewEvent.boardId, boardId),
          eq(elementReviewEvent.elementId, elementId),
          cursor
            ? afterCursor(elementReviewEvent.createdAt, elementReviewEvent.id, cursor)
            : undefined,
        ),
      )
      .orderBy(desc(elementReviewEvent.createdAt), desc(elementReviewEvent.id))
      .limit(q.limit + 1);
    const page = pageOf(rows, q.limit);
    const people = await loadPeople(
      db,
      page.rows.map((r) => r.userId),
      page.rows.map((r) => r.guestId),
    );
    const items: ElementReviewEvent[] = page.rows.map((r) => ({
      id: r.id,
      elementId: r.elementId,
      previous: r.previous,
      status: r.status,
      note: r.note,
      changedBy: authorOf(people, r.userId, r.guestId),
      changedAt: iso(r.createdAt),
    }));
    return { items, nextCursor: page.nextCursor };
  });
}
