import { randomUUID } from 'node:crypto';
import {
  type AccountSession,
  API_PREFIX,
  type AppAuthorizationRedirect,
  type AppClient,
  type AppToken,
  CreateAppAuthorization,
  type CreatedPersonalToken,
  CreatePersonalToken,
  DeleteMe,
  type DeleteMeBlocked,
  DenyAppAuthorization,
  ExchangeAppCode,
  Id,
  TokenProofRequest,
  UploadAvatar,
  z,
} from '@inkadra/shared';
import { and, asc, count, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { activeGrant, activeMember } from '../access.ts';
import type { Auth } from '../auth.ts';
import { FRESH_SIGN_IN_MS } from '../auth-session.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  account,
  board,
  boardGrant,
  notification,
  personalToken,
  project,
  projectMember,
  session as sessionTable,
  user,
  userAvatar,
  verification,
} from '../db/schema.ts';
import { recordDeletions } from '../file-deletions.ts';
import type { Jobs } from '../jobs.ts';
import { type Mailer, securityNotification } from '../mailer.ts';
import { removeFilesLater } from '../queues.ts';
import { addressBucket, RateLimiter } from '../rate-limits.ts';
import { newSecret, pkceChallenge, safeEqual, sha256 } from '../secrets.ts';
import type { Storage } from '../storage.ts';
import { largestFiles, myStorage } from '../storage-limits.ts';
import { proofKeyFor, proveNonce } from '../token-proof.ts';
import { issueToken, revokeTokens, toPersonalToken } from '../tokens.ts';
import { toUser } from './api-routes.ts';
import { requireActor, requireSession, toHeaders } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import { projectFiles } from './projects-routes.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  jobs: Jobs;
  storage: Storage;
  mailer?: Mailer;
}

const TokenParams = z.object({ tokenId: Id });
const SessionParams = z.object({ sessionId: Id });
const CODE_TTL_MS = 2 * 60_000;

const CLIENT_NAMES: Record<AppClient, string> = { clipper: 'Inkadra Clipper', mobile: 'Inkadra' };

/**
 * Chrome Web Store ids of the official clipper. Pinned so that no other extension can get a
 * token from someone who clicks "Allow"; self-built ones are added with CLIPPER_EXTENSION_IDS.
 */
export const OFFICIAL_CLIPPER_IDS: readonly string[] = ['hdajoikapihpjfbgioeagenmoalckjkh'];

/** Exact redirect addresses each official app may use (decision 0011). */
export function allowedRedirects(config: Config, client: AppClient): string[] {
  if (client === 'mobile') return ['inkadra://auth'];
  return [...OFFICIAL_CLIPPER_IDS, ...config.CLIPPER_EXTENSION_IDS].map(
    (id) => `https://${id}.chromiumapp.org/auth`,
  );
}

interface PendingCode {
  userId: string;
  clientId: AppClient;
  redirectUri: string;
  codeChallenge: string;
  deviceName: string | null;
}

/** Decode with a pixel budget, strip metadata and emit a fixed-size, static image. */
export async function normalizeAvatar(bytes: Buffer): Promise<Buffer> {
  if (bytes.length > 1024 * 1024) throw new HttpError('bad_request', 'Avatar exceeds 1 MiB.');
  try {
    const input = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
    const meta = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '')) throw new Error('format');
    return await input.rotate().resize(256, 256, { fit: 'cover' }).webp().toBuffer();
  } catch {
    throw new HttpError('bad_request', 'Use a valid JPEG, PNG or WebP image up to 1 MiB.');
  }
}

export function registerAccountRoutes(app: FastifyInstance, deps: Deps) {
  const { config, db, auth, jobs, storage } = deps;
  const mailInstance = { instanceName: config.INSTANCE_NAME, publicUrl: config.PUBLIC_URL };
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  const exchangeLimiter = new RateLimiter(20, 60_000, 'account-routes:exchangeLimiter');
  // The proof needs no token: limited per address and per key (decision 0113).
  const proofLimiter = new RateLimiter(30, 60_000, 'account-routes:proofLimiter');
  const proofKeyLimiter = new RateLimiter(10, 60_000, 'account-routes:proofKeyLimiter');

  // A normalized avatar belongs to the account row, not project storage. Replacements
  // are atomic and bounded to one image; failed writes cannot leave orphan objects.
  app.put(v1('/me/avatar'), async (req) => {
    const session = await requireSession(auth, req, db);
    const { data } = UploadAvatar.parse(req.body);
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 1024 * 1024 || bytes.toString('base64') !== data)
      throw new HttpError('bad_request', 'Use a JPEG, PNG or WebP image up to 1 MiB.');
    const image = await normalizeAvatar(bytes);
    const version = randomUUID();
    const url = new URL(v1(`/users/${session.user.id}/avatar/${version}`), config.PUBLIC_URL).href;
    const row = await db.transaction(async (tx) => {
      // Serialize replace/remove on the account, before touching its avatar row.
      const [current] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, session.user.id))
        .for('update');
      if (!current) throw new HttpError('unauthorized', 'Sign in to continue.');
      await tx
        .insert(userAvatar)
        .values({ userId: session.user.id, version, image })
        .onConflictDoUpdate({ target: userAvatar.userId, set: { version, image } });
      const [updated] = await tx
        .update(user)
        .set({ image: url, updatedAt: new Date() })
        .where(eq(user.id, session.user.id))
        .returning();
      if (!updated) throw new HttpError('unauthorized', 'Sign in to continue.');
      return updated;
    });
    return toUser(row);
  });
  app.delete(v1('/me/avatar'), async (req) => {
    const session = await requireSession(auth, req, db);
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(user)
        .set({ image: null, updatedAt: new Date() })
        .where(eq(user.id, session.user.id))
        .returning();
      if (!updated) throw new HttpError('unauthorized', 'Sign in to continue.');
      await tx.delete(userAvatar).where(eq(userAvatar.userId, session.user.id));
      return updated;
    });
    return toUser(row);
  });
  app.get(v1('/users/:userId/avatar/:version'), async (req, reply) => {
    await requireActor(auth, req, db);
    const params = z.object({ userId: Id, version: z.uuid() }).parse(req.params);
    const url = new URL(v1(`/users/${params.userId}/avatar/${params.version}`), config.PUBLIC_URL)
      .href;
    const [avatar] = await db
      .select({ image: userAvatar.image })
      .from(userAvatar)
      .innerJoin(user, eq(user.id, userAvatar.userId))
      .where(
        and(
          eq(userAvatar.userId, params.userId),
          eq(userAvatar.version, params.version),
          eq(user.image, url),
        ),
      );
    if (!avatar) throw new HttpError('not_found', 'Avatar not found.');
    return reply
      .type('image/webp')
      .header('cache-control', 'private, no-cache')
      .send(Buffer.from(avatar.image));
  });

  // Sessions ---------------------------------------------------------------------
  // Better Auth's /list-sessions hands every session token to the page so it can revoke
  // them; these routes never send a token, and /list-sessions and /revoke-session are off.

  // Storage limits (decision 0081): one's own space and largest files.
  app.get(v1('/me/storage'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    reply.header('cache-control', 'private, no-store');
    return myStorage(db, config, actor.id);
  });
  app.get(v1('/me/storage/files'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    reply.header('cache-control', 'private, no-store');
    return largestFiles(db, actor.id, actor.id);
  });
  app.post(v1('/me/storage/request'), async (req) => {
    const actor = await requireActor(auth, req, db);
    // At most one a day per person: asking again tells nobody twice.
    const [recent] = await db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.actorId, actor.id),
          eq(notification.type, 'server_alert'),
          sql`${notification.serverAlert}->>'kind' = 'storage_request'`,
          gt(notification.createdAt, new Date(Date.now() - 86_400_000)),
        ),
      )
      .limit(1);
    if (recent) return { sent: false };
    const space = await myStorage(db, config, actor.id);
    const admins = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt), ne(user.id, actor.id)));
    if (!admins.length) return { sent: false };
    const used = space.originalBytes + space.derivedBytes;
    await db.insert(notification).values(
      admins.map((a) => ({
        userId: a.id,
        type: 'server_alert' as const,
        actorId: actor.id,
        serverAlert: {
          kind: 'storage_request' as const,
          service: null,
          free: space.limit === null ? null : Math.max(0, Math.round(space.limit - used)),
          total: space.limit,
          weeksLeft: null,
          count: null,
        },
        // In-app only.
        emailedAt: new Date(),
      })),
    );
    return { sent: true };
  });

  app.get(v1('/me/sessions'), async (req) => {
    const session = await requireSession(auth, req, db, true);
    const rows = await db
      .select({
        id: sessionTable.id,
        userAgent: sessionTable.userAgent,
        ipAddress: sessionTable.ipAddress,
        createdAt: sessionTable.createdAt,
        updatedAt: sessionTable.updatedAt,
        expiresAt: sessionTable.expiresAt,
      })
      .from(sessionTable)
      .where(and(eq(sessionTable.userId, session.user.id), gt(sessionTable.expiresAt, new Date())))
      .orderBy(desc(sessionTable.updatedAt));
    const items: AccountSession[] = rows.map((row) => ({
      ...row,
      current: row.id === session.session.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }));
    return { items };
  });

  app.delete(v1('/me/sessions/:sessionId'), async (req, reply) => {
    const session = await requireSession(auth, req, db, true);
    const { sessionId } = SessionParams.parse(req.params);
    const [row] = await db
      .select({ token: sessionTable.token })
      .from(sessionTable)
      .where(and(eq(sessionTable.id, sessionId), eq(sessionTable.userId, session.user.id)));
    if (!row) throw new HttpError('not_found', 'Session not found.');
    // Through Better Auth, so that any session cache it keeps is cleared too.
    await (await auth.$context).internalAdapter.deleteSession(row.token);
    return reply.status(204).send();
  });

  // Tokens -----------------------------------------------------------------------

  app.get(v1('/me/tokens'), async (req) => {
    const session = await requireSession(auth, req, db, true);
    const rows = await db
      .select()
      .from(personalToken)
      .where(eq(personalToken.userId, session.user.id))
      .orderBy(asc(personalToken.createdAt));
    return { items: rows.map(toPersonalToken) };
  });

  app.post(v1('/me/tokens'), async (req, reply) => {
    const session = await requireSession(auth, req, db);
    if (Date.now() - new Date(session.session.createdAt).getTime() >= FRESH_SIGN_IN_MS)
      throw new HttpError('forbidden', 'Sign in again to continue.', { reason: 'reauth_required' });
    const input = CreatePersonalToken.parse(req.body ?? {});
    const [mine] = await db
      .select({ n: count() })
      .from(personalToken)
      .where(eq(personalToken.userId, session.user.id));
    if ((mine?.n ?? 0) >= 100) throw new HttpError('conflict', 'Too many tokens: revoke some.');
    const { token, row } = await issueToken(db, session.user.id, {
      name: input.name,
      expiresAt: new Date(Date.now() + (input.expiresInDays ?? 90) * 86_400_000),
    });
    securityNotification(
      deps.mailer,
      session.user,
      'token',
      { ...mailInstance, token: { name: row.name, expiresAt: row.expiresAt } },
      req.log,
    );
    const body: CreatedPersonalToken = { ...toPersonalToken(row), token };
    return reply.status(201).send(body);
  });

  app.delete(v1('/me/tokens/:tokenId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db, true);
    const { tokenId } = TokenParams.parse(req.params);
    const removed = await revokeTokens(
      db,
      and(eq(personalToken.id, tokenId), eq(personalToken.userId, actor.id)),
      'token_revoked',
    );
    if (removed.length === 0) throw new HttpError('not_found', 'Token not found.');
    return reply.status(204).send();
  });

  // Token proof (decision 0113) -------------------------------------------------

  app.post(v1('/me/token-proof-key'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    if (!actor.tokenId) throw new HttpError('forbidden', 'Only an app token has a proof key.');
    const key = await proofKeyFor(
      db,
      config.AUTH_SECRET,
      actor.tokenId,
      config.AUTH_SECRET_PREVIOUS,
    );
    if (key === 'not_app') throw new HttpError('forbidden', 'Only an app token has a proof key.');
    if (!key) throw new HttpError('unauthorized', 'The token is not valid any more.');
    reply.header('cache-control', 'no-store');
    return key;
  });

  // No token: this is what a client asks before it decides to send one. Reads only.
  app.post(v1('/token-proof'), { bodyLimit: 1024 }, async (req, reply) => {
    await proofLimiter.require(addressBucket(req.ip), 'Too many requests: wait a minute.');
    const input = TokenProofRequest.parse(req.body ?? {});
    await proofKeyLimiter.require(input.keyId, 'Too many requests: wait a minute.');
    const proof = await proveNonce(
      db,
      config.AUTH_SECRET,
      input.keyId,
      input.nonce,
      config.AUTH_SECRET_PREVIOUS,
    );
    // Unknown, revoked and expired keys alike: one query, one answer, nothing logged about them.
    if (!proof) throw new HttpError('not_found', 'Unknown key.');
    reply.header('cache-control', 'no-store');
    return proof;
  });

  // Authorization of the official apps (code + PKCE) -----------------------------

  app.post(v1('/app-authorizations'), async (req) => {
    const session = await requireSession(auth, req, db);
    if (Date.now() - new Date(session.session.createdAt).getTime() >= FRESH_SIGN_IN_MS)
      throw new HttpError('forbidden', 'Sign in again to continue.', { reason: 'reauth_required' });
    const input = CreateAppAuthorization.parse(req.body ?? {});
    if (!allowedRedirects(config, input.clientId).includes(input.redirectUri))
      throw new HttpError('bad_request', 'This redirect address is not allowed for this app.');
    const code = newSecret('', 32);
    const pending: PendingCode = {
      userId: session.user.id,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      deviceName: input.deviceName ?? null,
    };
    await db.insert(verification).values({
      identifier: `app-code:${sha256(code)}`,
      value: JSON.stringify(pending),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    const target = new URL(input.redirectUri);
    target.searchParams.set('code', code);
    if (input.state !== undefined) target.searchParams.set('state', input.state);
    const body: AppAuthorizationRedirect = { redirectTo: target.toString() };
    return body;
  });

  // Denying is decided here too: the page never builds a redirect itself, and only an
  // exact allowed address hears about it (RFC 6749 §4.1.2.1).
  app.post(v1('/app-authorizations/deny'), async (req) => {
    await requireSession(auth, req, db);
    const input = DenyAppAuthorization.parse(req.body ?? {});
    if (!allowedRedirects(config, input.clientId).includes(input.redirectUri))
      throw new HttpError('bad_request', 'This redirect address is not allowed for this app.');
    const target = new URL(input.redirectUri);
    target.searchParams.set('error', 'access_denied');
    if (input.state !== undefined) target.searchParams.set('state', input.state);
    const body: AppAuthorizationRedirect = { redirectTo: target.toString() };
    return body;
  });

  app.post(v1('/app-authorizations/token'), async (req) => {
    await exchangeLimiter.require(addressBucket(req.ip), 'Too many requests: wait a minute.');
    const input = ExchangeAppCode.parse(req.body ?? {});
    // Deleting it first makes the code single use even with concurrent requests.
    const [row] = await db
      .delete(verification)
      .where(eq(verification.identifier, `app-code:${sha256(input.code)}`))
      .returning();
    const invalid = new HttpError('bad_request', 'The code is not valid: sign in again.');
    if (!row || row.expiresAt <= new Date()) throw invalid;
    const pending = JSON.parse(row.value) as PendingCode;
    if (
      pending.clientId !== input.clientId ||
      pending.redirectUri !== input.redirectUri ||
      !safeEqual(pkceChallenge(input.codeVerifier), pending.codeChallenge)
    )
      throw invalid;
    const [owner] = await db.select().from(user).where(eq(user.id, pending.userId));
    if (!owner || owner.deactivatedAt) throw invalid;
    const { token, row: issued } = await issueToken(db, owner.id, {
      name: pending.deviceName ?? CLIENT_NAMES[pending.clientId],
      client: pending.clientId,
    });
    securityNotification(
      deps.mailer,
      owner,
      'token',
      { ...mailInstance, token: { name: issued.name, expiresAt: issued.expiresAt } },
      req.log,
    );
    const body: AppToken = { token, tokenId: issued.id, user: toUser(owner) };
    return body;
  });

  // Account deletion -----------------------------------------------------------

  app.delete(v1('/me'), async (req, reply) => {
    const session = await requireSession(auth, req, db);
    const { password } = DeleteMe.parse(req.body ?? {});
    const userId = session.user.id;
    const [credential] = await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
    if (credential) {
      if (!password) throw new HttpError('bad_request', 'Type your password to confirm.');
      const confirmed = await auth.confirmPassword(session.user, password, toHeaders(req));
      if (typeof confirmed === 'object') {
        reply.header('retry-after', String(confirmed.retryAfter));
        throw new HttpError('rate_limited', 'Too many attempts.');
      }
      if (confirmed === 'unavailable')
        throw new HttpError('internal', 'Authentication temporarily unavailable.');
      if (confirmed === 'failed')
        throw new HttpError('internal', 'The password could not be checked. Try again.');
      if (confirmed === 'wrong') throw new HttpError('forbidden', 'The password is not right.');
    } else if (Date.now() - new Date(session.session.createdAt).getTime() >= FRESH_SIGN_IN_MS) {
      throw new HttpError('forbidden', 'Sign in again, then delete the account within 15 minutes.');
    }

    const keys = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(10892)`);
      const owned = await tx
        .select({ id: project.id, name: project.name })
        .from(projectMember)
        .innerJoin(project, eq(project.id, projectMember.projectId))
        .where(and(eq(projectMember.userId, userId), eq(projectMember.role, 'owner')))
        .for('update', { of: project });
      const soleOwnerOf: DeleteMeBlocked['soleOwnerOf'] = [];
      const alone: string[] = [];
      for (const p of owned) {
        const [others] = await tx
          .select({ n: count() })
          .from(projectMember)
          .where(
            and(
              eq(projectMember.projectId, p.id),
              ne(projectMember.userId, userId),
              activeMember(),
            ),
          );
        const [owners] = await tx
          .select({ n: count() })
          .from(projectMember)
          .where(
            and(
              eq(projectMember.projectId, p.id),
              eq(projectMember.role, 'owner'),
              ne(projectMember.userId, userId),
            ),
          );
        // People with a board grant count too: the project is shared with them.
        const [guests] = await tx
          .select({ n: count() })
          .from(boardGrant)
          .innerJoin(board, eq(board.id, boardGrant.boardId))
          .where(and(eq(board.projectId, p.id), ne(boardGrant.userId, userId), activeGrant()));
        if ((others?.n ?? 0) + (guests?.n ?? 0) === 0) alone.push(p.id);
        else if ((owners?.n ?? 0) === 0) soleOwnerOf.push(p);
      }
      if (soleOwnerOf.length > 0)
        throw new HttpError('conflict', 'Make someone else owner of these projects first.', {
          soleOwnerOf,
        } satisfies DeleteMeBlocked);
      const admins = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt)));
      if (admins.length === 1 && admins[0]?.id === userId)
        throw new HttpError('conflict', 'The instance needs at least one active administrator.');
      const files = await projectFiles(tx, alone);
      if (alone.length > 0) await tx.delete(project).where(inArray(project.id, alone));
      // Sessions, accounts, memberships, grants, tokens and two-factor data cascade.
      await tx.delete(user).where(eq(user.id, userId));
      await recordDeletions(tx, files);
      return files;
    });
    await removeFilesLater({ db, jobs, storage }, keys, req.log);
    return reply.status(204).send();
  });
}
