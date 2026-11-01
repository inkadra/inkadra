// SPDX-License-Identifier: MPL-2.0

import { CommentPin, CommentVisibility, ElementRef, MAX_COMMENT_LENGTH } from './comments.ts';
import { Id, Timestamp, z } from './common.ts';
import { ProjectIcon, ProjectTimeZone, ProjectType } from './projects.ts';
import { ReviewStatus } from './reviews.ts';
import { ShootingDayInput } from './schedule.ts';

/**
 * The project archive: a zip that any Inkadra server can import (docs/decisions/0037,
 * layout in docs/formats/project-archive.md). Every JSON entry is described here; importers
 * parse each one with these schemas and never trust anything else in the archive.
 *
 *     manifest.json                    ProjectArchiveManifest
 *     project.json                     ArchiveProject
 *     people.json                      ArchivePerson[]  (names of authors and mentioned people)
 *     boards.json                      ArchiveBoard[]   (the tree, parents before children)
 *     boards/<boardId>/document.yjs    the board's Yjs document, one full update
 *     boards/<boardId>/elements.json   ArchiveElements: readable copy, never read on import
 *     versions.json                    ArchiveVersion[] (named versions)
 *     versions/<versionId>.yjs         a named version, one full Yjs update
 *     assets.json                      ArchiveAsset[]
 *     files/<assetId>                  the original file, as uploaded
 *     comments.json                    ArchiveComment[]
 *     reviews.json                     ArchiveReviews
 *     schedule.json                    ArchiveShootingDay[]
 *     classifications.json             ArchiveClassifications: labels of the values used
 *     export-settings.json             ArchiveExportSettings: PDF/image export settings and logo
 *
 * Ids are the ones of the exporting server. An import gives projects, boards, files, comments
 * and versions new ids and rewrites references; element ids inside documents stay. Readers
 * drop keys these schemas do not name, so later minor additions never break version 1.
 */
export const PROJECT_ARCHIVE_FORMAT = 'inkadra-project';
/** Bump on any change readers of the previous version would get wrong. */
export const PROJECT_ARCHIVE_VERSION = 1;

/**
 * Limits an importer applies before reading anything (bytes are uncompressed). The whole
 * archive, compressed and uncompressed, is also capped by the instance (`IMPORT_MAX_SIZE`)
 * and each file by `UPLOAD_MAX_SIZE`.
 */
export const PROJECT_ARCHIVE_LIMITS = {
  entries: 200_000,
  boards: 5_000,
  assets: 100_000,
  comments: 200_000,
  versions: 10_000,
  /** Review history rows and shooting-day blocks, each. */
  rows: 500_000,
  /** People named by the archive. */
  people: 10_000,
  /** Elements of one board document once loaded (bounds the decoded size). */
  elements: 50_000,
  /** Per JSON entry. */
  jsonBytes: 64 * 1024 * 1024,
  /** Per board document or version, encoded. */
  documentBytes: 64 * 1024 * 1024,
  /** Uncompressed / compressed, per entry; well above real documents and media. */
  compressionRatio: 200,
} as const;

export const ProjectArchiveManifest = z
  .object({
    format: z.literal(PROJECT_ARCHIVE_FORMAT),
    formatVersion: z.int().min(1),
    appVersion: z.string().max(64),
    exportedAt: Timestamp,
    /** Highest board document schema version inside (`CURRENT_SCHEMA_VERSION` of doc-schema). */
    docSchemaVersion: z.int().min(0),
    counts: z.object({
      boards: z.int().min(0),
      assets: z.int().min(0),
      comments: z.int().min(0),
      versions: z.int().min(0),
    }),
  })
  .openapi('ProjectArchiveManifest');
export type ProjectArchiveManifest = z.infer<typeof ProjectArchiveManifest>;

/**
 * Someone the archive names: an author or a mentioned person. Names only, never emails: an
 * import attributes everything to the importer and keeps these names as display-only text.
 */
export const ArchivePerson = z.object({
  id: Id,
  name: z.string().max(200),
});
export type ArchivePerson = z.infer<typeof ArchivePerson>;

export const ArchiveProject = z.object({
  id: Id,
  name: z.string().trim().min(1).max(120),
  icon: ProjectIcon,
  type: ProjectType.nullable(),
  timeZone: ProjectTimeZone.optional(),
  shootingStart: z.iso.date().nullable(),
  shootingEnd: z.iso.date().nullable(),
  archived: z.boolean(),
  createdAt: Timestamp,
});
export type ArchiveProject = z.infer<typeof ArchiveProject>;

export const ArchiveBoard = z.object({
  id: Id,
  /** Null for the root board, exactly one. */
  parentId: Id.nullable(),
  kind: z.enum(['board', 'storyboard']),
  title: z.string().max(200),
  position: z.string().min(1).max(64),
  coverAssetId: Id.nullable(),
  /** Board card icon; absent in archives from before it existed. */
  icon: ProjectIcon.nullable().optional(),
  /** Schema version of `document.yjs` (doc-schema), so readers can refuse before loading it. */
  schemaVersion: z.int().min(0),
  createdBy: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ArchiveBoard = z.infer<typeof ArchiveBoard>;

/** Readable rendering of a board document: doc-schema elements plus note text. */
export const ArchiveElements = z.object({
  boardId: Id,
  schemaVersion: z.int().min(0),
  aspect: z.string().nullable(),
  /** From document version 9: the sound track of the storyboard's animatic (decision 0046). */
  animaticAudio: z
    .object({ assetId: Id, volume: z.number().min(0).max(1) })
    .nullable()
    .optional(),
  elements: z.array(z.record(z.string(), z.unknown())),
});
export type ArchiveElements = z.infer<typeof ArchiveElements>;

export const ArchiveVersion = z.object({
  id: Id,
  boardId: Id,
  name: z.string().max(200),
  schemaVersion: z.int().min(0),
  createdBy: Id.nullable(),
  createdAt: Timestamp,
});
export type ArchiveVersion = z.infer<typeof ArchiveVersion>;

export const ArchiveAsset = z.object({
  id: Id,
  kind: z.enum(['image', 'video', 'audio', 'file']),
  mime: z.string().max(255),
  filename: z.string().min(1).max(255),
  size: z.number().int().min(0),
  /** When set, an importer skips a file whose content does not match (`skippedFiles`). */
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  sourceUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .nullable(),
  createdBy: Id.nullable(),
  createdAt: Timestamp,
});
export type ArchiveAsset = z.infer<typeof ArchiveAsset>;

export const ArchiveComment = z.object({
  id: Id,
  boardId: Id,
  elementId: ElementRef.nullable(),
  /** First comment of the thread; null for a thread start. */
  threadId: Id.nullable(),
  authorId: Id.nullable(),
  /**
   * A guest of a share link wrote it. Share links are not exported, so an importer keeps the
   * name as display-only text and makes the thread `team` (decision 0037).
   */
  guestName: z.string().max(200).nullable(),
  /** Mentions written `@{personId}` with ids of `people.json`. Empty once deleted. */
  body: z.string().max(MAX_COMMENT_LENGTH),
  visibility: CommentVisibility,
  pin: CommentPin.nullable(),
  resolvedAt: Timestamp.nullable(),
  resolvedBy: Id.nullable(),
  createdAt: Timestamp,
  editedAt: Timestamp.nullable(),
  deletedAt: Timestamp.nullable(),
});
export type ArchiveComment = z.infer<typeof ArchiveComment>;

export const ArchiveReviews = z.object({
  /** The team's current status of each card (guest decisions stay with their links). */
  current: z.array(
    z.object({
      boardId: Id,
      elementId: ElementRef,
      status: ReviewStatus,
      note: z.string().max(2000).nullable(),
      changedBy: Id.nullable(),
      requestedBy: Id.nullable(),
      changedAt: Timestamp,
    }),
  ),
  history: z.array(
    z.object({
      boardId: Id,
      elementId: ElementRef,
      previous: ReviewStatus,
      status: ReviewStatus,
      note: z.string().max(2000).nullable(),
      userId: Id.nullable(),
      createdAt: Timestamp,
    }),
  ),
});
export type ArchiveReviews = z.infer<typeof ArchiveReviews>;

export const ArchiveShootingDay = ShootingDayInput.extend({ id: Id, boardId: Id });
export type ArchiveShootingDay = z.infer<typeof ArchiveShootingDay>;

export const ArchiveClassifications = z.object({
  projectTypes: z.array(z.object({ id: z.string().max(40), label: z.string().max(40) })),
  tags: z.array(z.object({ id: z.string().max(40), label: z.string().max(40) })),
});
export type ArchiveClassifications = z.infer<typeof ArchiveClassifications>;

/** What `checkArchiveStructure` needs: the parsed entries, ids only. */
export interface ArchiveStructure {
  boards: Array<Pick<ArchiveBoard, 'id' | 'parentId' | 'coverAssetId'>>;
  /** The export logo, from `export-settings.json`. */
  logoAssetId?: string | null;
  assets: Array<Pick<ArchiveAsset, 'id'>>;
  comments: Array<Pick<ArchiveComment, 'id' | 'boardId' | 'threadId'>>;
  versions: Array<Pick<ArchiveVersion, 'id' | 'boardId'>>;
  reviews: ArchiveReviews;
  schedule: Array<Pick<ArchiveShootingDay, 'id' | 'boardId'>>;
}

/**
 * The rules schemas cannot express, checked before an import writes anything: exactly one
 * root, every parent present and no cycle, unique ids, and every reference (cover, thread,
 * version, review, shooting day) to something in the archive. A reply's thread start is on
 * the same board and is itself a thread start. Returns the first problem, or null.
 */
export function checkArchiveStructure(a: ArchiveStructure): string | null {
  const unique = (what: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) return `duplicate ${what} ${id}`;
      seen.add(id);
    }
    return null;
  };
  const dup =
    unique(
      'board',
      a.boards.map((b) => b.id),
    ) ??
    unique(
      'asset',
      a.assets.map((x) => x.id),
    ) ??
    unique(
      'comment',
      a.comments.map((c) => c.id),
    ) ??
    unique(
      'version',
      a.versions.map((v) => v.id),
    ) ??
    unique(
      'shooting day',
      a.schedule.map((d) => d.id),
    );
  if (dup) return dup;
  const boards = new Map(a.boards.map((b) => [b.id, b]));
  const roots = a.boards.filter((b) => b.parentId === null);
  if (roots.length !== 1) return `${roots.length} root boards`;
  for (const b of a.boards) {
    if (b.parentId !== null && !boards.has(b.parentId)) return `board ${b.id}: missing parent`;
    // Walking up must reach the root within as many steps as there are boards.
    let at: string | null = b.id;
    for (let steps = 0; at !== null; steps++) {
      if (steps > a.boards.length) return `board ${b.id}: cycle`;
      at = boards.get(at)?.parentId ?? null;
    }
  }
  const assets = new Set(a.assets.map((x) => x.id));
  for (const b of a.boards)
    if (b.coverAssetId !== null && !assets.has(b.coverAssetId))
      return `board ${b.id}: missing cover`;
  if (a.logoAssetId && !assets.has(a.logoAssetId)) return 'export logo: missing file';
  const comments = new Map(a.comments.map((c) => [c.id, c]));
  for (const c of a.comments) {
    if (!boards.has(c.boardId)) return `comment ${c.id}: missing board`;
    if (c.threadId === null) continue;
    const start = comments.get(c.threadId);
    if (!start || start.threadId !== null || start.boardId !== c.boardId)
      return `comment ${c.id}: bad thread`;
  }
  const onBoard = (what: string, rows: Array<{ boardId: string }>) =>
    rows.find((r) => !boards.has(r.boardId)) ? `${what}: missing board` : null;
  return (
    onBoard('version', a.versions) ??
    onBoard('review', a.reviews.current) ??
    onBoard('review history', a.reviews.history) ??
    onBoard('shooting day', a.schedule)
  );
}

/**
 * The project's shared export settings (decision 0039), when it saved any. The logo is one of
 * `assets.json`; an importer keeps it only if that file was stored. Preferences are read field
 * by field like the server reads its own row, so a value an importer does not know falls back
 * to its default instead of failing the import.
 */
export const ArchiveExportSettings = z.object({
  /** Field by field: an importer keeps each that passes `ExportPreferences`, drops the rest. */
  preferences: z.record(z.string(), z.unknown()),
  logoAssetId: Id.nullable(),
  /** The theme (decision 0057), read field by field too; older archives have none. */
  theme: z.record(z.string(), z.unknown()).optional(),
});
export type ArchiveExportSettings = z.infer<typeof ArchiveExportSettings>;
