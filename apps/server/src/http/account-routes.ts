import {
  API_PREFIX,
  type AppAuthorizationRedirect,
  type AppClient,
  type AppToken,
  CreateAppAuthorization,
  type CreatedPersonalToken,
  CreatePersonalToken,
  DeleteMe,
  type DeleteMeBlocked,
  ExchangeAppCode,
  Id,
  z,
} from '@inkadra/shared';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  account,
  asset,
  assetVariant,
  board,
  boardGrant,
  personalToken,
  project,
  projectMember,
  user,
  verification,
} from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { addressBucket, RateLimiter } from '../rate-limits.ts';
import { newSecret, pkceChallenge, safeEqual, sha256 } from '../secrets.ts';
import { issueToken, toPersonalToken } from '../tokens.ts';
import { toUser } from './api-routes.ts';
import { requireActor, requireSession, toHeaders } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  jobs: Jobs;
}

const TokenParams = z.object({ tokenId: Id });
const CODE_TTL_MS = 2 * 60_000;
const FRESH_SIGN_IN_MS = 15 * 60_000;
const CLIENT_NAMES: Record<AppClient, string> = { clipper: 'Inkadra Clipper', mobile: 'Inkadra' };

/**
 * Chrome Web Store ids of the official clipper. Pinned so that no other extension can get a
 * token from someone who clicks "Allow"; self-built ones are added with CLIPPER_EXTENSION_IDS.
 */
export const OFFICIAL_CLIPPER_IDS: readonly string[] = [];

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

export function registerAccountRoutes(app: FastifyInstance, deps: Deps) {
  const { config, db, auth, jobs } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  const exchangeLimiter = new RateLimiter(20, 60_000);

  // Tokens -----------------------------------------------------------------------

  app.get(v1('/me/tokens'), async (req) => {
    const session = await requireSession(auth, req);
    const rows = await db
      .select()
      .from(personalToken)
      .where(eq(personalToken.userId, session.user.id))
      .orderBy(asc(personalToken.createdAt));
    return { items: rows.map(toPersonalToken) };
  });

  app.post(v1('/me/tokens'), async (req, reply) => {
    const session = await requireSession(auth, req);
    const input = CreatePersonalToken.parse(req.body ?? {});
    const [mine] = await db
      .select({ n: count() })
      .from(personalToken)
      .where(eq(personalToken.userId, session.user.id));
    if ((mine?.n ?? 0) >= 100) throw new HttpError('conflict', 'Too many tokens: revoke some.');
    const { token, row } = await issueToken(db, session.user.id, {
      name: input.name,
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null,
    });
    const body: CreatedPersonalToken = { ...toPersonalToken(row), token };
    return reply.status(201).send(body);
  });

  app.delete(v1('/me/tokens/:tokenId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { tokenId } = TokenParams.parse(req.params);
    const removed = await db
      .delete(personalToken)
      .where(and(eq(personalToken.id, tokenId), eq(personalToken.userId, actor.id)))
      .returning({ id: personalToken.id });
    if (removed.length === 0) throw new HttpError('not_found', 'Token not found.');
    return reply.status(204).send();
  });

  // Authorization of the official apps (code + PKCE) -----------------------------

  app.post(v1('/app-authorizations'), async (req) => {
    const session = await requireSession(auth, req);
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

  app.post(v1('/app-authorizations/token'), async (req) => {
    if (!exchangeLimiter.take(addressBucket(req.ip)))
      throw new HttpError('rate_limited', 'Too many requests: wait a minute.');
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
    if (!owner) throw invalid;
    const { token, row: issued } = await issueToken(db, owner.id, {
      name: pending.deviceName ?? CLIENT_NAMES[pending.clientId],
      client: pending.clientId,
    });
    const body: AppToken = { token, tokenId: issued.id, user: toUser(owner) };
    return body;
  });

  // Account deletion -----------------------------------------------------------

  app.delete(v1('/me'), async (req, reply) => {
    const session = await requireSession(auth, req);
    const { password } = DeleteMe.parse(req.body ?? {});
    const userId = session.user.id;
    const [credential] = await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
    if (credential) {
      if (!password) throw new HttpError('bad_request', 'Type your password to confirm.');
      try {
        await auth.api.verifyPassword({ body: { password }, headers: toHeaders(req) });
      } catch {
        throw new HttpError('forbidden', 'The password is not right.');
      }
    } else if (Date.now() - new Date(session.session.createdAt).getTime() > FRESH_SIGN_IN_MS) {
      throw new HttpError('forbidden', 'Sign in again, then delete the account within 15 minutes.');
    }

    const keys = await db.transaction(async (tx) => {
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
          .where(and(eq(projectMember.projectId, p.id), ne(projectMember.userId, userId)));
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
          .where(and(eq(board.projectId, p.id), ne(boardGrant.userId, userId)));
        if ((others?.n ?? 0) + (guests?.n ?? 0) === 0) alone.push(p.id);
        else if ((owners?.n ?? 0) === 0) soleOwnerOf.push(p);
      }
      if (soleOwnerOf.length > 0)
        throw new HttpError('conflict', 'Make someone else owner of these projects first.', {
          soleOwnerOf,
        } satisfies DeleteMeBlocked);
      let files: string[] = [];
      if (alone.length > 0) {
        const originals = await tx
          .select({ key: asset.storageKey })
          .from(asset)
          .where(inArray(asset.projectId, alone));
        const variants = await tx
          .select({ key: assetVariant.storageKey })
          .from(assetVariant)
          .innerJoin(asset, eq(asset.id, assetVariant.assetId))
          .where(inArray(asset.projectId, alone));
        files = [...originals, ...variants].map((r) => r.key);
        await tx.delete(project).where(inArray(project.id, alone));
      }
      // Sessions, accounts, memberships, grants, tokens and two-factor data cascade.
      await tx.delete(user).where(eq(user.id, userId));
      return files;
    });
    if (keys.length > 0) await jobs.deleteFiles(keys);
    return reply.status(204).send();
  });
}
