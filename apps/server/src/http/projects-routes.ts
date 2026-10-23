import {
  API_PREFIX,
  CreateProject,
  Id,
  PageQuery,
  type Project,
  type ProjectMember,
  type ProjectRole,
  SetProjectMember,
  UpdateProject,
  z,
} from '@inkadra/shared';
import { and, asc, count, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateKeyBetween } from 'fractional-indexing';
import { type Actor, requireProjectRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { asset, assetVariant, board, project, projectMember, user } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
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
): Project {
  return {
    id: row.id,
    name: row.name,
    icon: { shape: row.iconShape, color: row.iconColor },
    rootBoardId,
    position: row.position,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    myRole,
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
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, actor.id)));
  if (!row) throw new HttpError('not_found', 'Project not found.');
  return toProject(row.project, row.rootBoardId, row.role);
}

async function listMembers(db: Database, projectId: string): Promise<ProjectMember[]> {
  const rows = await db
    .select({ member: projectMember, user })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(eq(projectMember.projectId, projectId))
    .orderBy(asc(projectMember.addedAt));
  return rows.map((r) => ({
    user: { id: r.user.id, name: r.user.name, image: r.user.image },
    role: r.member.role,
    addedAt: iso(r.member.addedAt),
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
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, actorId)));
  if (!me) throw new HttpError('not_found', 'Project not found.');
  if (needed === 'owner' && me.role !== 'owner')
    throw new HttpError('forbidden', 'Needs the owner role.');
}

async function ownerCount(db: Pick<Database, 'select'>, projectId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.role, 'owner')));
  return row?.n ?? 0;
}

export function registerProjectRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth, jobs } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  app.get(v1('/projects'), async (req) => {
    const actor = await requireActor(auth, req);
    const query = ListQuery.parse(req.query ?? {});
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await db
      .select({ project, role: projectMember.role, rootBoardId: board.id })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .innerJoin(board, and(eq(board.projectId, project.id), isNull(board.parentBoardId)))
      .where(
        and(
          eq(projectMember.userId, actor.id),
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
      items: items.map((r) => toProject(r.project, r.rootBoardId, r.role)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.project.position, last.project.id)
          : null,
    };
  });

  app.post(v1('/projects'), async (req, reply) => {
    const actor = await requireActor(auth, req);
    const input = CreateProject.parse(req.body);
    const created = await db.transaction(async (tx) => {
      const [last] = await tx
        .select({ position: project.position })
        .from(project)
        .orderBy(desc(project.position))
        .limit(1);
      const [p] = await tx
        .insert(project)
        .values({
          name: input.name,
          iconShape: input.icon?.shape ?? 'circle',
          iconColor: input.icon?.color ?? 'neutral',
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
    const actor = await requireActor(auth, req);
    const { projectId } = ProjectParams.parse(req.params);
    return loadProject(db, actor, projectId);
  });

  app.patch(v1('/projects/:projectId'), async (req) => {
    const actor = await requireActor(auth, req);
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
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.icon) {
      set.iconShape = patch.icon.shape;
      set.iconColor = patch.icon.color;
    }
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
    if (Object.keys(set).length > 0) {
      await db.transaction(async (tx) => {
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

  app.delete(v1('/projects/:projectId'), async (req, reply) => {
    const actor = await requireActor(auth, req);
    const { projectId } = ProjectParams.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'owner');
    const keys = await db.transaction(async (tx) => {
      const originals = await tx
        .select({ key: asset.storageKey })
        .from(asset)
        .where(eq(asset.projectId, projectId));
      const variants = await tx
        .select({ key: assetVariant.storageKey })
        .from(assetVariant)
        .innerJoin(asset, eq(asset.id, assetVariant.assetId))
        .where(eq(asset.projectId, projectId));
      await tx.delete(project).where(eq(project.id, projectId));
      return [...originals, ...variants].map((r) => r.key);
    });
    // Files go after the rows: a failure leaves orphan files, never rows without files.
    if (keys.length > 0) await jobs.deleteFiles(keys);
    return reply.status(204).send();
  });

  // Members --------------------------------------------------------------------

  app.get(v1('/projects/:projectId/members'), async (req) => {
    const actor = await requireActor(auth, req);
    const { projectId } = ProjectParams.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'viewer');
    return { items: await listMembers(db, projectId) };
  });

  app.put(v1('/projects/:projectId/members/:userId'), async (req) => {
    const actor = await requireActor(auth, req);
    const { projectId, userId } = MemberParams.parse(req.params);
    const { role } = SetProjectMember.parse(req.body);
    await requireProjectRole(db, actor, projectId, 'owner');
    const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!target) throw new HttpError('not_found', 'User not found.');
    await db.transaction(async (tx) => {
      await lockMembers(tx, projectId, actor.id, 'owner');
      const [current] = await tx
        .select({ role: projectMember.role })
        .from(projectMember)
        .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)));
      if (current?.role === 'owner' && role !== 'owner' && (await ownerCount(tx, projectId)) < 2)
        throw new HttpError('conflict', 'A project needs at least one owner.');
      await tx
        .insert(projectMember)
        .values({ projectId, userId, role })
        .onConflictDoUpdate({
          target: [projectMember.projectId, projectMember.userId],
          set: { role },
        });
    });
    const member = (await listMembers(db, projectId)).find((m) => m.user.id === userId);
    if (!member) throw new Error('Member vanished after upsert');
    return member;
  });

  app.delete(v1('/projects/:projectId/members/:userId'), async (req, reply) => {
    const actor = await requireActor(auth, req);
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
