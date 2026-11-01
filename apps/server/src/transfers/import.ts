import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import {
  CURRENT_SCHEMA_VERSION,
  migrateBoardDoc,
  roots,
  SchemaTooNewError,
  validateBoardDoc,
} from '@inkadra/doc-schema';
import {
  ArchiveAsset,
  ArchiveBoard,
  ArchiveComment,
  ArchiveExportSettings,
  ArchivePerson,
  ArchiveProject,
  ArchiveReviews,
  ArchiveShootingDay,
  ArchiveVersion,
  checkArchiveStructure,
  EXPORT_LOGO_MAX_BYTES,
  EXPORT_LOGO_TYPES,
  PROJECT_ARCHIVE_LIMITS as LIMITS,
  PROJECT_ARCHIVE_FORMAT,
  PROJECT_ARCHIVE_VERSION,
  ProjectArchiveManifest,
  type TransferSummary,
  z,
} from '@inkadra/shared';
import { desc, eq, ne, sql } from 'drizzle-orm';
import type { PgInsertValue, PgTable } from 'drizzle-orm/pg-core';
import { generateKeyBetween } from 'fractional-indexing';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import type { Database } from '../db/client.ts';
import {
  asset,
  board,
  boardDoc,
  boardVersion,
  comment,
  elementReview,
  elementReviewEvent,
  project,
  projectExportSettings,
  projectMember,
  shootingDay,
} from '../db/schema.ts';
import { readPreferences } from '../http/export-settings-routes.ts';
import { cleanMime, kindOf } from '../http/uploads.ts';
import type { Jobs } from '../jobs.ts';
import { writeBoardIndex } from '../search/index-doc.ts';
import { originalKey, type Storage } from '../storage.ts';
import { remapDoc, remapMentions } from './remap.ts';
import { ArchiveError, piped, readZip, type ZipReader } from './zip.ts';

export interface ImportDeps {
  db: Database;
  storage: Storage;
  jobs: Pick<Jobs, 'processAsset'>;
  /** Largest file, as UPLOAD_MAX_SIZE; 0 = no limit. */
  uploadMaxSize: number;
  /** Largest archive, uncompressed (IMPORT_MAX_SIZE). */
  importMaxSize: number;
  log?: Logger;
}

const json = LIMITS.jsonBytes;
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max);

async function optionalJson<T extends z.ZodType>(
  zip: ZipReader,
  name: string,
  schema: T,
  empty: z.infer<T>,
): Promise<z.infer<T>> {
  return zip.has(name) ? zip.json(name, schema, json) : empty;
}

/** Loads and checks a document of the archive, migrated to this server's schema. */
async function loadDoc(zip: ZipReader, name: string, boardId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const state = await zip.buffer(name, LIMITS.documentBytes);
  try {
    Y.applyUpdate(doc, state);
  } catch {
    throw new ArchiveError('invalid_archive', `${name} is not a Yjs document.`);
  }
  try {
    migrateBoardDoc(doc, boardId);
  } catch (err) {
    if (err instanceof SchemaTooNewError)
      throw new ArchiveError('too_new', 'The archive comes from a newer Inkadra.');
    throw err;
  }
  if (roots(doc).elements.size > LIMITS.elements)
    throw new ArchiveError('too_large', `${name} has too many elements.`);
  const issues = validateBoardDoc(doc);
  if (issues.length > 0)
    throw new ArchiveError('invalid_archive', `${name}: ${issues[0]?.message ?? 'invalid'}`);
  return doc;
}

/** Parents before children, whatever order boards.json lists them in (the tree is checked). */
function treeOrder(boards: ArchiveBoard[]): ArchiveBoard[] {
  const children = new Map<string | null, ArchiveBoard[]>();
  for (const b of boards) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b]);
  const ordered: ArchiveBoard[] = [];
  const queue = [...(children.get(null) ?? [])];
  while (queue.length) {
    const b = queue.shift() as ArchiveBoard;
    ordered.push(b);
    queue.push(...(children.get(b.id) ?? []));
  }
  return ordered;
}

/**
 * Creates a project from an archive (decision 0037), owned by `userId` alone. Files go to
 * storage first, then everything else in one transaction; on failure before the commit the
 * files are removed, after it they belong to the project.
 */
export async function importProject(
  deps: ImportDeps,
  path: string,
  userId: string,
  progress: (done: number) => Promise<void> | void = () => {},
): Promise<{ projectId: string; projectName: string; summary: TransferSummary }> {
  const { db, storage } = deps;
  const zip = await readZip(path, {
    entries: LIMITS.entries,
    totalBytes: deps.importMaxSize,
    compressionRatio: LIMITS.compressionRatio,
  });
  const written: string[] = [];
  let committed = false;
  try {
    const raw = await zip.json('manifest.json', z.object({ format: z.string() }).loose(), json);
    if (raw.format !== PROJECT_ARCHIVE_FORMAT)
      throw new ArchiveError('invalid_archive', 'Not an Inkadra project archive.');
    const manifest = await zip.json('manifest.json', ProjectArchiveManifest, json);
    if (manifest.formatVersion > PROJECT_ARCHIVE_VERSION)
      throw new ArchiveError(
        'unsupported_version',
        'The archive format is newer than this server.',
      );
    if (manifest.docSchemaVersion > CURRENT_SCHEMA_VERSION)
      throw new ArchiveError('too_new', 'The archive comes from a newer Inkadra.');

    const meta = await zip.json('project.json', ArchiveProject, json);
    const listed = await zip.json('boards.json', list(ArchiveBoard, LIMITS.boards), json);
    const people = await optionalJson(zip, 'people.json', list(ArchivePerson, LIMITS.people), []);
    const assets = await optionalJson(zip, 'assets.json', list(ArchiveAsset, LIMITS.assets), []);
    const versions = await optionalJson(
      zip,
      'versions.json',
      list(ArchiveVersion, LIMITS.versions),
      [],
    );
    const comments = await optionalJson(
      zip,
      'comments.json',
      list(ArchiveComment, LIMITS.comments),
      [],
    );
    const reviews = await optionalJson(
      zip,
      'reviews.json',
      z.object({
        current: list(ArchiveReviews.shape.current.element, LIMITS.rows),
        history: list(ArchiveReviews.shape.history.element, LIMITS.rows),
      }),
      { current: [], history: [] },
    );
    const exportSettings = await optionalJson(
      zip,
      'export-settings.json',
      ArchiveExportSettings.nullable(),
      null,
    );
    const days = await optionalJson(
      zip,
      'schedule.json',
      list(ArchiveShootingDay, LIMITS.rows),
      [],
    );
    const problem = checkArchiveStructure({
      boards: listed,
      assets,
      comments,
      versions,
      reviews,
      schedule: days,
      logoAssetId: exportSettings?.logoAssetId ?? null,
    });
    if (problem) throw new ArchiveError('invalid_archive', `Inconsistent archive: ${problem}.`);
    const boards = treeOrder(listed);
    const root = boards[0] as ArchiveBoard;

    // People are never matched to accounts (decision 0037): everything belongs to the
    // importer and keeps the author's name as display-only text.
    const names = new Map(people.map((p) => [p.id.toLowerCase(), p.name]));
    const person = (_id: string) => userId;
    const personOrNull = (id: string | null) => (id ? userId : null);
    const nameOf = (id: string | null) => (id ? (names.get(id.toLowerCase()) ?? null) : null);
    const remappedPeople = people.length;

    const boardIds = new Map(boards.map((b) => [b.id, randomUUID()]));
    for (const b of boards)
      if (b !== root && !isOrderKey(b.position))
        throw new ArchiveError('invalid_archive', `Board ${b.id} has an invalid position.`);

    // Documents first: a bad one fails the import before any file is written. Each is loaded,
    // checked and dropped; the import reads it again when it writes it, so memory holds one
    // document at a time whatever the size of the project.
    for (const b of boards) {
      const name = `boards/${b.id}/document.yjs`;
      if (zip.has(name)) (await loadDoc(zip, name, boardIds.get(b.id) as string)).destroy();
    }
    for (const v of versions) {
      const id = boardIds.get(v.boardId);
      const name = `versions/${v.id}.yjs`;
      if (id && zip.has(name)) (await loadDoc(zip, name, id)).destroy();
    }
    await progress(0.05);

    // Files: streamed into storage with the size and checksum checked on the way.
    const totalBytes = assets.reduce((n, a) => n + a.size, 0) || 1;
    let bytesDone = 0;
    let skippedFiles = 0;
    const stored = new Map<string, { id: string; size: number; sha256: string }>();
    const max = deps.uploadMaxSize > 0 ? deps.uploadMaxSize : Number.MAX_SAFE_INTEGER;
    for (const a of assets) {
      const name = `files/${a.id}`;
      const size = zip.size(name);
      if (size === null || size !== a.size || size > max) {
        skippedFiles += 1;
        continue;
      }
      const id = randomUUID();
      const hash = createHash('sha256');
      const hashing = new Transform({
        transform(chunk, _enc, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      });
      const key = originalKey(id);
      written.push(key);
      // piped: a damaged or truncated entry fails the write instead of hanging it.
      await storage.writeStream(
        key,
        piped(await zip.stream(name, size), hashing),
        cleanMime(a.mime, a.filename),
      );
      const digest = hash.digest('hex');
      if (a.sha256 && a.sha256 !== digest) {
        await storage.remove([key]);
        written.pop();
        skippedFiles += 1;
        continue;
      }
      stored.set(a.id, { id, size, sha256: digest });
      bytesDone += size;
      await progress(0.05 + 0.85 * (bytesDone / totalBytes));
    }
    const maps = {
      boards: boardIds,
      assets: new Map([...stored].map(([from, file]) => [from, file.id])),
      person,
    };
    /** A document of the archive, checked, migrated and pointing at this project's ids. */
    const document = async (name: string, boardId: string) => {
      const doc = zip.has(name) ? await loadDoc(zip, name, boardId) : new Y.Doc();
      if (!zip.has(name)) migrateBoardDoc(doc, boardId);
      remapDoc(doc, boardId, maps);
      return doc;
    };

    const projectId = randomUUID();
    const commentIds = new Map(comments.map((c) => [c.id, randomUUID()]));
    let elements = 0;
    const created = await db.transaction(async (tx) => {
      await tx.insert(project).values({
        id: projectId,
        name: meta.name,
        iconShape: meta.icon.shape,
        iconColor: meta.icon.color,
        iconEmoji: meta.icon.emoji ?? null,
        type: meta.type,
        shootingStart: meta.shootingStart,
        shootingEnd: meta.shootingEnd,
        // Set at the end, under the instance lock (see below).
        position: 'a0',
        createdBy: userId,
      });
      await tx.insert(projectMember).values({ projectId, userId, role: 'owner' });

      await insertBatches(
        tx,
        asset,
        assets.flatMap((a) => {
          const file = stored.get(a.id);
          if (!file) return [];
          const mime = cleanMime(a.mime, a.filename);
          return [
            {
              id: file.id,
              projectId,
              kind: kindOf(mime, a.filename),
              mime,
              filename: a.filename,
              size: file.size,
              sha256: file.sha256,
              storageKey: originalKey(file.id),
              status: 'processing' as const,
              sourceUrl: a.sourceUrl,
              createdBy: personOrNull(a.createdBy),
              importedAuthor: nameOf(a.createdBy),
              createdAt: new Date(a.createdAt),
            },
          ];
        }),
      );

      // Boards one by one, parents first: each carries its document and search index.
      for (const b of boards) {
        const isRoot = b === root;
        const id = boardIds.get(b.id) as string;
        const cover = b.coverAssetId ? stored.get(b.coverAssetId)?.id : null;
        await tx.insert(board).values({
          id,
          projectId,
          parentBoardId: b.parentId ? (boardIds.get(b.parentId) as string) : null,
          kind: b.kind,
          // The root board carries the project name, as on creation.
          title: isRoot ? meta.name : b.title,
          position: isRoot ? 'a0' : b.position,
          coverAssetId: cover ?? null,
          icon: b.icon ?? null,
          docSchemaVersion: CURRENT_SCHEMA_VERSION,
          createdBy: personOrNull(b.createdBy),
          createdAt: new Date(b.createdAt),
        });
        const doc = await document(`boards/${b.id}/document.yjs`, id);
        try {
          const state = Y.encodeStateAsUpdate(doc);
          await tx.insert(boardDoc).values({
            boardId: id,
            state,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            size: state.byteLength,
          });
          elements += await writeBoardIndex(tx, id, doc);
        } finally {
          doc.destroy();
        }
      }

      for (const v of versions) {
        const boardId = boardIds.get(v.boardId);
        const name = `versions/${v.id}.yjs`;
        if (!boardId || !zip.has(name)) continue;
        const doc = await document(name, boardId);
        try {
          const state = Y.encodeStateAsUpdate(doc);
          await tx.insert(boardVersion).values({
            boardId,
            kind: 'named',
            name: v.name,
            state,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            size: state.byteLength,
            elementCount: roots(doc).elements.size,
            createdBy: personOrNull(v.createdBy),
            importedAuthor: nameOf(v.createdBy),
            createdAt: new Date(v.createdAt),
          });
        } finally {
          doc.destroy();
        }
      }

      // Thread starts before replies (the structure check made sure every reply has one).
      const guestThreads = new Set(
        comments.filter((c) => c.threadId === null && c.guestName !== null).map((c) => c.id),
      );
      const commentRow = (c: (typeof comments)[number]) => {
        const guest = c.guestName !== null;
        return {
          id: commentIds.get(c.id) as string,
          projectId,
          boardId: boardIds.get(c.boardId) as string,
          elementId: c.elementId,
          threadId: c.threadId ? (commentIds.get(c.threadId) as string) : null,
          // Guests and people alike become the importer, with their name kept for display.
          authorId: guest ? userId : personOrNull(c.authorId),
          importedAuthor: guest ? c.guestName || null : nameOf(c.authorId),
          body: c.deletedAt ? '' : remapMentions(c.body, names),
          mentions: [],
          // Share links are not exported: a guest thread without its link would read, under
          // decision 0013, as visible to every link. Replies follow their thread.
          visibility:
            guest || (c.threadId !== null && guestThreads.has(c.threadId))
              ? ('team' as const)
              : c.visibility,
          pin: c.pin,
          resolvedAt: c.threadId === null && c.resolvedAt ? new Date(c.resolvedAt) : null,
          resolvedBy: c.threadId === null && c.resolvedAt ? personOrNull(c.resolvedBy) : null,
          createdAt: new Date(c.createdAt),
          editedAt: c.editedAt ? new Date(c.editedAt) : null,
          deletedAt: c.deletedAt ? new Date(c.deletedAt) : null,
        };
      };
      await insertBatches(tx, comment, comments.filter((c) => c.threadId === null).map(commentRow));
      await insertBatches(tx, comment, comments.filter((c) => c.threadId !== null).map(commentRow));

      // One team status per card: the last one listed wins.
      const current = new Map<string, (typeof reviews.current)[number]>();
      for (const r of reviews.current) current.set(`${r.boardId}:${r.elementId}`, r);
      await insertBatches(
        tx,
        elementReview,
        [...current.values()].map((r) => ({
          boardId: boardIds.get(r.boardId) as string,
          projectId,
          elementId: r.elementId,
          status: r.status,
          note: r.note,
          changedBy: personOrNull(r.changedBy),
          importedAuthor: nameOf(r.changedBy),
          requestedBy: personOrNull(r.requestedBy),
          changedAt: new Date(r.changedAt),
        })),
      );
      await insertBatches(
        tx,
        elementReviewEvent,
        reviews.history.map((e) => ({
          boardId: boardIds.get(e.boardId) as string,
          elementId: e.elementId,
          previous: e.previous,
          status: e.status,
          note: e.note,
          userId: personOrNull(e.userId),
          importedAuthor: nameOf(e.userId),
          createdAt: new Date(e.createdAt),
        })),
      );
      await insertBatches(
        tx,
        shootingDay,
        days.map((d) => ({
          projectId,
          boardId: boardIds.get(d.boardId) as string,
          date: d.date,
          callTime: d.callTime,
          wrap: d.wrap,
          location: d.location,
          notes: d.notes,
          blocks: d.blocks,
        })),
      );

      if (exportSettings) {
        // The logo stays only if its file was stored and is one a logo may be (decision 0039).
        const logo = exportSettings.logoAssetId
          ? assets.find((a) => a.id === exportSettings.logoAssetId)
          : undefined;
        const file = logo ? stored.get(logo.id) : undefined;
        const fits =
          logo !== undefined &&
          file !== undefined &&
          file.size <= EXPORT_LOGO_MAX_BYTES &&
          (EXPORT_LOGO_TYPES as readonly string[]).includes(cleanMime(logo.mime, logo.filename));
        await tx.insert(projectExportSettings).values({
          projectId,
          preferences: readPreferences(exportSettings.preferences),
          logoAssetId: fits ? file.id : null,
          updatedBy: userId,
        });
      }

      // The instance lock orders projects (and guards other instance-wide changes): taken
      // last, so it is held only for this update and the commit, not the whole import.
      await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
      const [last] = await tx
        .select({ position: project.position })
        .from(project)
        .where(ne(project.id, projectId))
        .orderBy(desc(project.position))
        .limit(1);
      await tx
        .update(project)
        .set({ position: generateKeyBetween(last?.position ?? null, null) })
        .where(eq(project.id, projectId));
      return { commentCount: comments.length };
    });
    // From here the project exists: its files belong to it and are never removed on error.
    committed = true;

    // Thumbnails, EXIF and palette are made again, as for any upload. Best effort: an asset
    // whose job could not be queued stays `processing`, and the hourly sweep queues it again.
    for (const file of stored.values()) {
      await deps.jobs.processAsset(file.id).catch((err) => {
        deps.log?.warn({ err, asset: file.id }, 'imported file not queued, the sweep retries');
      });
    }
    await progress(1);
    return {
      projectId,
      projectName: meta.name,
      summary: {
        boards: boards.length,
        elements,
        files: stored.size,
        comments: created.commentCount,
        skippedFiles,
        remappedPeople,
      },
    };
  } catch (err) {
    if (!committed && written.length) await storage.remove(written).catch(() => {});
    throw err;
  } finally {
    zip.close();
  }
}

/** Is `key` a fractional-index key, as board positions are? */
function isOrderKey(key: string): boolean {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/** Multi-row inserts, a few hundred rows per statement. */
async function insertBatches<T extends PgTable>(
  tx: Pick<Database, 'insert'>,
  table: T,
  rows: PgInsertValue<T>[],
  size = 500,
) {
  for (let i = 0; i < rows.length; i += size)
    await tx.insert(table).values(rows.slice(i, i + size));
}
