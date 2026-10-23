import {
  API_PREFIX,
  COLLAB_PATH,
  CreateProject,
  type Health,
  type Instance,
  type Project,
  type ProjectRole,
  UpdateMe,
  type User,
} from '@inkadra/shared';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateKeyBetween } from 'fractional-indexing';
import type { Auth } from '../auth.ts';
import { countUsers } from '../auth.ts';
import { type Config, VERSION } from '../config.ts';
import type { Database } from '../db/client.ts';
import { board, project, projectMember, user } from '../db/schema.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  pingQueue?: () => Promise<boolean>;
}

const iso = (d: Date) => d.toISOString();

function toUser(row: typeof user.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    role: row.role,
    locale: row.locale,
    createdAt: iso(row.createdAt),
  };
}

function toProject(
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

export function registerApiRoutes(app: FastifyInstance, deps: Deps) {
  const { config, db, auth } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  // Polled by Docker and proxies every few seconds: keep it out of the request log.
  app.get(v1('/health'), { logLevel: 'warn' }, async (_req, reply) => {
    let database: 'ok' | 'error' = 'ok';
    try {
      await db.execute(sql`select 1`);
    } catch {
      database = 'error';
    }
    let queue: Health['checks']['queue'] = 'disabled';
    if (deps.pingQueue) queue = (await deps.pingQueue()) ? 'ok' : 'error';
    const ok = database === 'ok' && queue !== 'error';
    const body: Health = {
      status: ok ? 'ok' : 'degraded',
      version: VERSION,
      checks: { database, queue },
    };
    return reply.status(ok ? 200 : 503).send(body);
  });

  app.get(v1('/instance'), async () => {
    const users = await countUsers(db);
    const body: Instance = {
      name: config.INSTANCE_NAME,
      version: VERSION,
      publicUrl: config.PUBLIC_URL,
      setupRequired: users === 0,
      registration: users === 0 ? 'first-user' : config.REGISTRATION,
      auth: { emailPassword: true, google: false, oidc: [] },
      collabPath: COLLAB_PATH,
      serverTime: new Date().toISOString(),
    };
    return body;
  });

  app.get(v1('/me'), async (req) => {
    const actor = await requireActor(auth, req);
    const [row] = await db.select().from(user).where(eq(user.id, actor.id));
    if (!row) throw new HttpError('unauthorized', 'Sign in to continue.');
    return toUser(row);
  });

  app.patch(v1('/me'), async (req) => {
    const actor = await requireActor(auth, req);
    const patch = UpdateMe.parse(req.body);
    const [row] = await db.update(user).set(patch).where(eq(user.id, actor.id)).returning();
    if (!row) throw new HttpError('unauthorized', 'Sign in to continue.');
    return toUser(row);
  });

  app.get(v1('/projects'), async (req) => {
    const actor = await requireActor(auth, req);
    const archived = (req.query as { archived?: string }).archived === 'true';
    const rows = await db
      .select({ project, role: projectMember.role, rootBoardId: board.id })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .innerJoin(board, and(eq(board.projectId, project.id), isNull(board.parentBoardId)))
      .where(
        and(
          eq(projectMember.userId, actor.id),
          archived ? isNotNull(project.archivedAt) : isNull(project.archivedAt),
        ),
      )
      .orderBy(asc(project.position), asc(project.createdAt));
    // Pagination arrives with the API thread; the panel lists every project for now.
    return {
      items: rows.map((r) => toProject(r.project, r.rootBoardId, r.role)),
      nextCursor: null,
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
}
