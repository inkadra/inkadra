import { randomUUID } from 'node:crypto';
import {
  CURRENT_SCHEMA_VERSION,
  getAnimaticAudio,
  getBoardAspect,
  getSchemaVersion,
  readElement,
  roots,
} from '@inkadra/doc-schema';
import {
  type ArchiveAsset,
  type ArchiveBoard,
  type ArchiveComment,
  type ArchiveExportSettings,
  type ArchivePerson,
  type ArchiveReviews,
  type ArchiveShootingDay,
  type ArchiveVersion,
  classificationOption,
  PROJECT_ARCHIVE_FORMAT,
  PROJECT_ARCHIVE_VERSION,
  type ProjectArchiveManifest,
  type TransferSummary,
} from '@inkadra/shared';
import { and, asc, eq, getTableColumns, inArray, isNull, ne } from 'drizzle-orm';
import * as Y from 'yjs';
import { readClassifications } from '../classifications.ts';
import { VERSION } from '../config.ts';
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
  shareGuest,
  shootingDay,
  user,
} from '../db/schema.ts';
import { fragmentText } from '../search/index-doc.ts';
import type { Storage } from '../storage.ts';
import { writeZip } from './zip.ts';

const iso = (d: Date) => d.toISOString();

/** The archive accepts only http(s) sources; anything else stored long ago is left out. */
function webAddress(url: string | null): string | null {
  if (!url || url.length > 2048) return null;
  try {
    return /^https?:$/.test(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** Every column of a version but its state, which is read one version at a time. */
const versionColumns = (() => {
  const { state: _state, ...columns } = getTableColumns(boardVersion);
  return columns;
})();

/** Media is already compressed: deflating it only costs time. */
const COMPRESSIBLE = /^(text\/|application\/(json|xml|pdf|rtf)|image\/svg)/;

export type ExportProgress = (done: number) => Promise<void> | void;

/** Readable JSON of a document: doc-schema elements plus the plain text of notes. */
export function readableElements(doc: Y.Doc) {
  const elements: Record<string, unknown>[] = [];
  for (const map of roots(doc).elements.values()) {
    const el = readElement(map);
    if (!el) continue;
    const body = map.get('body');
    elements.push(body instanceof Y.XmlFragment ? { ...el, text: fragmentText(body) } : el);
  }
  elements.sort((a, b) => String(a.z).localeCompare(String(b.z)));
  return elements;
}

/** createdBy of every element: people the archive must name. */
function elementAuthors(doc: Y.Doc, into: Set<string>) {
  for (const map of roots(doc).elements.values()) {
    const by = map.get('createdBy');
    if (typeof by === 'string') into.add(by);
  }
}

/**
 * Writes the archive of a project to `path` (layout in docs/formats/project-archive.md).
 * Documents are read as stored. `progress` gets the share done, 0 to 1.
 */
export async function exportProject(
  deps: { db: Database; storage: Storage },
  projectId: string,
  path: string,
  progress: ExportProgress = () => {},
): Promise<{ size: number; summary: TransferSummary }> {
  const { db, storage } = deps;
  // Rows in one consistent snapshot. Documents and versions, the large values, are read one
  // at a time afterwards: documents are live anyway (decision 0037), versions never change.
  const snapshot = await db.transaction(
    async (tx) => {
      const [p] = await tx.select().from(project).where(eq(project.id, projectId));
      if (!p) throw new Error('Project not found');

      const boards = await tx
        .select()
        .from(board)
        .where(and(eq(board.projectId, projectId), isNull(board.deletedAt)))
        .orderBy(asc(board.createdAt), asc(board.id));
      // Parents before children, so an importer can create them in order.
      const byId = new Map(boards.map((b) => [b.id, b]));
      const ordered: typeof boards = [];
      const placed = new Set<string>();
      const place = (b: (typeof boards)[number]) => {
        if (placed.has(b.id)) return;
        const parent = b.parentBoardId ? byId.get(b.parentBoardId) : undefined;
        if (b.parentBoardId && !parent) return; // under a board in the trash
        if (parent) place(parent);
        if (parent && !placed.has(parent.id)) return;
        placed.add(b.id);
        ordered.push(b);
      };
      for (const b of boards) place(b);
      const boardIds = ordered.map((b) => b.id);

      const assets = await tx
        .select()
        .from(asset)
        .where(and(eq(asset.projectId, projectId), ne(asset.status, 'pending')))
        .orderBy(asc(asset.createdAt), asc(asset.id));
      const versions = boardIds.length
        ? await tx
            .select(versionColumns)
            .from(boardVersion)
            .where(and(inArray(boardVersion.boardId, boardIds), eq(boardVersion.kind, 'named')))
            .orderBy(asc(boardVersion.createdAt), asc(boardVersion.id))
        : [];
      const comments = boardIds.length
        ? await tx
            .select({ c: comment, guestName: shareGuest.name })
            .from(comment)
            .leftJoin(shareGuest, eq(shareGuest.id, comment.authorGuestId))
            .where(inArray(comment.boardId, boardIds))
            .orderBy(asc(comment.createdAt), asc(comment.id))
        : [];
      const reviews = boardIds.length
        ? await tx
            .select()
            .from(elementReview)
            .where(and(inArray(elementReview.boardId, boardIds), isNull(elementReview.shareLinkId)))
        : [];
      const events = boardIds.length
        ? await tx
            .select()
            .from(elementReviewEvent)
            .where(
              and(
                inArray(elementReviewEvent.boardId, boardIds),
                isNull(elementReviewEvent.shareLinkId),
              ),
            )
            .orderBy(asc(elementReviewEvent.createdAt), asc(elementReviewEvent.id))
        : [];
      const days = boardIds.length
        ? await tx
            .select()
            .from(shootingDay)
            .where(inArray(shootingDay.boardId, boardIds))
            .orderBy(asc(shootingDay.date), asc(shootingDay.id))
        : [];
      const catalogs = await readClassifications(tx);
      const [exportSettings] = await tx
        .select()
        .from(projectExportSettings)
        .where(eq(projectExportSettings.projectId, projectId));
      return {
        p,
        ordered,
        boardIds,
        assets,
        versions,
        comments,
        reviews,
        events,
        days,
        catalogs,
        exportSettings,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  const { p, ordered, assets, versions, comments, reviews, events, days, catalogs } = snapshot;
  const { exportSettings } = snapshot;
  const assetIds = new Set(assets.map((a) => a.id));
  const people = new Set<string>();
  const add = (id: string | null) => {
    if (id) people.add(id);
  };
  // Rows that came with an earlier import name their author only by name: each name gets an
  // id of its own in people.json, so a second import shows the same names.
  const importedPeople = new Map<string, string>();
  const author = (id: string | null, importedAuthor: string | null) => {
    if (importedAuthor === null) {
      add(id);
      return id;
    }
    let person = importedPeople.get(importedAuthor);
    if (!person) {
      person = randomUUID();
      importedPeople.set(importedAuthor, person);
    }
    return person;
  };

  const totalBytes = assets.reduce((n, a) => n + a.size, 0);
  const totalSteps = ordered.length + versions.length;
  let stepsDone = 0;
  let bytesDone = 0;
  // Files weigh most; documents get a fixed share so small projects still move.
  const report = () =>
    progress(
      Math.min(
        0.99,
        0.3 * (totalSteps ? stepsDone / totalSteps : 1) +
          0.69 * (totalBytes ? bytesDone / totalBytes : 1),
      ),
    );

  const zip = writeZip(path);
  try {
    const archiveBoards: ArchiveBoard[] = [];
    let elements = 0;
    const tags = new Set<string>();
    let maxSchema = 0;
    for (const b of ordered) {
      add(b.createdBy);
      const [stored] = await db
        .select({ state: boardDoc.state })
        .from(boardDoc)
        .where(eq(boardDoc.boardId, b.id));
      const doc = new Y.Doc();
      if (stored) Y.applyUpdate(doc, stored.state);
      const schemaVersion = stored ? getSchemaVersion(doc) : CURRENT_SCHEMA_VERSION;
      maxSchema = Math.max(maxSchema, schemaVersion);
      elementAuthors(doc, people);
      const readable = readableElements(doc);
      elements += readable.length;
      for (const el of readable)
        for (const tag of (el.tags as string[] | undefined) ?? []) tags.add(tag);
      await zip.addBuffer(`boards/${b.id}/document.yjs`, Buffer.from(Y.encodeStateAsUpdate(doc)));
      await zip.addJson(`boards/${b.id}/elements.json`, {
        boardId: b.id,
        schemaVersion,
        aspect: getBoardAspect(doc),
        animaticAudio: getAnimaticAudio(doc),
        elements: readable,
      });
      doc.destroy();
      archiveBoards.push({
        id: b.id,
        parentId: b.parentBoardId,
        kind: b.kind,
        title: b.title,
        position: b.position,
        coverAssetId: b.coverAssetId && assetIds.has(b.coverAssetId) ? b.coverAssetId : null,
        icon: b.icon ?? null,
        schemaVersion,
        createdBy: b.createdBy,
        createdAt: iso(b.createdAt),
        updatedAt: iso(b.updatedAt),
      });
      stepsDone += 1;
      await report();
    }
    await zip.addJson('boards.json', archiveBoards);

    const archiveVersions: ArchiveVersion[] = [];
    for (const v of versions) {
      const [blob] = await db
        .select({ state: boardVersion.state })
        .from(boardVersion)
        .where(eq(boardVersion.id, v.id));
      if (!blob) continue; // removed meanwhile
      await zip.addBuffer(`versions/${v.id}.yjs`, Buffer.from(blob.state));
      archiveVersions.push({
        id: v.id,
        boardId: v.boardId,
        name: v.name ?? '',
        schemaVersion: v.schemaVersion,
        createdBy: author(v.createdBy, v.importedAuthor),
        createdAt: iso(v.createdAt),
      });
      stepsDone += 1;
      await report();
    }
    await zip.addJson('versions.json', archiveVersions);

    const archiveAssets: ArchiveAsset[] = [];
    let missing = 0;
    for (const a of assets) {
      const size = await storage.size(a.storageKey);
      // A file lost from storage is listed without content; the importer skips it.
      if (size !== null) {
        await zip.addStream(`files/${a.id}`, await storage.read(a.storageKey), {
          compress: COMPRESSIBLE.test(a.mime),
          size,
        });
      } else missing += 1;
      archiveAssets.push({
        id: a.id,
        kind: a.kind,
        mime: a.mime,
        filename: a.filename,
        size: size ?? a.size,
        sha256: a.sha256 && /^[0-9a-f]{64}$/.test(a.sha256) ? a.sha256 : null,
        sourceUrl: webAddress(a.sourceUrl),
        createdBy: author(a.createdBy, a.importedAuthor),
        createdAt: iso(a.createdAt),
      });
      bytesDone += a.size;
      await report();
    }
    await zip.addJson('assets.json', archiveAssets);

    const archiveComments: ArchiveComment[] = comments.map(({ c, guestName }) => {
      add(c.resolvedBy);
      // Mentions are only in live bodies; a deleted comment keeps its place, not its words.
      if (!c.deletedAt) for (const m of c.mentions) add(m);
      return {
        id: c.id,
        boardId: c.boardId,
        elementId: c.elementId,
        threadId: c.threadId,
        authorId: c.authorGuestId ? null : author(c.authorId, c.importedAuthor),
        guestName: c.authorGuestId ? (guestName ?? '') : null,
        body: c.deletedAt ? '' : c.body,
        // Comments tied to one share link would read as visible to every link elsewhere.
        visibility: c.shareLinkId ? 'team' : c.visibility,
        pin: c.pin ?? null,
        resolvedAt: isoOrNull(c.resolvedAt),
        resolvedBy: c.resolvedBy,
        createdAt: iso(c.createdAt),
        editedAt: isoOrNull(c.editedAt),
        deletedAt: isoOrNull(c.deletedAt),
      };
    });
    await zip.addJson('comments.json', archiveComments);

    const archiveReviews: ArchiveReviews = {
      current: reviews.map((r) => {
        add(r.requestedBy);
        return {
          boardId: r.boardId,
          elementId: r.elementId,
          status: r.status,
          note: r.note,
          changedBy: author(r.changedBy, r.importedAuthor),
          requestedBy: r.requestedBy,
          changedAt: iso(r.changedAt),
        };
      }),
      history: events.map((e) => {
        return {
          boardId: e.boardId,
          elementId: e.elementId,
          previous: e.previous,
          status: e.status,
          note: e.note,
          userId: author(e.userId, e.importedAuthor),
          createdAt: iso(e.createdAt),
        };
      }),
    };
    await zip.addJson('reviews.json', archiveReviews);

    const archiveDays: ArchiveShootingDay[] = days.map((d) => ({
      id: d.id,
      boardId: d.boardId,
      date: d.date,
      callTime: d.callTime,
      wrap: d.wrap,
      location: d.location,
      notes: d.notes,
      blocks: d.blocks,
    }));
    await zip.addJson('schedule.json', archiveDays);

    const label = (options: typeof catalogs.tags, value: string) => {
      const option = classificationOption(options, value);
      return { id: value, label: option?.label ?? value };
    };
    await zip.addJson('classifications.json', {
      projectTypes: p.type ? [label(catalogs.projectTypes, p.type)] : [],
      tags: [...tags].sort().map((t) => label(catalogs.tags, t)),
    });

    const ids = [...people].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    // Names only, never emails (decision 0037).
    const rows = ids.length
      ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))
      : [];
    const archivePeople: ArchivePerson[] = [
      ...rows,
      ...[...importedPeople].map(([name, id]) => ({ id, name: name.slice(0, 200) })),
    ];
    await zip.addJson('people.json', archivePeople);

    // Only when the project saved its export settings (decision 0039).
    if (exportSettings) {
      const settings: ArchiveExportSettings = {
        preferences: exportSettings.preferences,
        logoAssetId:
          exportSettings.logoAssetId && assetIds.has(exportSettings.logoAssetId)
            ? exportSettings.logoAssetId
            : null,
      };
      await zip.addJson('export-settings.json', settings);
    }

    await zip.addJson('project.json', {
      id: p.id,
      name: p.name,
      icon: {
        shape: p.iconShape,
        color: p.iconColor,
        ...(p.iconEmoji ? { emoji: p.iconEmoji } : {}),
      },
      type: p.type,
      shootingStart: p.shootingStart,
      shootingEnd: p.shootingEnd,
      archived: p.archivedAt !== null,
      createdAt: iso(p.createdAt),
    });
    const manifest: ProjectArchiveManifest = {
      format: PROJECT_ARCHIVE_FORMAT,
      formatVersion: PROJECT_ARCHIVE_VERSION,
      appVersion: VERSION,
      exportedAt: new Date().toISOString(),
      docSchemaVersion: maxSchema,
      counts: {
        boards: archiveBoards.length,
        assets: archiveAssets.length,
        comments: archiveComments.length,
        versions: archiveVersions.length,
      },
    };
    await zip.addJson('manifest.json', manifest);
    const size = await zip.close();
    return {
      size,
      summary: {
        boards: archiveBoards.length,
        elements,
        files: archiveAssets.length,
        comments: archiveComments.length,
        skippedFiles: missing,
        remappedPeople: 0,
      },
    };
  } catch (err) {
    zip.abort();
    throw err;
  }
}
