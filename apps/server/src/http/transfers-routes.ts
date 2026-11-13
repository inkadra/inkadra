import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  API_PREFIX,
  BackupSettings,
  Id,
  ImportIdempotencyKey,
  type InstanceBackups,
  UpdateBackupSettings,
  z,
} from '@inkadra/shared';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireProjectCreation } from '../access-expiry.ts';
import type { Auth } from '../auth.ts';
import {
  nextBackupAt,
  readBackupSettings,
  reapStaleBackups,
  serverTimeZone,
  startBackup,
  toBackup,
} from '../backup.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  creationRequest,
  instanceBackup,
  instanceSetting,
  project,
  projectTransfer,
  user,
} from '../db/schema.ts';
import { exportsOf, refuse } from '../demo.ts';
import type { Jobs } from '../jobs.ts';
import { ENQUEUE_TIMEOUT_MS, within } from '../queues.ts';
import { sha256 } from '../secrets.ts';
import {
  canExport,
  type TransferRow,
  toTransfer,
  transferFile,
  transfersDir,
} from '../transfers/service.ts';
import { contentDisposition } from './assets-routes.ts';
import { requireActor, requireSession } from './auth-routes.ts';
import { HttpError, sendError } from './errors.ts';
import {
  creationKeyHash,
  rememberCreation,
  rememberedCreation,
  requestKeyHash,
} from './idempotency.ts';

interface Deps {
  db: Database;
  auth: Auth;
  jobs: Jobs;
  config: Config;
}

const v1 = (path: string) => `${API_PREFIX}${path}`;
const LIST_DAYS = 7;
const location = (id: string) => v1(`/transfers/${id}`);
/** Statuses the shared error codes do not have: the body keeps the usual shape. */
const plain = (code: string, message: string) => ({ error: { code, message } });
const ACTIVE = ['queued', 'running'] as const;
/** The `Idempotency-Key` scope of imports (decision 0127). */
const IMPORTS = 'imports';

/** Project exports and imports (decision 0037) and the administrators' backups. */
export function registerTransferRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth, jobs, config } = deps;
  const dataDir = config.DATA_DIR;
  const enqueue = (work: Promise<void>) =>
    within(work, ENQUEUE_TIMEOUT_MS, 'The job queue did not answer.');

  const own = async (req: FastifyRequest) => {
    const actor = await requireActor(auth, req, db);
    const { transferId } = z.object({ transferId: Id }).parse(req.params);
    const [row] = await db
      .select()
      .from(projectTransfer)
      .where(and(eq(projectTransfer.id, transferId), eq(projectTransfer.userId, actor.id)));
    if (!row) throw new HttpError('not_found', 'Transfer not found.');
    return { actor, row };
  };

  app.post(v1('/projects/:projectId/exports'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    if (!jobs.runTransfer) throw new HttpError('internal', 'Exports are not available.');
    const { projectId } = z.object({ projectId: Id }).parse(req.params);
    const [p] = await db.select().from(project).where(eq(project.id, projectId));
    if (!p) throw new HttpError('not_found', 'Project not found.');
    if (!(await canExport(db, actor.id, projectId)))
      throw new HttpError('forbidden', 'Only owners and editors can export a project.');
    const [pending] = await db
      .select()
      .from(projectTransfer)
      .where(
        and(
          eq(projectTransfer.userId, actor.id),
          eq(projectTransfer.projectId, projectId),
          eq(projectTransfer.kind, 'export'),
          inArray(projectTransfer.status, ['queued', 'running']),
        ),
      );
    if (pending)
      return reply.status(202).header('location', location(pending.id)).send(toTransfer(pending));
    const [row] = await db.transaction(async (tx) => {
      // A demo sandbox exports once (decision 0084): counted under a lock, so two clicks
      // together cannot make two archives.
      if (config.DEMO_MODE) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`demo-export:${actor.id}`}))`);
        if ((await exportsOf(tx, actor.id)) >= 1) throw refuse('rate_limited', 'demo_export');
      }
      return tx
        .insert(projectTransfer)
        .values({ kind: 'export', userId: actor.id, projectId, projectName: p.name })
        .returning();
    });
    if (!row) throw new Error('Transfer insert returned nothing');
    try {
      await enqueue(jobs.runTransfer(row.id));
    } catch (err) {
      await db.delete(projectTransfer).where(eq(projectTransfer.id, row.id));
      throw err;
    }
    return reply.status(202).header('location', location(row.id)).send(toTransfer(row));
  });

  // The archive streams to disk as it arrives; the worker reads it afterwards.
  app.register(async (scope) => {
    scope.addContentTypeParser(
      ['application/zip', 'application/x-zip-compressed'],
      (_req, payload, done) => done(null, payload),
    );
    scope.post(v1('/projects/import'), async (req, reply) => {
      const actor = await requireActor(auth, req, db);
      await requireProjectCreation(db, config, actor);
      if (!jobs.runTransfer) throw new HttpError('internal', 'Imports are not available.');
      const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      if (type !== 'application/zip' && type !== 'application/x-zip-compressed')
        return reply.status(415).send({
          error: { code: 'bad_request', message: 'Send the archive as application/zip.' },
        });
      const max = config.IMPORT_MAX_SIZE > 0 ? config.IMPORT_MAX_SIZE : Number.MAX_SAFE_INTEGER;
      const declared = Number(req.headers['content-length']);
      if (!Number.isFinite(declared) || declared <= 0)
        return reply.status(411).send(plain('bad_request', 'Content-Length is required.'));
      // Decision 0127: the key is looked up before anything that depends on the archive or on
      // other imports, under its lock only for this short transaction, never while receiving.
      const keyHash = requestKeyHash(req, actor.id, IMPORTS);
      const fingerprint = sha256(JSON.stringify({ contentLength: declared }));
      const replay = async (transferId: string) => {
        const [first] = await db
          .select()
          .from(projectTransfer)
          .where(eq(projectTransfer.id, transferId));
        if (!first) throw new HttpError('not_found', 'The import of this key was removed.');
        return reply.status(202).header('location', location(first.id)).send(toTransfer(first));
      };
      if (keyHash) {
        const previous = await db.transaction((tx) => rememberedCreation(tx, keyHash, fingerprint));
        if (previous) return replay(previous);
      }
      // One at a time per person (also enforced by a unique index): checked before receiving.
      const [busy] = await db
        .select({ id: projectTransfer.id })
        .from(projectTransfer)
        .where(
          and(
            eq(projectTransfer.userId, actor.id),
            eq(projectTransfer.kind, 'import'),
            inArray(projectTransfer.status, ACTIVE),
          ),
        );
      if (busy) return sendError(reply, 'conflict', 'Another import of yours is still running.');
      if (declared > max)
        throw new HttpError(
          'payload_too_large',
          'The archive is larger than this server accepts.',
          {
            max,
          },
        );
      const id = randomUUID();
      await mkdir(transfersDir(dataDir), { recursive: true, mode: 0o700 });
      const file = transferFile(dataDir, id);
      const partial = `${file}.partial`;
      let seen = 0;
      const limit = new Transform({
        transform(chunk, _enc, done) {
          seen += chunk.length;
          if (seen > max) done(new HttpError('payload_too_large', 'The archive is too large.'));
          else done(null, chunk);
        },
      });
      try {
        await pipeline(
          req.body as NodeJS.ReadableStream,
          limit,
          createWriteStream(partial, { mode: 0o600 }),
        );
        await rename(partial, file);
      } catch (err) {
        await rm(partial, { force: true });
        throw err;
      }
      // The key is checked again under its lock: a request with the same key may have been
      // received meanwhile and committed first. Then this archive is discarded.
      let outcome: { row?: TransferRow; replayed?: string };
      try {
        outcome = await db.transaction(async (tx) => {
          if (keyHash) {
            const previous = await rememberedCreation(tx, keyHash, fingerprint);
            if (previous) return { replayed: previous };
          }
          const [inserted] = await tx
            .insert(projectTransfer)
            .values({ id, kind: 'import', userId: actor.id, projectName: '', size: seen })
            .onConflictDoNothing()
            .returning();
          if (inserted && keyHash) await rememberCreation(tx, keyHash, actor.id, fingerprint, id);
          return { row: inserted };
        });
      } catch (err) {
        await rm(file, { force: true });
        throw err;
      }
      if (outcome.replayed) {
        await rm(file, { force: true });
        return replay(outcome.replayed);
      }
      const row = outcome.row;
      if (!row) {
        // Another import of the same person started while this one was being received.
        await rm(file, { force: true });
        return sendError(reply, 'conflict', 'Another import of yours is still running.');
      }
      try {
        await enqueue(jobs.runTransfer(id));
      } catch (err) {
        // Nothing was started: the key is forgotten too, so a retry imports again.
        if (keyHash) await db.delete(creationRequest).where(eq(creationRequest.keyHash, keyHash));
        await db.delete(projectTransfer).where(eq(projectTransfer.id, id));
        await rm(file, { force: true });
        throw err;
      }
      return reply.status(202).header('location', location(id)).send(toTransfer(row));
    });
  });

  app.get(v1('/transfers'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const rows = await db
      .select()
      .from(projectTransfer)
      .where(
        and(
          eq(projectTransfer.userId, actor.id),
          gt(projectTransfer.createdAt, new Date(Date.now() - LIST_DAYS * 86400 * 1000)),
        ),
      )
      .orderBy(desc(projectTransfer.createdAt))
      .limit(50);
    return { items: rows.map(toTransfer), nextCursor: null };
  });

  // Registered before `/transfers/:transferId`, so `import-requests` is never read as an id.
  // Only the caller's own key matches: it is hashed with the person (decision 0127).
  app.get(v1('/transfers/import-requests/:idempotencyKey'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { idempotencyKey } = z
      .object({ idempotencyKey: ImportIdempotencyKey })
      .parse(req.params);
    const [found] = await db
      .select({ transfer: projectTransfer })
      .from(creationRequest)
      .innerJoin(projectTransfer, eq(projectTransfer.id, creationRequest.resourceId))
      .where(
        and(
          eq(creationRequest.keyHash, creationKeyHash(actor.id, IMPORTS, idempotencyKey)),
          gt(creationRequest.expiresAt, new Date()),
          eq(projectTransfer.userId, actor.id),
        ),
      );
    if (!found) throw new HttpError('not_found', 'No import of yours has this key.');
    return toTransfer(found.transfer);
  });

  app.get(v1('/transfers/:transferId'), async (req) => toTransfer((await own(req)).row));

  app.get(v1('/transfers/:transferId/download'), async (req, reply) => {
    const { actor, row } = await own(req);
    if (row.kind !== 'export') throw new HttpError('not_found', 'No archive to download.');
    if (row.status !== 'ready') return sendError(reply, 'conflict', 'The export is not ready.');
    if (!row.projectId) throw new HttpError('not_found', 'The project no longer exists.');
    const expired = () => reply.status(410).send(plain('not_found', 'The export has expired.'));
    if (row.expiresAt && row.expiresAt < new Date()) return expired();
    if (!(await canExport(db, actor.id, row.projectId)))
      throw new HttpError('forbidden', 'Only owners and editors can download the export.');
    const file = transferFile(dataDir, row.id);
    const info = await stat(file).catch(() => null);
    if (!info) return expired();
    const date = row.createdAt.toISOString().slice(0, 10);
    const name = `${row.projectName.replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').trim() || 'project'} ${date}.inkadra.zip`;
    return reply
      .header('content-type', 'application/zip')
      .header('content-length', info.size)
      .header('cache-control', 'private, no-store')
      .header('content-disposition', contentDisposition('attachment', name))
      .send(createReadStream(file));
  });

  /**
   * Marks a queued or running transfer cancelled in one conditional update; the worker, in
   * whatever process, sees it on its next step, stops and removes its files. The row stays in
   * the list as failed. Returns the cancelled row, or nothing when it had already finished.
   */
  const cancel = async (row: TransferRow) => {
    const [stopped] = await db
      .update(projectTransfer)
      .set({ status: 'failed', failure: 'cancelled', finishedAt: new Date() })
      .where(and(eq(projectTransfer.id, row.id), inArray(projectTransfer.status, ACTIVE)))
      .returning();
    // A queued import's uploaded archive: no worker will ever read it.
    if (stopped && row.status === 'queued')
      await rm(transferFile(dataDir, row.id), { force: true });
    return stopped;
  };

  app.delete(v1('/transfers/:transferId'), async (req, reply) => {
    const { row } = await own(req);
    if (!(await cancel(row))) {
      await db.delete(projectTransfer).where(eq(projectTransfer.id, row.id));
      await rm(transferFile(dataDir, row.id), { force: true });
    }
    return reply.status(204).send();
  });

  // Cancel only, never remove (decision 0125): a finished transfer answers 409 as it is now.
  app.post(v1('/transfers/:transferId/cancel'), async (req) => {
    const { row } = await own(req);
    const stopped = await cancel(row);
    if (stopped) return toTransfer(stopped);
    // Removed meanwhile (a DELETE, the hourly sweep): unknown, as the other routes say.
    const [now] = await db.select().from(projectTransfer).where(eq(projectTransfer.id, row.id));
    if (!now) throw new HttpError('not_found', 'Transfer not found.');
    throw new HttpError('conflict', 'The transfer has already finished.', toTransfer(now));
  });

  // Backups: administrators only, with a session (not a token), like the other instance pages.
  const admin = async (req: FastifyRequest) => {
    const { user: actor } = await requireSession(auth, req, db);
    if (actor.role !== 'admin') throw new HttpError('forbidden', 'Administrators only.');
    return actor;
  };
  const overview = async (): Promise<InstanceBackups> => {
    // A backup whose process died never says so: mark it before listing, so the page shows
    // `interrupted` instead of a backup running for ever.
    await reapStaleBackups(db);
    const settings = await readBackupSettings(db);
    const rows = await db
      .select()
      .from(instanceBackup)
      .orderBy(desc(instanceBackup.startedAt))
      .limit(30);
    return {
      settings,
      timeZone: serverTimeZone(),
      bucket: config.STORAGE_DRIVER === 's3',
      nextRunAt: jobs.scheduleBackups ? (nextBackupAt(settings)?.toISOString() ?? null) : null,
      items: rows.map(toBackup),
    };
  };

  app.get(v1('/instance/backups'), async (req) => {
    await admin(req);
    return overview();
  });

  app.patch(v1('/instance/backups/settings'), async (req) => {
    const actor = await admin(req);
    const patch = UpdateBackupSettings.parse(req.body ?? {});
    const settings = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
      const [current] = await tx.select().from(user).where(eq(user.id, actor.id));
      if (current?.role !== 'admin' || current.deactivatedAt)
        throw new HttpError('forbidden', 'Administrators only.');
      const value = BackupSettings.parse({ ...(await readBackupSettings(tx)), ...patch });
      await tx
        .insert(instanceSetting)
        .values({ key: 'backup', value })
        .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
      return value;
    });
    if (jobs.scheduleBackups) await enqueue(jobs.scheduleBackups(settings));
    return settings;
  });

  app.post(v1('/instance/backups'), async (req, reply) => {
    const actor = await admin(req);
    if (!jobs.runBackup) throw new HttpError('internal', 'Backups are not available.');
    const row = await startBackup(db, 'manual', actor.id);
    if (!row) return sendError(reply, 'conflict', 'A backup is already running.');
    try {
      await enqueue(jobs.runBackup(row.id));
    } catch (err) {
      await db.delete(instanceBackup).where(eq(instanceBackup.id, row.id));
      throw err;
    }
    return reply.status(202).send(toBackup(row));
  });
}
