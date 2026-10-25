import { CURRENT_SCHEMA_VERSION, SchemaTooNewError } from '@inkadra/doc-schema';
import {
  API_PREFIX,
  type BoardVersion,
  BoardVersionQuery,
  CreateBoardVersion,
  Id,
  MAX_NAMED_VERSIONS,
  type RestoredBoardVersion,
  UpdateBoardVersion,
  z,
} from '@inkadra/shared';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { requireBoardRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import { type BoardNotifier, noNotices } from '../board-notices.ts';
import type { Database } from '../db/client.ts';
import { boardVersion, user } from '../db/schema.ts';
import { CardOutcomeUnknown } from '../queues.ts';
import { nameVersion, type VersionWriter, versionDoc } from '../versions.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import { RateLimiter } from './link-previews.ts';

/** Saved versions of a board (decision 0013). Editors and owners do everything here. */

interface Deps {
  db: Database;
  auth: Auth;
  /** Missing when no collaboration server can be reached: saves and restores are refused. */
  versions?: VersionWriter;
  notices?: BoardNotifier;
}

const BoardParams = z.object({ boardId: Id });
const VersionParams = z.object({ boardId: Id, versionId: Id });

/** Named versions a person may save in an hour. */
const SAVES_PER_HOUR = 20;
/** Full-document restore backups are limited per board across all its editors. */
const RESTORES_PER_HOUR = 10;

/** Columns of a version without its state, with its author and a microsecond cursor key. */
const listed = (() => {
  const { state: _state, ...columns } = getTableColumns(boardVersion);
  return {
    ...columns,
    creatorName: user.name,
    creatorImage: user.image,
    // Postgres keeps microseconds, which a JavaScript date would round away.
    key: sql<string>`(extract(epoch from ${boardVersion.createdAt}) * 1000000)::bigint::text`,
  };
})();
function toVersion(row: {
  id: string;
  boardId: string;
  kind: BoardVersion['kind'];
  name: string | null;
  createdBy: string | null;
  creatorName: string | null;
  creatorImage: string | null;
  createdAt: Date;
  size: number;
  elementCount: number;
  schemaVersion: number;
  expiresAt: Date | null;
}): BoardVersion {
  return {
    id: row.id,
    boardId: row.boardId,
    kind: row.kind,
    name: row.name,
    createdBy:
      row.createdBy && row.creatorName !== null
        ? { id: row.createdBy, name: row.creatorName, image: row.creatorImage }
        : null,
    createdAt: iso(row.createdAt),
    size: row.size,
    elementCount: row.elementCount,
    docSchemaVersion: row.schemaVersion,
    expiresAt: row.expiresAt ? iso(row.expiresAt) : null,
  };
}

/** Opaque keyset cursor over (created_at in microseconds, id). */
const encodeCursor = (key: string, id: string) =>
  Buffer.from(JSON.stringify([key, id])).toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      /^\d{1,20}$/.test(value[0]) &&
      Id.safeParse(value[1]).success
    )
      return [value[0], value[1]];
  } catch {}
  throw new HttpError('bad_request', 'Invalid cursor.');
}

export function registerVersionRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth, notices = noNotices } = deps;
  const changed = (boardId: string, versionId: string) => {
    try {
      notices.notify(boardId, { type: 'versions', versionId });
    } catch (err) {
      app.log.warn({ err, boardId, versionId }, 'version notice not sent');
    }
  };
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  const saves = new RateLimiter(SAVES_PER_HOUR, 60 * 60 * 1000);
  const restores = new RateLimiter(RESTORES_PER_HOUR, 60 * 60 * 1000);

  /** One version of the board, or 404: the id must belong to the board of the path. */
  async function findVersion(boardId: string, versionId: string) {
    const [row] = await db
      .select(listed)
      .from(boardVersion)
      .leftJoin(user, eq(user.id, boardVersion.createdBy))
      .where(and(eq(boardVersion.id, versionId), eq(boardVersion.boardId, boardId)));
    if (!row) throw new HttpError('not_found', 'Version not found.');
    return row;
  }

  function writer() {
    if (!deps.versions)
      throw new HttpError('internal', 'Versions need the collaboration server: set REDIS_URL.');
    return deps.versions;
  }

  app.get(v1('/boards/:boardId/versions'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const query = BoardVersionQuery.parse(req.query);
    await requireBoardRole(db, actor, boardId, 'editor');
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await db
      .select(listed)
      .from(boardVersion)
      .leftJoin(user, eq(user.id, boardVersion.createdBy))
      .where(
        and(
          eq(boardVersion.boardId, boardId),
          query.kind ? eq(boardVersion.kind, query.kind) : undefined,
          after
            ? sql`(${boardVersion.createdAt}, ${boardVersion.id}) < (timestamptz 'epoch' + ${after[0]}::bigint * interval '1 microsecond', ${after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(boardVersion.createdAt), desc(boardVersion.id))
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(toVersion),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.key, last.id) : null,
    };
  });

  app.get(v1('/boards/:boardId/versions/:versionId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, versionId } = VersionParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'editor');
    return toVersion(await findVersion(boardId, versionId));
  });

  app.post(v1('/boards/:boardId/versions'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const input = CreateBoardVersion.parse(req.body);
    await requireBoardRole(db, actor, boardId, 'editor');
    const versions = writer();
    if (!saves.take(actor.id))
      throw new HttpError('rate_limited', 'Too many saved versions: wait a while.');
    let saved: Awaited<ReturnType<VersionWriter['save']>>;
    try {
      saved = await versions.save({ boardId, name: input.name, userId: actor.id });
    } catch (err) {
      if (!(err instanceof CardOutcomeUnknown)) throw err;
      req.log.error({ err, boardId }, 'version save outcome unknown');
      throw new HttpError(
        'internal',
        'The board did not confirm the save in time: check its versions before trying again.',
        { reason: 'outcome_unknown' },
      );
    }
    if (!saved.ok)
      throw saved.reason === 'limit'
        ? new HttpError(
            'conflict',
            `A board keeps at most ${MAX_NAMED_VERSIONS} named versions: delete one first.`,
            { reason: 'named_versions_limit' },
          )
        : new HttpError('internal', 'The board could not be reached in time: try again.');
    changed(boardId, saved.versionId);
    return reply.status(201).send(toVersion(await findVersion(boardId, saved.versionId)));
  });

  app.patch(v1('/boards/:boardId/versions/:versionId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, versionId } = VersionParams.parse(req.params);
    const input = UpdateBoardVersion.parse(req.body);
    await requireBoardRole(db, actor, boardId, 'editor');
    const named = await nameVersion(db, { boardId, versionId, name: input.name });
    if (!named.ok)
      throw named.reason === 'missing'
        ? new HttpError('not_found', 'Version not found.')
        : new HttpError(
            'conflict',
            `A board keeps at most ${MAX_NAMED_VERSIONS} named versions: delete one first.`,
            { reason: 'named_versions_limit' },
          );
    changed(boardId, versionId);
    return toVersion(await findVersion(boardId, versionId));
  });

  app.delete(v1('/boards/:boardId/versions/:versionId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, versionId } = VersionParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'editor');
    const removed = await db
      .delete(boardVersion)
      .where(and(eq(boardVersion.id, versionId), eq(boardVersion.boardId, boardId)))
      .returning({ id: boardVersion.id });
    if (removed.length === 0) throw new HttpError('not_found', 'Version not found.');
    changed(boardId, versionId);
    return reply.status(204).send();
  });

  app.get(v1('/boards/:boardId/versions/:versionId/state'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, versionId } = VersionParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'editor');
    const [row] = await db
      .select({ state: boardVersion.state, schemaVersion: boardVersion.schemaVersion })
      .from(boardVersion)
      .where(and(eq(boardVersion.id, versionId), eq(boardVersion.boardId, boardId)));
    if (!row) throw new HttpError('not_found', 'Version not found.');
    let update: Uint8Array;
    try {
      update =
        row.schemaVersion === CURRENT_SCHEMA_VERSION
          ? row.state
          : Y.encodeStateAsUpdate(versionDoc(row, boardId));
    } catch (err) {
      if (err instanceof SchemaTooNewError)
        throw new HttpError('conflict', 'This version was saved by a newer Inkadra.', {
          reason: 'newer_schema',
        });
      throw err;
    }
    return reply
      .header('content-type', 'application/octet-stream')
      .header('cache-control', 'private, no-store')
      .send(Buffer.from(update));
  });

  app.post(v1('/boards/:boardId/versions/:versionId/restore'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, versionId } = VersionParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, 'editor');
    const restored = await findVersion(boardId, versionId);
    const versions = writer();
    if (!restores.take(boardId))
      throw new HttpError('rate_limited', 'Too many restores of this board: wait a while.');
    let result: Awaited<ReturnType<VersionWriter['restore']>>;
    try {
      result = await versions.restore({ boardId, versionId, userId: actor.id });
    } catch (err) {
      if (!(err instanceof CardOutcomeUnknown)) throw err;
      req.log.error({ err, boardId, versionId }, 'restore outcome unknown');
      throw new HttpError(
        'internal',
        'The board did not confirm the restore in time: check it before trying again.',
        { reason: 'outcome_unknown' },
      );
    }
    if (!result.ok) {
      if (result.reason === 'missing') throw new HttpError('not_found', 'Version not found.');
      if (result.reason === 'too_new')
        throw new HttpError('conflict', 'This version was saved by a newer Inkadra.', {
          reason: 'newer_schema',
        });
      throw new HttpError('internal', 'The board could not be reached in time: try again.');
    }
    const body: RestoredBoardVersion = {
      restored: toVersion(restored),
      backup: toVersion(await findVersion(boardId, result.backupId)),
    };
    return body;
  });
}
