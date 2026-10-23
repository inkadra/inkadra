import {
  API_PREFIX,
  COLLAB_PATH,
  type Health,
  type Instance,
  UpdateMe,
  type User,
} from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.ts';
import { countUsers } from '../auth.ts';
import { type Config, VERSION } from '../config.ts';
import type { Database } from '../db/client.ts';
import { user } from '../db/schema.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  pingQueue?: () => Promise<boolean>;
}

export const iso = (d: Date) => d.toISOString();

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
      limits: { uploadMaxBytes: config.UPLOAD_MAX_SIZE },
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
    const patch = UpdateMe.parse(req.body ?? {});
    const [row] =
      Object.keys(patch).length === 0
        ? await db.select().from(user).where(eq(user.id, actor.id))
        : await db.update(user).set(patch).where(eq(user.id, actor.id)).returning();
    if (!row) throw new HttpError('unauthorized', 'Sign in to continue.');
    return toUser(row);
  });
}
