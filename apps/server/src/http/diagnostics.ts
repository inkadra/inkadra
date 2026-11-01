import { randomUUID } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { API_PREFIX, type DiagnosticCheck, type Diagnostics } from '@inkadra/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Auth, countUsers } from '../auth.ts';
import { type Config, VERSION } from '../config.ts';
import type { Database } from '../db/client.ts';
import { readVideoEncoder } from '../media/encoder-setting.ts';
import { addressBucket, RateLimiter } from '../rate-limits.ts';
import type { Storage } from '../storage.ts';
import { requireSession } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  storage: Storage;
  pingQueue?: () => Promise<boolean>;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** What the server sees of the caller's request, after the proxy headers TRUST_PROXY accepts. */
export function describeRequest(req: FastifyRequest): Diagnostics['request'] {
  const forwardedFor = req.headers['x-forwarded-for'];
  const peerAddress = req.socket.remoteAddress ?? '';
  return {
    protocol: req.protocol === 'https' ? 'https' : 'http',
    host: req.host,
    clientIp: req.ip,
    peerAddress,
    forwardedFor: (Array.isArray(forwardedFor) ? forwardedFor.join(', ') : forwardedFor) ?? null,
    // Fastify only takes the client address from the header when the peer is trusted.
    proxyTrusted: forwardedFor !== undefined && req.ip !== peerAddress,
  };
}

export function registerDiagnostics(app: FastifyInstance, deps: Deps) {
  const { config, db, auth, storage } = deps;
  // Open to anyone before the first account exists: a few checks a minute per address.
  const limiter = new RateLimiter(10, 60_000);

  app.get(`${API_PREFIX}/diagnostics`, async (req) => {
    if (!limiter.take(addressBucket(req.ip)))
      throw new HttpError('rate_limited', 'Too many checks: wait a minute.');
    const setup = (await countUsers(db)) === 0;
    if (!setup) {
      const { user: actor } = await requireSession(auth, req, db);
      if (actor.role !== 'admin')
        throw new HttpError('forbidden', 'Only administrators can see the diagnostics.');
    }

    const request = describeRequest(req);
    const publicUrl = new URL(config.PUBLIC_URL);
    const checks: DiagnosticCheck[] = [];
    // Before setup the endpoint is public: never reveal configuration or error messages.
    const add = (
      id: DiagnosticCheck['id'],
      status: DiagnosticCheck['status'],
      expected: string | null = null,
      actual: string | null = null,
    ) =>
      checks.push({ id, status, expected: setup ? null : expected, actual: setup ? null : actual });

    const local = LOCAL_HOSTS.has(publicUrl.hostname);
    add(
      'public_url_https',
      publicUrl.protocol === 'https:' || local ? 'ok' : 'warning',
      'https:',
      publicUrl.protocol,
    );

    const seen = `${request.protocol}://${request.host}`;
    add(
      'public_url_matches_request',
      seen === publicUrl.origin ? 'ok' : 'warning',
      publicUrl.origin,
      seen,
    );

    if (request.forwardedFor !== null) {
      add(
        'proxy_trusted',
        request.proxyTrusted ? 'ok' : 'warning',
        `TRUST_PROXY includes ${request.peerAddress}`,
        `TRUST_PROXY=${String(config.TRUST_PROXY)}`,
      );
    }

    try {
      await db.execute(sql`select 1`);
      add('database', 'ok');
    } catch (err) {
      add('database', 'error', null, message(err));
    }

    if (deps.pingQueue) add('queue', (await deps.pingQueue()) ? 'ok' : 'error');

    try {
      await access(config.DATA_DIR, constants.W_OK);
      add('data_dir_writable', 'ok', null, config.DATA_DIR);
    } catch (err) {
      add('data_dir_writable', 'error', config.DATA_DIR, message(err));
    }

    const probe = `diagnostics/probe-${randomUUID()}`;
    try {
      await storage.write(probe, Buffer.from('inkadra'), 'text/plain');
      await storage.remove([probe]);
      add('storage', 'ok', null, config.STORAGE_DRIVER);
    } catch (err) {
      add('storage', 'error', config.STORAGE_DRIVER, message(err));
    }

    // Saved by the worker when it starts: the web role may run in another container.
    const encoder = await readVideoEncoder(db).catch(() => null);
    if (encoder) {
      const forced = encoder.requested !== 'auto' && encoder.requested !== 'none';
      const missed = forced && encoder.backend === 'software';
      add(
        'video_encoding',
        missed ? 'warning' : 'ok',
        missed ? `VIDEO_PROXY_HWACCEL=${encoder.requested}` : null,
        encoder.label,
      );
    }

    const body: Diagnostics = {
      version: VERSION,
      checkedAt: new Date().toISOString(),
      request,
      checks,
    };
    return body;
  });
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
