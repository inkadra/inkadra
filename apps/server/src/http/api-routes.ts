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
import { canCreateProjects } from '../access-expiry.ts';
import type { Auth } from '../auth.ts';
import { countUsers, OIDC_PROVIDER_ID } from '../auth.ts';
import { type Config, VERSION } from '../config.ts';
import type { Database } from '../db/client.ts';
import { user } from '../db/schema.ts';
import { readInstanceSettings } from '../instance-settings.ts';
import type { Mailer } from '../mailer.ts';
import { mediaTools } from '../media/video.ts';
import { myTasks } from '../tasks.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  mailer: Mailer;
  pingQueue?: () => Promise<boolean>;
}

export const iso = (d: Date) => d.toISOString();

export function toUser(row: typeof user.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    role: row.role,
    locale: row.locale,
    twoFactorEnabled: row.twoFactorEnabled,
    createdAt: iso(row.createdAt),
  };
}

export function registerApiRoutes(app: FastifyInstance, deps: Deps) {
  const { config, db, auth } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  app.get(v1('/me/tasks'), async (req) => {
    const actor = await requireActor(auth, req, db);
    return { items: await myTasks(db, actor.id) };
  });

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
      checks: { database, queue },
    };
    return reply.status(ok ? 200 : 503).send(body);
  });

  app.get(v1('/instance'), async () => {
    const users = await countUsers(db);
    const settings = await readInstanceSettings(db, config);
    const body: Instance = {
      name: settings.name,
      publicUrl: config.PUBLIC_URL,
      setupRequired: users === 0,
      registration: users === 0 ? 'first-user' : settings.registration,
      auth: {
        emailPassword: true,
        google: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
        oidc:
          config.OIDC_CLIENT_ID && config.OIDC_DISCOVERY_URL
            ? [{ id: OIDC_PROVIDER_ID, name: config.OIDC_NAME }]
            : [],
        magicLink: deps.mailer.enabled,
        email: deps.mailer.enabled,
      },
      collabPath: COLLAB_PATH,
      // The web role runs the same image as the worker, so it sees the same tools.
      media: await (async () => {
        const tools = await mediaTools();
        return {
          videoPosters: tools.ffmpeg !== null,
          rawPreviews: config.RAW_PREVIEWS && tools.exiftool !== null,
          pdfPreviews: config.PDF_PREVIEWS && tools.pdftoppm !== null,
          videoProxies: config.VIDEO_PROXIES && tools.ffmpeg !== null && tools.ffprobe !== null,
        };
      })(),
      maps: {
        enabled: config.MAPS,
        attribution: config.MAP_TILE_ATTRIBUTION,
        geocoding: Boolean(config.MAP_GEOCODER_URL),
      },
      limits: { uploadMaxBytes: config.UPLOAD_MAX_SIZE },
      serverTime: new Date().toISOString(),
    };
    return body;
  });

  app.get(v1('/instance/version'), async (req) => {
    await requireActor(auth, req, db);
    return { version: VERSION };
  });

  app.get(v1('/me'), async (req) => {
    const actor = await requireActor(auth, req, db, true);
    const [row] = await db.select().from(user).where(eq(user.id, actor.id));
    if (!row) throw new HttpError('unauthorized', 'Sign in to continue.');
    return { ...toUser(row), canCreateProjects: await canCreateProjects(db, config, row) };
  });

  app.patch(v1('/me'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const patch = UpdateMe.parse(req.body ?? {});
    const [row] =
      Object.keys(patch).length === 0
        ? await db.select().from(user).where(eq(user.id, actor.id))
        : await db.update(user).set(patch).where(eq(user.id, actor.id)).returning();
    if (!row) throw new HttpError('unauthorized', 'Sign in to continue.');
    return { ...toUser(row), canCreateProjects: await canCreateProjects(db, config, row) };
  });
}
