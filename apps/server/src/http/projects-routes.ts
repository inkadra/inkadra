import { randomUUID } from 'node:crypto';
import {
  API_PREFIX,
  CreateProject,
  defaultProjectIcon,
  Id,
  PageQuery,
  type Project,
  type ProjectMember,
  type ProjectRole,
  SetProjectMember,
  SetProjectPin,
  UpdateProject,
  z,
} from '@inkadra/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateKeyBetween } from 'fractional-indexing';
import { type Actor, activeMember, atLeast, higher, requireProjectRole } from '../access.ts';
import { readExpiry, requireProjectCreation } from '../access-expiry.ts';
import type { Auth } from '../auth.ts';
import { readClassifications, validateProjectType } from '../classifications.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  asset,
  assetVariant,
  board,
  project,
  projectMember,
  projectPin,
  user,
} from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { animatedVariantKey } from '../storage.ts';
import { storageUsage } from '../storage-usage.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  jobs: Jobs;
}

const ProjectParams = z.object({ projectId: Id });
const MemberParams = z.object({ projectId: Id, userId: Id });
const ListQuery = PageQuery.extend({ archived: z.enum(['true', 'false']).optional() });

export function toProject(
  row: typeof project.$inferSelect,
  rootBoardId: string,
  myRole: ProjectRole,
  pinned = false,
): Project {
  return {
    id: row.id,
    name: row.name,
    icon: { shape: row.iconShape, color: row.iconColor, emoji: row.iconEmoji },
    rootBoardId,
    position: row.position,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    myRole,
    type: row.type,
    shootingStart: row.shootingStart,
    shootingEnd: row.shootingEnd,
    pinned,
  };
}

/** Opaque keyset cursor over (position, id). */
const encodeCursor = (position: string, id: string) =>
  Buffer.from(JSON.stringify([position, id])).toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'string'))
      return value as [string, string];
  } catch {}
  throw new HttpError('bad_request', 'Invalid cursor.');
}

async function loadProject(db: Database, actor: Actor, projectId: string) {
  const [row] = await db
    .select({ project, role: projectMember.role, rootBoardId: board.id })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .innerJoin(board, and(eq(board.projectId, project.id), isNull(board.parentBoardId)))
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, actor.id),
        activeMember(),
      ),
    );
  if (!row) throw new HttpError('not_found', 'Project not found.');
  const [pin] = await db
    .select()
    .from(projectPin)
    .where(and(eq(projectPin.projectId, projectId), eq(projectPin.userId, actor.id)));
  return toProject(row.project, row.rootBoardId, row.role, !!pin);
}

async function listMembers(db: Database, projectId: string): Promise<ProjectMember[]> {
  const rows = await db
    .select({ member: projectMember, user })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(and(eq(projectMember.projectId, projectId), activeMember()))
    .orderBy(asc(projectMember.addedAt));
  return rows.map((r) => ({
    user: { id: r.user.id, name: r.user.name, image: r.user.image },
    role: r.member.role,
    addedAt: iso(r.member.addedAt),
    expiresAt: r.member.expiresAt ? iso(r.member.expiresAt) : null,
  }));
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Serialises membership changes of a project: two owners demoting each other at once must not
 * leave it without an owner. Also re-reads the actor's role under the lock, so a change that
 * was allowed when the request arrived is refused if the actor lost the role meanwhile.
 */
async function lockMembers(tx: Tx, projectId: string, actorId: string, needed: ProjectRole) {
  await tx.select({ id: project.id }).from(project).where(eq(project.id, projectId)).for('update');
  const [me] = await tx
    .select({ role: projectMember.role })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, actorId),
        activeMember(),
      ),
    );
  if (!me) throw new HttpError('not_found', 'Project not found.');
  if (!atLeast(me.role, needed)) throw new HttpError('forbidden', `Needs the ${needed} role.`);
  return me.role;
}

async function ownerCount(db: Pick<Database, 'select'>, projectId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.role, 'owner')));
  return row?.n ?? 0;
}

export function registerProjectRoutes(app: FastifyInstance, deps: Deps) {
  const { config, db, auth, jobs } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  app.get(v1('/instance/storage'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    if (actor.role !== 'admin')
      throw new HttpError('forbidden', 'Only administrators can see instance storage.');
    reply.header('cache-control', 'private, no-store');
    // A member/grantee can see the owning project's label. Admin status alone grants no project access.
    const visible = sql<boolean>`(exists(select 1 from project_member m
      where m.project_id = ${asset.projectId} and m.user_id = ${actor.id})
      or exists(select 1 from board_grant g join board b on b.id = g.board_id
        where b.project_id = ${asset.projectId} and b.deleted_at is null and g.user_id = ${actor.id}))`;
    const rows = await db
      .select({
        mime: asset.mime,
        bytes: sum(asset.size),
        projectId: project.id,
        projectName: project.name,
        visible,
      })
      .from(asset)
      .leftJoin(project, eq(project.id, asset.projectId))
      .where(inArray(asset.status, ['processing', 'ready', 'failed']))
      .groupBy(asset.mime, asset.projectId, project.id, project.name);
    return storageUsage(rows.map((row) => ({ ...row, bytes: Number(row.bytes ?? 0) })));
  });

  app.get(v1('/projects'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const query = ListQuery.parse(req.query ?? {});
    const pins = await db.select().from(projectPin).where(eq(projectPin.userId, actor.id));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await db
      .select({ project, role: projectMember.role, rootBoardId: board.id })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .innerJoin(board, and(eq(board.projectId, project.id), isNull(board.parentBoardId)))
      .where(
        and(
          eq(projectMember.userId, actor.id),
          activeMember(),
          query.archived === 'true' ? isNotNull(project.archivedAt) : isNull(project.archivedAt),
          after
            ? or(
                gt(project.position, after[0]),
                and(eq(project.position, after[0]), gt(project.id, after[1])),
              )
            : undefined,
        ),
      )
      .orderBy(asc(project.position), asc(project.id))
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map((r) =>
        toProject(
          r.project,
          r.rootBoardId,
          r.role,
          pins.some((pin) => pin.projectId === r.project.id),
        ),
      ),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.project.position, last.project.id)
          : null,
    };
  });

  app.post(v1('/projects'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const input = CreateProject.parse(req.body);
    await requireProjectCreation(db, config, actor);
    validateDates(input.shootingStart ?? null, input.shootingEnd ?? null);
    const id = randomUUID();
    const icon = input.icon ?? defaultProjectIcon(id);
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
      validateProjectType((await readClassifications(tx)).projectTypes, input.type);
      const [last] = await tx
        .select({ position: project.position })
        .from(project)
        .orderBy(desc(project.position))
        .limit(1);
      const [p] = await tx
        .insert(project)
        .values({
          id,
          name: input.name,
          type: input.type,
          shootingStart: input.shootingStart,
          shootingEnd: input.shootingEnd,
          iconShape: icon.shape,
          iconColor: icon.color,
          iconEmoji: icon.emoji ?? null,
          position: generateKeyBetween(last?.position ?? null, null),
          createdBy: actor.id,
        })
        .returning();
      if (!p) throw new Error('Project insert returned nothing');
      const [root] = await tx
        .insert(board)
        .values({ projectId: p.id, title: input.name, position: 'a0', createdBy: actor.id })
        .returning({ id: board.id });
      if (!root) throw new Error('Board insert returned nothing');
      await tx.insert(projectMember).values({ projectId: p.id, userId: actor.id, role: 'owner' });
      return toProject(p, root.id, 'owner');
    });
    return reply.status(201).send(created);
  });

  app.get(v1('/projects/:projectId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    return loadProject(db, actor, projectId);
  });

  app.patch(v1('/projects/:projectId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const patch = UpdateProject.parse(req.body ?? {});
    // Archiving hides the project from everyone, so it is the owner's call.
    await requireProjectRole(
      db,
      actor,
      projectId,
      patch.archived === undefined ? 'editor' : 'owner',
    );
    const set: Partial<typeof project.$inferInsert> = {};
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.shootingStart !== undefined) set.shootingStart = patch.shootingStart;
    if (patch.shootingEnd !== undefined) set.shootingEnd = patch.shootingEnd;
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.icon) {
      set.iconShape = patch.icon.shape;
      set.iconColor = patch.icon.color;
      set.iconEmoji = patch.icon.emoji ?? null;
    }
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
    if (Object.keys(set).length > 0) {
      await db.transaction(async (tx) => {
        // Account deletion takes this global lock before locking project rows too.
        await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
        await lockMembers(
          tx,
          projectId,
          actor.id,
          patch.archived === undefined ? 'editor' : 'owner',
        );
        const [current] = await tx.select().from(project).where(eq(project.id, projectId));
        if (!current) throw new HttpError('not_found', 'Project not found.');
        validateProjectType((await readClassifications(tx)).projectTypes, patch.type, current.type);
        validateDates(
          patch.shootingStart === undefined ? current.shootingStart : patch.shootingStart,
          patch.shootingEnd === undefined ? current.shootingEnd : patch.shootingEnd,
        );
        await tx.update(project).set(set).where(eq(project.id, projectId));
        // The root board carries the project name in breadcrumbs.
        if (set.name)
          await tx
            .update(board)
            .set({ title: set.name })
            .where(and(eq(board.projectId, projectId), isNull(board.parentBoardId)));
      });
    }
    return loadProject(db, actor, projectId);
  });

  app.put(v1('/projects/:projectId/pin'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const { pinned } = SetProjectPin.parse(req.body);
    await requireProjectRole(db, actor, projectId, 'viewer');
    if (pinned)
      await db.insert(projectPin).values({ projectId, userId: actor.id }).onConflictDoNothing();
    else
      await db
        .delete(projectPin)
        .where(and(eq(projectPin.projectId, projectId), eq(projectPin.userId, actor.id)));
    return loadProject(db, actor, projectId);
  });

  app.delete(v1('/projects/:projectId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'owner');
    const keys = await db.transaction(async (tx) => {
      const originals = await tx
        .select({ key: asset.storageKey })
        .from(asset)
        .where(eq(asset.projectId, projectId));
      const variants = await tx
        .select({
          key: assetVariant.storageKey,
          assetId: assetVariant.assetId,
          size: assetVariant.size,
        })
        .from(assetVariant)
        .innerJoin(asset, eq(asset.id, assetVariant.assetId))
        .where(eq(asset.projectId, projectId));
      await tx.delete(project).where(eq(project.id, projectId));
      return [
        ...originals.map((r) => r.key),
        ...variants.flatMap((r) => [r.key, animatedVariantKey(r.assetId, r.size)]),
      ];
    });
    // Files go after the rows: a failure leaves orphan files, never rows without files.
    if (keys.length > 0) await jobs.deleteFiles(keys);
    return reply.status(204).send();
  });

  // Members --------------------------------------------------------------------

  app.get(v1('/projects/:projectId/members'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'viewer');
    return { items: await listMembers(db, projectId) };
  });

  app.put(v1('/projects/:projectId/members/:userId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId, userId } = MemberParams.parse(req.params);
    const { role, expiresAt: requested } = SetProjectMember.parse(req.body);
    const expiresAt = readExpiry(requested, role);
    // Editors add people (up to editor); everything else about members is for owners.
    await requireProjectRole(db, actor, projectId, 'editor');
    const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!target) throw new HttpError('not_found', 'User not found.');
    await db.transaction(async (tx) => {
      const mine = await lockMembers(tx, projectId, actor.id, 'editor');
      const [current] = await tx
        .select({ role: projectMember.role, expiresAt: projectMember.expiresAt })
        .from(projectMember)
        .where(
          and(
            eq(projectMember.projectId, projectId),
            eq(projectMember.userId, userId),
            activeMember(),
          ),
        );
      // An end date is a change to the member, which is for owners (decision 0041).
      if (mine !== 'owner' && (current || higher(role, mine) || expiresAt))
        throw new HttpError('forbidden', 'Needs the owner role.');
      if (current?.role === 'owner' && role !== 'owner' && (await ownerCount(tx, projectId)) < 2)
        throw new HttpError('conflict', 'A project needs at least one owner.');
      // Owners never end; left out, the end date stays (older clients do not show it).
      const end =
        role === 'owner'
          ? null
          : expiresAt === undefined
            ? (current?.expiresAt ?? null)
            : expiresAt;
      const changed = end?.getTime() !== current?.expiresAt?.getTime();
      await tx
        .insert(projectMember)
        .values({ projectId, userId, role, expiresAt: end })
        .onConflictDoUpdate({
          target: [projectMember.projectId, projectMember.userId],
          // A row that had ended but was not swept yet starts again.
          set: {
            role,
            expiresAt: end,
            ...(changed || !current ? { expiryWarnedAt: null } : {}),
            ...(current ? {} : { addedAt: sql`now()` }),
          },
        });
    });
    const member = (await listMembers(db, projectId)).find((m) => m.user.id === userId);
    if (!member) throw new Error('Member vanished after upsert');
    return member;
  });

  app.delete(v1('/projects/:projectId/members/:userId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { projectId, userId } = MemberParams.parse(req.params);
    // Anyone can leave a project; removing someone else is for owners.
    await requireProjectRole(db, actor, projectId, userId === actor.id ? 'viewer' : 'owner');
    await db.transaction(async (tx) => {
      await lockMembers(tx, projectId, actor.id, userId === actor.id ? 'viewer' : 'owner');
      const [current] = await tx
        .select({ role: projectMember.role })
        .from(projectMember)
        .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)));
      if (!current) throw new HttpError('not_found', 'Not a member.');
      if (current.role === 'owner' && (await ownerCount(tx, projectId)) < 2)
        throw new HttpError('conflict', 'A project needs at least one owner.');
      await tx
        .delete(projectMember)
        .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)));
    });
    return reply.status(204).send();
  });
}

function validateDates(start: string | null, end: string | null) {
  if (start && end && start > end)
    throw new HttpError('bad_request', 'Shooting end must follow start.');
}
