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
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { projectRole, touchesProject } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { asset, assetVariant, project, projectExportSettings } from '../db/schema.ts';
import { iso } from './api-routes.ts';
import { toAsset } from './assets-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  db: Database;
  auth: Auth;
}

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
    if (file) {
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
    if (logoAssetId) {
      const [file] = await db.select().from(asset).where(eq(asset.id, logoAssetId));
      if (!file || file.projectId !== projectId)
        throw new HttpError('bad_request', 'The logo is not an asset of this project.');
      if (file.kind !== 'image' || !LOGO_TYPES.has(file.mime))
        throw new HttpError('bad_request', 'The logo must be a PNG or JPEG image.');
      if (file.size > EXPORT_LOGO_MAX_BYTES)
        throw new HttpError('bad_request', 'The logo must be at most 512 KiB.');
      if (file.status === 'failed' || file.status === 'pending')
        throw new HttpError('bad_request', 'The logo upload is not finished.');
    }
    await db.transaction(async (tx) => {
      // The project row serialises concurrent changes, so two editors' fields merge.
      const [locked] = await tx
        .select({ id: project.id })
        .from(project)
        .where(eq(project.id, projectId))
        .for('update');
      if (!locked) throw new HttpError('not_found', 'Project not found.');
      const values = {
        projectId,
        preferences,
        updatedBy: actor.id,
        updatedAt: new Date(),
        ...(logoAssetId !== undefined ? { logoAssetId } : {}),
      };
      await tx
        .insert(projectExportSettings)
        .values(values)
        .onConflictDoUpdate({
          target: projectExportSettings.projectId,
          set: {
            preferences: sql`${projectExportSettings.preferences} || ${JSON.stringify(preferences)}::jsonb`,
            updatedBy: actor.id,
            updatedAt: values.updatedAt,
            ...(logoAssetId !== undefined ? { logoAssetId } : {}),
          },
        });
    });
    return load(db, projectId, true);
  });
}
