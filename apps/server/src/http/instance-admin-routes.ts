import {
  API_PREFIX,
  ClassificationCatalogs,
  ClassificationsQuery,
  Id,
  type StorageLimits,
  UpdateInstanceMember,
  UpdateInstanceSettings,
  UpdateStorageLimits,
  StartVideoBackfill,
  UpdateVideoSettings,
  z,
} from '@inkadra/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Jobs } from '../jobs.ts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { live } from '../access.ts';
import type { Auth } from '../auth.ts';
import {
  deletedIds,
  lockUses,
  readClassifications,
  saveCatalogs,
  validateCatalogUpdate,
  withUses,
} from '../classifications.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { instanceSetting, personalToken, session, user } from '../db/schema.ts';
import { readInstanceSettings } from '../instance-settings.ts';
import { recipeFor } from '../media/ladder.ts';
import { diskSpace, growthPerMonth } from '../monitor/health.ts';
import {
  type Limits,
  largestFiles,
  overrideAllowed,
  personBytes,
  personLimit,
  readLimits,
  saveLimits,
  usedBytes,
} from '../storage-limits.ts';
import { revokeTokens } from '../tokens.ts';
import { CHECK_NOW_MS, checkForUpdates, readUpdates } from '../updates.ts';
import { startBackfill, stopBackfill } from '../video-backfill.ts';
import { readVideoSettings, saveVideoSettings, videoSettingsView } from '../video-settings.ts';
import { requireActor, requireSession } from './auth-routes.ts';
import { HttpError } from './errors.ts';

export function registerInstanceAdminRoutes(
  app: FastifyInstance,
  { db, auth, config, jobs }: { db: Database; auth: Auth; config: Config; jobs?: Jobs },
) {
  const admin = async (req: FastifyRequest) => {
    const { user: actor } = await requireSession(auth, req, db);
    if (actor.role !== 'admin') throw new HttpError('forbidden', 'Administrators only.');
    return actor;
  };
  app.get(`${API_PREFIX}/instance/classifications`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const query = ClassificationsQuery.parse(req.query ?? {});
    const catalogs = await readClassifications(db);
    // Counts only for administrators, who ask for them: they say where private projects use a
    // value, and every client reads this list often (decision 0126).
    return actor.role === 'admin' && query.uses ? withUses(db, catalogs) : catalogs;
  });
  app.put(`${API_PREFIX}/instance/classifications`, async (req) => {
    const actor = await admin(req);
    const next = ClassificationCatalogs.parse(req.body);
    const saved = await db.transaction(async (tx) => {
      // A removal counts uses: no write that adds one may run meanwhile (decision 0126).
      await lockUses(tx, 'exclusive');
      await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
      const [currentAdmin] = await tx.select().from(user).where(eq(user.id, actor.id));
      if (currentAdmin?.role !== 'admin' || currentAdmin.deactivatedAt)
        throw new HttpError('forbidden', 'Administrators only.');
      const current = await readClassifications(tx);
      const value = validateCatalogUpdate(current, next, await deletedIds(tx));
      return saveCatalogs(tx, current, value);
    });
    return withUses(db, saved);
  });
  app.get(`${API_PREFIX}/instance/settings`, async (req) => {
    await admin(req);
    return readInstanceSettings(db, config);
  });
  app.patch(`${API_PREFIX}/instance/settings`, async (req) => {
    const actor = await admin(req);
    const patch = UpdateInstanceSettings.parse(req.body ?? {});
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
      const [current] = await tx.select().from(user).where(eq(user.id, actor.id));
      if (current?.role !== 'admin' || current.deactivatedAt)
        throw new HttpError('forbidden', 'Administrators only.');
      if (patch.requireAdminTwoFactor === true && !current.twoFactorEnabled)
        throw new HttpError(
          'forbidden',
          'Enroll in two-step verification before enabling this policy.',
          {
            reason: 'admin_two_factor_enrollment_required_to_enable',
          },
        );
      const settings = { ...(await readInstanceSettings(tx, config)), ...patch };
      await tx
        .insert(instanceSetting)
        .values({ key: 'administration', value: settings })
        .onConflictDoUpdate({
          target: instanceSetting.key,
          set: { value: settings, updatedAt: new Date() },
        });
      return settings;
    });
  });
  // Decision 0080: the answer of GitHub is cached; a failed check is shown, never thrown.
  app.get(`${API_PREFIX}/instance/updates`, async (req) => {
    await admin(req);
    await checkForUpdates(db).catch((err) => req.log.warn({ err }, 'update check failed'));
    return readUpdates(db);
  });
  app.post(`${API_PREFIX}/instance/updates/check`, async (req) => {
    await admin(req);
    await checkForUpdates(db, CHECK_NOW_MS).catch((err) =>
      req.log.warn({ err }, 'update check failed'),
    );
    return readUpdates(db);
  });
  /** Limits as the Storage page shows them, with what is used and the disk (decision 0081). */
  const storageLimits = async (limits: Limits): Promise<StorageLimits> => {
    const used = await usedBytes(db);
    return {
      ...limits,
      uploadMaxSize: config.UPLOAD_MAX_SIZE,
      usedBytes: used.originals + used.derived,
      disk: await diskSpace(config),
      growthPerMonth: await growthPerMonth(db),
    };
  };
  app.get(`${API_PREFIX}/instance/storage-limits`, async (req, reply) => {
    await admin(req);
    reply.header('cache-control', 'private, no-store');
    return storageLimits(await readLimits(db, config));
  });
  app.patch(`${API_PREFIX}/instance/storage-limits`, async (req) => {
    const actor = await admin(req);
    const patch = UpdateStorageLimits.parse(req.body ?? {});
    // A limit under what is used is allowed: nothing is deleted, new files are refused.
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
      const [current] = await tx.select().from(user).where(eq(user.id, actor.id));
      if (current?.role !== 'admin' || current.deactivatedAt)
        throw new HttpError('forbidden', 'Administrators only.');
      return storageLimits(await saveLimits(tx, config, patch));
    });
  });
  // Playable video copies (decision 0128).
  const videoView = async () =>
    videoSettingsView(db, config, {
      freeBytes: (await diskSpace(config))?.free ?? null,
      recipe: recipeFor,
      jobs,
    });
  app.get(`${API_PREFIX}/instance/video-settings`, async (req, reply) => {
    await admin(req);
    reply.header('cache-control', 'private, no-store');
    return videoView();
  });
  app.patch(`${API_PREFIX}/instance/video-settings`, async (req) => {
    await admin(req);
    const patch = UpdateVideoSettings.parse(req.body ?? {});
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(10893)`);
      await saveVideoSettings(tx, config, patch);
    });
    return videoView();
  });
  app.post(`${API_PREFIX}/instance/video-settings/reprocess`, async (req, reply) => {
    await admin(req);
    const { scope } = StartVideoBackfill.parse(req.body ?? {});
    const { settings } = await readVideoSettings(db, config);
    if (!jobs) throw new HttpError('conflict', 'This server makes no video copies.');
    await startBackfill(db, jobs, scope, recipeFor(settings.quality));
    reply.status(202);
    return videoView();
  });
  app.delete(`${API_PREFIX}/instance/video-settings/reprocess`, async (req) => {
    await admin(req);
    if (jobs) await stopBackfill(db, jobs);
    return videoView();
  });
  app.get(`${API_PREFIX}/instance/members/:userId/files`, async (req, reply) => {
    const actor = await admin(req);
    const { userId } = z.object({ userId: Id }).parse(req.params);
    reply.header('cache-control', 'private, no-store');
    return largestFiles(db, userId, actor.id);
  });
  app.get(`${API_PREFIX}/instance/members`, async (req) => {
    await admin(req);
    const { membersCanCreateProjects } = await readInstanceSettings(db, config);
    const limits = await readLimits(db, config);
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        deactivatedAt: user.deactivatedAt,
        lastActiveAt: sql<
          Date | string | null
        >`greatest((select max(updated_at) from session where user_id = "user"."id"), (select max(last_used_at) from personal_token where user_id = "user"."id"))`,
        projectsCount: sql<number>`(select count(*)::int from project_member m where m.user_id = "user"."id" and ${live('m')})`,
        canCreateProjectsOverride: user.canCreateProjects,
        storageBytes: personBytes(sql`"user"."id"`),
        storageLimitOverride: user.storageLimit,
      })
      .from(user)
      .orderBy(asc(user.name), asc(user.id));
    return {
      items: rows.map((r) => ({
        ...r,
        storageBytes: Number(r.storageBytes),
        storageLimit: personLimit(limits, r.storageLimitOverride),
        deactivatedAt: r.deactivatedAt?.toISOString() ?? null,
        lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt).toISOString() : null,
        canCreateProjects:
          r.role === 'admin' || (r.canCreateProjectsOverride ?? membersCanCreateProjects),
      })),
    };
  });
  app.patch(`${API_PREFIX}/instance/members/:userId`, async (req) => {
    const actor = await admin(req);
    const { userId } = z.object({ userId: Id }).parse(req.params);
    const patch = UpdateInstanceMember.parse(req.body ?? {});
    if (
      patch.storageLimit !== undefined &&
      !overrideAllowed(await readLimits(db, config), patch.storageLimit)
    )
      throw new HttpError(
        'forbidden',
        'The server environment sets the space of each person: it can only be lowered.',
      );
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
      const [current] = await tx.select().from(user).where(eq(user.id, actor.id));
      if (current?.role !== 'admin' || current.deactivatedAt)
        throw new HttpError('forbidden', 'Administrators only.');
      const [target] = await tx.select().from(user).where(eq(user.id, userId)).for('update');
      if (!target) throw new HttpError('not_found', 'Member not found.');
      if (
        target.role === 'admin' &&
        !target.deactivatedAt &&
        (patch.role === 'member' || patch.active === false)
      ) {
        const admins = await tx
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt)));
        if (admins.length <= 1)
          throw new HttpError('conflict', 'The instance needs at least one active administrator.');
      }
      await tx
        .update(user)
        .set({
          role: patch.role ?? target.role,
          canCreateProjects:
            patch.canCreateProjects === undefined
              ? target.canCreateProjects
              : patch.canCreateProjects,
          storageLimit: patch.storageLimit === undefined ? target.storageLimit : patch.storageLimit,
          deactivatedAt:
            patch.active === false
              ? (target.deactivatedAt ?? new Date())
              : patch.active === true
                ? null
                : target.deactivatedAt,
        })
        .where(eq(user.id, userId));
      if (patch.active === false) {
        await tx.delete(session).where(eq(session.userId, userId));
        await revokeTokens(tx, eq(personalToken.userId, userId), 'account_deactivated');
      }
    });
    return { ok: true };
  });
}
