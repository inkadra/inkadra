import {
  API_PREFIX,
  ClassificationCatalogs,
  Id,
  UpdateInstanceMember,
  UpdateInstanceSettings,
  z,
} from '@inkadra/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Auth } from '../auth.ts';
import { readClassifications, validateCatalogUpdate } from '../classifications.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { instanceSetting, personalToken, session, user } from '../db/schema.ts';
import { readInstanceSettings } from '../instance-settings.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

export function registerInstanceAdminRoutes(
  app: FastifyInstance,
  { db, auth, config }: { db: Database; auth: Auth; config: Config },
) {
  const admin = async (req: FastifyRequest) => {
    const actor = await requireActor(auth, req, db);
    if (actor.role !== 'admin') throw new HttpError('forbidden', 'Administrators only.');
    return actor;
  };
  app.get(`${API_PREFIX}/instance/classifications`, async (req) => {
    await requireActor(auth, req, db);
    return readClassifications(db);
  });
  app.put(`${API_PREFIX}/instance/classifications`, async (req) => {
    const actor = await admin(req);
    const next = ClassificationCatalogs.parse(req.body);
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
      const [currentAdmin] = await tx.select().from(user).where(eq(user.id, actor.id));
      if (currentAdmin?.role !== 'admin' || currentAdmin.deactivatedAt)
        throw new HttpError('forbidden', 'Administrators only.');
      const value = validateCatalogUpdate(await readClassifications(tx), next);
      await tx
        .insert(instanceSetting)
        .values({ key: 'classifications', value })
        .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
      return value;
    });
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
  app.get(`${API_PREFIX}/instance/members`, async (req) => {
    await admin(req);
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
        projectsCount: sql<number>`(select count(*)::int from project_member where user_id = "user"."id")`,
      })
      .from(user)
      .orderBy(asc(user.name), asc(user.id));
    return {
      items: rows.map((r) => ({
        ...r,
        deactivatedAt: r.deactivatedAt?.toISOString() ?? null,
        lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt).toISOString() : null,
      })),
    };
  });
  app.patch(`${API_PREFIX}/instance/members/:userId`, async (req) => {
    const actor = await admin(req);
    const { userId } = z.object({ userId: Id }).parse(req.params);
    const patch = UpdateInstanceMember.parse(req.body ?? {});
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
        await tx.delete(personalToken).where(eq(personalToken.userId, userId));
      }
    });
    return { ok: true };
  });
}
