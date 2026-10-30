import {
  API_PREFIX,
  atLeast,
  DEFAULT_EXPORT_PREFERENCES,
  EXPORT_LOGO_MAX_BYTES,
  EXPORT_LOGO_TYPES,
  type ExportPreferences,
  type ExportSettings,
  Id,
  UpdateExportSettings,
  z,
} from '@inkadra/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { projectRole, touchesProject } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import {
  asset,
  assetVariant,
  board,
  boardDoc,
  boardVersion,
  project,
  projectExportSettings,
  sharePick,
} from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { sniffImage } from '../media/heic.ts';
import { animatedVariantKey, type Storage } from '../storage.ts';
import { iso } from './api-routes.ts';
import { toAsset } from './assets-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  db: Database;
  auth: Auth;
  storage: Storage;
  jobs: Jobs;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const v1 = (path: string) => `${API_PREFIX}${path}`;
const ProjectParams = z.object({ projectId: Id });
const LOGO_TYPES: ReadonlySet<string> = new Set(EXPORT_LOGO_TYPES);

/**
 * Stored preferences read field by field: a value that no longer parses (or was never saved)
 * falls back to its default instead of breaking the whole row.
 */
export function readPreferences(stored: Record<string, unknown> | null): ExportPreferences {
  const out: Record<string, unknown> = { ...DEFAULT_EXPORT_PREFERENCES };
  const shape = UpdateExportSettings.shape;
  for (const key of Object.keys(DEFAULT_EXPORT_PREFERENCES) as Array<keyof ExportPreferences>) {
    if (!stored || !(key in stored)) continue;
    const parsed = shape[key].safeParse(stored[key]);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as ExportPreferences;
}

async function load(db: Database, projectId: string, canEdit: boolean): Promise<ExportSettings> {
  const [row] = await db
    .select()
    .from(projectExportSettings)
    .where(eq(projectExportSettings.projectId, projectId));
  let logo: ExportSettings['logo'] = null;
  if (row?.logoAssetId) {
    const [file] = await db.select().from(asset).where(eq(asset.id, row.logoAssetId));
    // A logo whose file is not ready yet (or failed) is not offered to readers.
    if (file?.status === 'ready') {
      const variants = await db
        .select()
        .from(assetVariant)
        .where(eq(assetVariant.assetId, file.id))
        .orderBy(asc(assetVariant.width));
      logo = toAsset(file, variants);
    }
  }
  return {
    ...readPreferences(row?.preferences ?? null),
    logoAssetId: logo ? logo.id : null,
    logo,
    canEdit,
    updatedAt: row ? iso(row.updatedAt) : null,
  };
}

/** Anyone who can open a board of the project reads; project editors and owners write. */
/**
 * A logo must be a finished PNG or JPEG of the project: the declared type is checked, and so
 * are the first bytes of the stored file, which the worker has read by the time it is ready.
 */
async function checkLogo(tx: Tx, storage: Storage, projectId: string, assetId: string) {
  const [file] = await tx.select().from(asset).where(eq(asset.id, assetId)).for('share');
  if (!file || file.projectId !== projectId)
    throw new HttpError('bad_request', 'The logo is not an asset of this project.');
  if (file.status !== 'ready')
    throw new HttpError('bad_request', 'The logo upload is not finished.');
  if (file.kind !== 'image' || !LOGO_TYPES.has(file.mime))
    throw new HttpError('bad_request', 'The logo must be a PNG or JPEG image.');
  if (file.size > EXPORT_LOGO_MAX_BYTES)
    throw new HttpError('bad_request', 'The logo must be at most 512 KiB.');
  let head: Uint8Array;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.read(file.storageKey, { start: 0, end: 15 }))
      chunks.push(Buffer.from(chunk as Uint8Array));
    head = Buffer.concat(chunks);
  } catch {
    throw new HttpError('bad_request', 'The logo file cannot be read.');
  }
  const sniffed = sniffImage(head);
  if (!sniffed || !LOGO_TYPES.has(sniffed))
    throw new HttpError('bad_request', 'The logo must be a PNG or JPEG image.');
}

/**
 * Deletes a replaced logo when nothing else may show it: no board cover, no guest pick, and its
 * id in no board document or version of the project (a version restore brings cards and their
 * files back, decision 0013). The id is looked for in the stored bytes, where Yjs keeps strings
 * as UTF-8: a false match only keeps the file. Returns the storage keys to remove.
 */
async function dropUnusedLogo(tx: Tx, projectId: string, assetId: string): Promise<string[]> {
  const needle = Buffer.from(assetId, 'utf8');
  const boards = tx.select({ id: board.id }).from(board).where(eq(board.projectId, projectId));
  const [cover] = await tx
    .select({ id: board.id })
    .from(board)
    .where(and(eq(board.projectId, projectId), eq(board.coverAssetId, assetId)))
    .limit(1);
  const [pick] = await tx
    .select({ id: sharePick.boardId })
    .from(sharePick)
    .where(eq(sharePick.assetId, assetId))
    .limit(1);
  const [inDoc] = await tx
    .select({ id: boardDoc.boardId })
    .from(boardDoc)
    .where(
      and(inArray(boardDoc.boardId, boards), sql`position(${needle} in ${boardDoc.state}) > 0`),
    )
    .limit(1);
  const [inVersion] = await tx
    .select({ id: boardVersion.id })
    .from(boardVersion)
    .where(
      and(
        inArray(boardVersion.boardId, boards),
        sql`position(${needle} in ${boardVersion.state}) > 0`,
      ),
    )
    .limit(1);
  if (cover || pick || inDoc || inVersion) return [];
  const [file] = await tx.select().from(asset).where(eq(asset.id, assetId));
  if (!file) return [];
  const variants = await tx
    .select({ key: assetVariant.storageKey, size: assetVariant.size })
    .from(assetVariant)
    .where(eq(assetVariant.assetId, assetId));
  await tx.delete(asset).where(eq(asset.id, assetId));
  return [
    file.storageKey,
    ...variants.flatMap((v) => [v.key, animatedVariantKey(assetId, v.size)]),
  ];
}

export function registerExportSettingsRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth } = deps;

  app.get(v1('/projects/:projectId/export-settings'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    if (!(await touchesProject(db, actor, projectId)))
      throw new HttpError('not_found', 'Project not found.');
    const role = await projectRole(db, actor, projectId);
    return load(db, projectId, !!role && atLeast(role, 'editor'));
  });

  app.patch(v1('/projects/:projectId/export-settings'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const patch = UpdateExportSettings.parse(req.body ?? {});
    const role = await projectRole(db, actor, projectId);
    if (!role) {
      // People with a board grant only may read but not change; others must not learn it exists.
      if (await touchesProject(db, actor, projectId))
        throw new HttpError('forbidden', 'Needs the editor role.');
      throw new HttpError('not_found', 'Project not found.');
    }
    if (!atLeast(role, 'editor')) throw new HttpError('forbidden', 'Needs the editor role.');
    const { logoAssetId, ...preferences } = patch;
    const dropped = await db.transaction(async (tx) => {
      // The project row serialises concurrent changes, so two editors' fields merge.
      const [locked] = await tx
        .select({ id: project.id })
        .from(project)
        .where(eq(project.id, projectId))
        .for('update');
      if (!locked) throw new HttpError('not_found', 'Project not found.');
      if (logoAssetId) await checkLogo(tx, deps.storage, projectId, logoAssetId);
      const [before] = await tx
        .select({ logoAssetId: projectExportSettings.logoAssetId })
        .from(projectExportSettings)
        .where(eq(projectExportSettings.projectId, projectId));
      const now = new Date();
      await tx
        .insert(projectExportSettings)
        .values({
          projectId,
          preferences,
          updatedBy: actor.id,
          updatedAt: now,
          ...(logoAssetId !== undefined ? { logoAssetId } : {}),
        })
        .onConflictDoUpdate({
          target: projectExportSettings.projectId,
          set: {
            preferences: sql`${projectExportSettings.preferences} || ${JSON.stringify(preferences)}::jsonb`,
            updatedBy: actor.id,
            updatedAt: now,
            ...(logoAssetId !== undefined ? { logoAssetId } : {}),
          },
        });
      const previous = before?.logoAssetId ?? null;
      if (logoAssetId === undefined || !previous || previous === logoAssetId) return [];
      return dropUnusedLogo(tx, projectId, previous);
    });
    // Files go after the rows: a failure leaves orphan files, never rows without files.
    if (dropped.length > 0) await deps.jobs.deleteFiles(dropped);
    return load(db, projectId, true);
  });
}
