import {
  API_PREFIX,
  CAPABILITY_ROLE,
  CreateShareLink,
  Id,
  type PickSummary,
  type ShareLink,
  type ShareLinkPicks,
  UpdateShareLink,
  z,
} from '@inkadra/shared';
import { hashPassword } from 'better-auth/crypto';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Actor, requireBoardRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  asset,
  assetVariant,
  board,
  shareGuest,
  shareLink,
  sharePick,
  user,
} from '../db/schema.ts';
import { newSecret, sealer, sha256 } from '../secrets.ts';
import { DocViews, resolveLink, type ShareLinkRow } from '../share-links.ts';
import { iso } from './api-routes.ts';
import { variantUrl } from './assets-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  /** Shared with the guest routes, so both decode a stored document once. */
  docs?: DocViews;
}

const BoardParams = z.object({ boardId: Id });
const LinkParams = z.object({ linkId: Id });

/** Share links a person may create in an hour (decision 0013). */
const LINKS_PER_HOUR = 50;

/** Seals link tokens so the people who manage a link can copy it again. */
export const shareLinkSealer = (authSecret: string) => sealer(authSecret, 'share-link');

/** Path of the guest page of a share link in the web app, followed by the link token. */
export const GUEST_PAGE_PATH = '/s/';

/** Address of the guest page of a link token. */
export const shareLinkUrl = (publicUrl: string, token: string) =>
  `${publicUrl}${GUEST_PAGE_PATH}${token}`;

export function registerShareLinkRoutes(app: FastifyInstance, deps: Deps) {
  const { config, db, auth } = deps;
  const docs = deps.docs ?? new DocViews();
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  const seal = shareLinkSealer(config.AUTH_SECRET);

  async function toShareLink(row: ShareLinkRow, fresh?: string): Promise<ShareLink> {
    const [[b], [creator], [guests], resolved] = await Promise.all([
      db.select({ title: board.title }).from(board).where(eq(board.id, row.boardId)),
      row.createdBy
        ? db
            .select({ id: user.id, name: user.name, image: user.image })
            .from(user)
            .where(eq(user.id, row.createdBy))
        : [],
      db.select({ n: count() }).from(shareGuest).where(eq(shareGuest.shareLinkId, row.id)),
      resolveLink(db, docs, row),
    ]);
    const token =
      resolved.status === 'active' ? (fresh ?? seal.open(row.tokenSealed) ?? null) : null;
    return {
      id: row.id,
      projectId: row.projectId,
      boardId: row.boardId,
      boardTitle: b?.title ?? '',
      includeSubBoards: row.includeSubBoards,
      role: row.role,
      label: row.label,
      hasPassword: row.passwordHash !== null,
      allowDownload: row.allowDownload,
      proofing: row.proofing,
      url: token ? shareLinkUrl(config.PUBLIC_URL, token) : null,
      status: resolved.status,
      createdBy: creator ?? null,
      createdAt: iso(row.createdAt),
      expiresAt: row.expiresAt ? iso(row.expiresAt) : null,
      revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
      guestCount: guests?.n ?? 0,
      viewCount: row.viewCount,
      lastUsedAt: row.lastUsedAt ? iso(row.lastUsedAt) : null,
    };
  }

  /** A link the actor manages: editor or owner on its board, else 404 or 403. */
  async function managedLink(actor: Actor, linkId: string) {
    const [row] = await db.select().from(shareLink).where(eq(shareLink.id, linkId));
    if (!row) throw new HttpError('not_found', 'Share link not found.');
    try {
      await requireBoardRole(db, actor, row.boardId, CAPABILITY_ROLE.share);
    } catch (err) {
      // Without any role on the board, the link does not exist for this person.
      if (err instanceof HttpError && err.code === 'not_found')
        throw new HttpError('not_found', 'Share link not found.');
      throw err;
    }
    return row;
  }

  app.get(v1('/boards/:boardId/share-links'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    await requireBoardRole(db, actor, boardId, CAPABILITY_ROLE.share);
    const rows = await db
      .select()
      .from(shareLink)
      .where(eq(shareLink.boardId, boardId))
      .orderBy(desc(shareLink.createdAt), desc(shareLink.id));
    return { items: await Promise.all(rows.map((r) => toShareLink(r))) };
  });

  app.post(v1('/boards/:boardId/share-links'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const input = CreateShareLink.parse(req.body ?? {});
    const access = await requireBoardRole(db, actor, boardId, CAPABILITY_ROLE.share);
    const token = newSecret('', 32);
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    const [row] = await db.transaction(async (tx) => {
      // Serialize the count and insert across all web processes, not only this instance.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`share-links:${actor.id}`}))`);
      const [recent] = await tx
        .select({ n: count() })
        .from(shareLink)
        .where(
          and(
            eq(shareLink.createdBy, actor.id),
            gt(shareLink.createdAt, sql`now() - interval '1 hour'`),
          ),
        );
      if ((recent?.n ?? 0) >= LINKS_PER_HOUR)
        throw new HttpError('rate_limited', 'Too many share links in the last hour.');
      return tx
        .insert(shareLink)
        .values({
          projectId: access.board.projectId,
          boardId,
          role: input.role,
          includeSubBoards: input.includeSubBoards,
          label: input.label ?? null,
          tokenHash: sha256(token),
          tokenSealed: seal.seal(token),
          passwordHash,
          allowDownload: input.allowDownload,
          proofing: input.proofing,
          createdBy: actor.id,
          expiresAt: input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 86_400_000)
            : null,
        })
        .returning();
    });
    if (!row) throw new Error('Share link insert returned nothing');
    return reply.status(201).send(await toShareLink(row, token));
  });

  app.patch(v1('/share-links/:linkId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { linkId } = LinkParams.parse(req.params);
    const input = UpdateShareLink.parse(req.body ?? {});
    const row = await managedLink(actor, linkId);
    if (row.revokedAt) throw new HttpError('conflict', 'A revoked link cannot be changed.');
    const changesScope = [
      'role',
      'includeSubBoards',
      'allowDownload',
      'proofing',
      'password',
      'expiresAt',
    ].some((key) => key in input);
    if (changesScope && actor.id !== row.createdBy)
      await requireBoardRole(db, actor, row.boardId, 'owner');
    if (input.expiresAt && new Date(input.expiresAt).getTime() > Date.now() + 365 * 86_400_000)
      throw new HttpError('bad_request', 'Share links may expire at most 365 days from now.');
    const patch: Partial<typeof shareLink.$inferInsert> = {};
    if (input.role !== undefined) patch.role = input.role;
    if (input.includeSubBoards !== undefined) patch.includeSubBoards = input.includeSubBoards;
    if (input.label !== undefined) patch.label = input.label;
    if (input.allowDownload !== undefined) patch.allowDownload = input.allowDownload;
    if (input.proofing !== undefined) patch.proofing = input.proofing;
    if (input.expiresAt !== undefined)
      patch.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (input.password === null) patch.passwordHash = null;
    else if (input.password !== undefined) {
      patch.passwordHash = await hashPassword(input.password);
      // Guests who opened the link before must enter the new password.
      patch.sessionsValidAfter = new Date();
    }
    if (Object.keys(patch).length === 0) return toShareLink(row);
    const updated = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(shareLink)
        .set(patch)
        .where(eq(shareLink.id, row.id))
        .returning();
      if (input.expiresAt !== undefined) {
        // Recompute active sessions immediately when either extending or shortening expiry.
        // The browser cookie lasts 30 days independently; the server always checks this cap.
        const cap = patch.expiresAt ?? new Date(Date.now() + 30 * 86_400_000);
        await tx
          .update(shareGuest)
          .set({
            sessionExpiresAt: sql`least(${shareGuest.lastSeenAt} + interval '30 days', ${cap.toISOString()}::timestamptz)`,
          })
          .where(
            and(
              eq(shareGuest.shareLinkId, row.id),
              isNotNull(shareGuest.tokenHash),
              gt(shareGuest.sessionExpiresAt, new Date()),
            ),
          );
      }
      return saved;
    });
    return toShareLink(updated ?? row);
  });

  app.delete(v1('/share-links/:linkId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { linkId } = LinkParams.parse(req.params);
    const row = await managedLink(actor, linkId);
    if (!row.revokedAt)
      await db.update(shareLink).set({ revokedAt: new Date() }).where(eq(shareLink.id, row.id));
    return reply.status(204).send();
  });

  app.get(v1('/share-links/:linkId/picks'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { linkId } = LinkParams.parse(req.params);
    const row = await managedLink(actor, linkId);
    const [guests, picks] = await Promise.all([
      db
        .select()
        .from(shareGuest)
        .where(eq(shareGuest.shareLinkId, row.id))
        .orderBy(asc(shareGuest.createdAt), asc(shareGuest.id)),
      db
        .select()
        .from(sharePick)
        .where(eq(sharePick.shareLinkId, row.id))
        .orderBy(asc(sharePick.boardId), asc(sharePick.elementId), desc(sharePick.updatedAt)),
    ]);
    const assetIds = [...new Set(picks.flatMap((p) => (p.assetId ? [p.assetId] : [])))];
    const files = new Map(
      assetIds.length === 0
        ? []
        : (
            await db
              .select({ id: asset.id, filename: asset.filename, status: asset.status })
              .from(asset)
              .where(and(inArray(asset.id, assetIds), eq(asset.projectId, row.projectId)))
          ).map((a) => [a.id, a]),
    );
    // managedLink already established a board role in this project: the same project
    // authorizes team asset reads. Never expose paths from corrupt/cross-project picks.
    const readyIds = [...files.values()].filter((a) => a.status === 'ready').map((a) => a.id);
    const variants = readyIds.length
      ? await db.select().from(assetVariant).where(inArray(assetVariant.assetId, readyIds))
      : [];
    const items = new Map<string, PickSummary>();
    for (const p of picks) {
      const key = `${p.boardId}/${p.elementId}`;
      let item = items.get(key);
      if (!item) {
        // Rows of a card come newest first: its latest picture names the card.
        item = {
          boardId: p.boardId,
          elementId: p.elementId,
          assetId: p.assetId && files.has(p.assetId) ? p.assetId : null,
          filename: p.assetId ? (files.get(p.assetId)?.filename ?? null) : null,
          variants: variants
            .filter((v) => v.assetId === p.assetId)
            .sort((a, b) => Number(a.size) - Number(b.size))
            .map((v) => ({
              size: v.size,
              width: v.width,
              height: v.height,
              url: variantUrl(v.assetId, v.size),
            })),
          picked: 0,
          rejected: 0,
          starsAverage: null,
          starsCount: 0,
          byGuest: [],
        };
        items.set(key, item);
      }
      if (p.pick === 'picked') item.picked++;
      if (p.pick === 'rejected') item.rejected++;
      if (p.stars !== null) {
        const total = (item.starsAverage ?? 0) * item.starsCount + p.stars;
        item.starsCount++;
        item.starsAverage = total / item.starsCount;
      }
      item.byGuest.push({ guestId: p.guestId, pick: p.pick, stars: p.stars });
    }
    const body: ShareLinkPicks = {
      guests: guests.map((g) => ({
        id: g.id,
        name: g.name,
        createdAt: iso(g.createdAt),
        lastSeenAt: iso(g.lastSeenAt),
      })),
      items: [...items.values()],
    };
    return body;
  });
}
