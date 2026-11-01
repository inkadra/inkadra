import { randomUUID } from 'node:crypto';
import { API_PREFIX, Id } from '@inkadra/shared';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { activeMember, boardRoles } from '../access.ts';
import {
  type CalendarEvent,
  calendarToken,
  matchesToken,
  serializeCalendar,
  tokenHash,
} from '../calendar.ts';
import {
  board,
  boardDoc,
  calendarFeed,
  project,
  projectMember,
  shootingDay,
  user,
} from '../db/schema.ts';
import { readInstanceSettings } from '../instance-settings.ts';
import { mailText } from '../mail-texts.ts';
import { addressBucket, RateLimiter } from '../rate-limits.ts';
import { tasksInDoc } from '../tasks.ts';
import type { AppDeps } from './app.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

/** Events outside this window are not published; the feed is bounded in time and in size. */
const FEED_PAST_DAYS = 90;
const FEED_FUTURE_DAYS = 365;
const FEED_MAX_EVENTS = 2000;
const FEED_DOC_BATCH = 25;
/** Bump when the body changes for the same data, so clients do not keep a stale validator. */
const FEED_VERSION = 2;

export function registerCalendarRoutes(
  app: FastifyInstance,
  { db, auth, config }: Pick<AppDeps, 'db' | 'auth' | 'config'>,
) {
  const network = new RateLimiter(60, 60_000);
  const users = new RateLimiter(30, 60_000);
  for (const method of ['GET', 'POST'] as const)
    app.route({
      method,
      url: `${API_PREFIX}/me/calendar-feed`,
      handler: async (req, reply) => {
        const actor = await requireActor(auth, req, db);
        reply.header('cache-control', 'no-store');
        if (!(await readInstanceSettings(db, config)).calendarFeedEnabled)
          return { enabled: false, url: null };
        const generation = randomUUID();
        const token = calendarToken(config.AUTH_SECRET, actor.id, generation);
        const values = { userId: actor.id, generation, tokenHash: tokenHash(token) };
        if (method === 'POST')
          await db
            .insert(calendarFeed)
            .values(values)
            .onConflictDoUpdate({
              target: calendarFeed.userId,
              set: { ...values, updatedAt: new Date() },
            });
        else await db.insert(calendarFeed).values(values).onConflictDoNothing();
        const [row] = await db.select().from(calendarFeed).where(eq(calendarFeed.userId, actor.id));
        if (!row) throw new Error('Calendar credential missing');
        const current = calendarToken(config.AUTH_SECRET, actor.id, row.generation);
        // A changed installation secret revokes feeds; the user must explicitly regenerate.
        if (!matchesToken(current, row.tokenHash))
          throw new HttpError(
            'conflict',
            'Regenerate the calendar link after the installation secret changed.',
          );
        return { enabled: true, url: `${config.PUBLIC_URL}/calendar/${current}.ics` };
      },
    });
  app.get<{ Params: { token: string } }>('/calendar/:token.ics', async (req, reply) => {
    reply
      .header('cache-control', 'private, no-cache')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow');
    if (!network.take(addressBucket(req.ip)))
      return reply.code(429).header('retry-after', '60').send();
    const token = req.params.token;
    const userId = token.split('.')[0];
    if (!Id.safeParse(userId).success || token.length > 100)
      throw new HttpError('not_found', 'Calendar not found.');
    const [credential] = await db
      .select({ feed: calendarFeed, user: { locale: user.locale } })
      .from(calendarFeed)
      .innerJoin(user, and(eq(user.id, calendarFeed.userId), isNull(user.deactivatedAt)))
      .where(eq(calendarFeed.userId, userId as string));
    const settings = await readInstanceSettings(db, config);
    if (
      !credential ||
      !matchesToken(token, credential.feed.tokenHash) ||
      !matchesToken(
        calendarToken(config.AUTH_SECRET, credential.feed.userId, credential.feed.generation),
        credential.feed.tokenHash,
      ) ||
      !settings.calendarFeedEnabled
    )
      throw new HttpError('not_found', 'Calendar not found.');
    if (!users.take(credential.feed.userId))
      return reply.code(429).header('retry-after', '60').send();
    // Membership is read before content on every fetch, including conditional requests.
    // Content is read only after the cheap ETag misses (stored documents are the costly part).
    const rows = await db
      .select({
        board,
        name: project.name,
        timeZone: project.timeZone,
        projectUpdatedAt: project.updatedAt,
        docUpdatedAt: boardDoc.updatedAt,
      })
      .from(projectMember)
      .innerJoin(project, and(eq(project.id, projectMember.projectId), isNull(project.archivedAt)))
      .innerJoin(board, and(eq(board.projectId, project.id), isNull(board.deletedAt)))
      .leftJoin(boardDoc, eq(boardDoc.boardId, board.id))
      .where(and(eq(projectMember.userId, credential.feed.userId), activeMember()))
      .orderBy(asc(board.id));
    // Same member visibility as My Tasks: guest-only filters do not apply to members.
    const readable = await boardRoles(
      db,
      { id: credential.feed.userId },
      rows.map((r) => r.board.id),
    );
    const boards = rows.filter((r) => readable.has(r.board.id));
    const byId = new Map(boards.map((row) => [row.board.id, row]));
    const day = 86400000;
    const from = new Date(Date.now() - FEED_PAST_DAYS * day).toISOString().slice(0, 10);
    const to = new Date(Date.now() + FEED_FUTURE_DAYS * day).toISOString().slice(0, 10);
    const days = boards.length
      ? await db
          .select({
            id: shootingDay.id,
            boardId: shootingDay.boardId,
            date: shootingDay.date,
            callTime: shootingDay.callTime,
            wrap: shootingDay.wrap,
            location: shootingDay.location,
            updatedAt: shootingDay.updatedAt,
          })
          .from(shootingDay)
          .where(
            and(
              inArray(
                shootingDay.boardId,
                boards.map((r) => r.board.id),
              ),
              gte(shootingDay.date, from),
              lte(shootingDay.date, to),
            ),
          )
          .orderBy(asc(shootingDay.date), asc(shootingDay.id))
          .limit(FEED_MAX_EVENTS)
      : [];
    const texts = mailText(credential.user).calendar;
    // Cheap fingerprint of everything the body is built from: rows' timestamps, the window and the
    // credential. It is the validator, so a 304 never decodes a document.
    const hash = tokenHash(
      JSON.stringify([
        FEED_VERSION,
        from,
        credential.user.locale,
        settings.name,
        config.PUBLIC_URL,
        credential.feed.generation,
        boards.map((r) => [r.board.id, r.board.updatedAt, r.projectUpdatedAt, r.docUpdatedAt]),
        days.map((d) => [d.id, d.updatedAt]),
      ]),
    );
    const etag = `"${hash}"`;
    let modifiedAt = credential.feed.lastModified;
    if (credential.feed.contentHash !== hash) {
      modifiedAt = new Date();
      await db
        .update(calendarFeed)
        .set({ contentHash: hash, lastModified: modifiedAt })
        .where(
          and(
            eq(calendarFeed.userId, credential.feed.userId),
            eq(calendarFeed.generation, credential.feed.generation),
          ),
        );
    }
    reply.header('etag', etag).header('last-modified', modifiedAt.toUTCString());
    if (
      req.headers['if-none-match']
        ?.split(',')
        .map((s) => s.trim().replace(/^W\//, ''))
        .includes(etag)
    )
      return reply.code(304).send();
    const link = (b: { projectId: string; id: string }) =>
      `${config.PUBLIC_URL}/p/${b.projectId}/b/${b.id}`;
    const events: CalendarEvent[] = [];
    for (const d of days) {
      const row = byId.get(d.boardId);
      if (!row) continue;
      events.push({
        uid: `shooting-${d.id}`,
        title: `${row.board.title} · ${row.name}`,
        description: `${texts.call(d.callTime, d.location, d.wrap === d.callTime ? null : d.wrap)}\n${link(row.board)}`,
        date: d.date,
        time: d.callTime,
        wrap: d.wrap,
        timeZone: row.timeZone,
        location: d.location,
        modified: d.updatedAt,
      });
    }
    const withDocs = boards.filter((r) => r.docUpdatedAt);
    for (let at = 0; at < withDocs.length; at += FEED_DOC_BATCH) {
      const batch = withDocs.slice(at, at + FEED_DOC_BATCH);
      const states = await db
        .select({ boardId: boardDoc.boardId, state: boardDoc.state })
        .from(boardDoc)
        .where(
          inArray(
            boardDoc.boardId,
            batch.map((r) => r.board.id),
          ),
        );
      for (const { boardId, state } of states) {
        const row = byId.get(boardId);
        if (!row) continue;
        const doc = new Y.Doc();
        // One damaged document must not take the whole feed down; skip it (no bearer in the log).
        try {
          Y.applyUpdate(doc, state);
          for (const task of tasksInDoc(doc, credential.feed.userId, {
            projectId: row.board.projectId,
            projectName: row.name,
            boardId,
            boardTitle: row.board.title,
          })) {
            if (!task.dueDate || task.dueDate < from || task.dueDate > to) continue;
            events.push({
              uid: `task-${boardId}-${task.elementId}-${task.itemId}`,
              title: texts.deadline(task.text, row.board.title),
              description: `${texts.todo(row.board.title)}\n${link(row.board)}`,
              date: task.dueDate,
              modified: row.docUpdatedAt ?? row.board.updatedAt,
            });
          }
        } catch (err) {
          req.log.warn({ err, boardId }, 'calendar feed: board skipped');
        } finally {
          doc.destroy();
        }
      }
    }
    // Plain code-unit comparison: the order must not depend on the server's locale.
    const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    events.sort((a, b) => order(a.date, b.date) || order(a.uid, b.uid));
    events.length = Math.min(events.length, FEED_MAX_EVENTS);
    const body = serializeCalendar(
      events,
      settings.name === 'Inkadra' ? 'Inkadra' : `Inkadra · ${settings.name}`,
    );
    return reply.type('text/calendar; charset=utf-8').send(body);
  });
}
