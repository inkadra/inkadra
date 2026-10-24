import { createHash } from 'node:crypto';
import {
  API_PREFIX,
  CreateGuestSession,
  ElementRef,
  type GuestAsset,
  type GuestBoard,
  type GuestBoardSnapshot,
  type GuestElementReview,
  type GuestPick,
  type GuestSession,
  GuestSetElementReview,
  Id,
  type ReviewStatus,
  SetPick,
  type ShareLinkPreview,
  ThumbnailSize,
  UpdateGuestSession,
  z,
} from '@inkadra/shared';
import { verifyPassword } from 'better-auth/crypto';
import { and, count, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { guestCan } from '../access.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  asset,
  assetVariant,
  boardDoc,
  elementReview,
  elementReviewEvent,
  shareGuest,
  shareLink,
  sharePick,
  user,
} from '../db/schema.ts';
import { safeEqual, sha256 } from '../secrets.ts';
import {
  type DocViews,
  elementAssetIds,
  guestElement,
  pictureAssetId,
  resolveLink,
} from '../share-links.ts';
import type { Storage } from '../storage.ts';
import { iso } from './api-routes.ts';
import { contentDisposition, fileHeaders, parseRange } from './assets-routes.ts';
import { HttpError } from './errors.ts';
import {
  type GuestCommentEvent,
  guestCommentCounts,
  guestCommentVersion,
  registerGuestCommentRoutes,
} from './guest-comments.ts';
import {
  createGuestAuth,
  type GuestContext,
  guestDenied,
  guestPath,
  linkStopped,
} from './guest-context.ts';
import { RateLimiter } from './link-previews.ts';

interface Deps {
  config: Config;
  db: Database;
  storage: Storage;
  docs: DocViews;
}

const TokenParams = z.object({ token: z.string().min(16).max(128) });
const LinkParams = z.object({ linkId: Id });
const BoardParams = z.object({ linkId: Id, boardId: Id });
const ElementParams = BoardParams.extend({ elementId: ElementRef });
const AssetParams = z.object({ linkId: Id, assetId: Id });
const VariantParams = AssetParams.extend({ size: ThumbnailSize });

type GuestEvent =
  | GuestCommentEvent
  | { kind: 'review'; boardId: string; elementId: string; status: ReviewStatus; guestId: string };

/**
 * Called after every guest write the team should hear about.
 *
 * TODO(wave-3 notifications): the notification system of decision 0013 is not on main yet.
 * Once it is, call it from here: a guest reply notifies the people who wrote in the thread
 * (`reply`), a new thread on a card notifies its creator (`comment`), a review decision
 * notifies the card's creator and whoever asked for review (`review`), all with
 * `actorGuestId` set to the guest.
 *
 * TODO(wave-3 notices): send the stateless BoardNotice (`comments` with elementId and
 * threadId, or `review` with elementId) to open boards once the collab notice channel lands.
 */
function afterGuestWrite(_event: GuestEvent): void {}

/** Failed attempts per key in a sliding window; successes are not counted. */
class Failures {
  private hits = new Map<string, number[]>();
  private pending = new Map<string, number>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  private recent(key: string) {
    const now = Date.now();
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }
  blocked(key: string) {
    return this.recent(key).length + (this.pending.get(key) ?? 0) >= this.max;
  }
  begin(key: string) {
    if (this.blocked(key)) return false;
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    return true;
  }
  finish(key: string, failed: boolean) {
    const pending = (this.pending.get(key) ?? 1) - 1;
    if (pending) this.pending.set(key, pending);
    else this.pending.delete(key);
    if (failed) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(key, [...this.recent(key), Date.now()]);
    }
  }
}

/** New guests a link accepts in a day, whatever the address (decision 0013). */
const NEW_GUESTS_PER_DAY = 500;

function matchesEtag(header: string | undefined, version: string) {
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, '').replace(/^"|"$/g, ''))
    .some((t) => t === version || t === '*');
}

export async function registerGuestRoutes(app: FastifyInstance, deps: Deps) {
  const { config, db, storage, docs } = deps;
  const guests = createGuestAuth({ config, db, docs });
  const previews = new RateLimiter(60, 60_000);
  const wrongPasswords = new Failures(10, 15 * 60_000);
  const newGuests = new RateLimiter(10, 60 * 60_000);
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  const assetPath = (linkId: string, assetId: string) => `${guestPath(linkId)}/assets/${assetId}`;

  /** Covers of the link's boards that guests may see as thumbnails. */
  async function covers(ctx: GuestContext): Promise<Set<string>> {
    const ids = [...ctx.boards.values()].flatMap((b) =>
      b.row.coverAssetId ? [b.row.coverAssetId] : [],
    );
    if (ids.length === 0) return new Set();
    const rows = await db
      .select({ id: asset.id })
      .from(asset)
      .where(
        and(
          inArray(asset.id, ids),
          eq(asset.projectId, ctx.link.projectId),
          eq(asset.status, 'ready'),
        ),
      );
    return new Set(rows.map((r) => r.id));
  }

  async function guestBoards(ctx: GuestContext): Promise<GuestBoard[]> {
    const ready = await covers(ctx);
    return [...ctx.boards.values()].map(({ row, parentBoardId }) => ({
      id: row.id,
      parentBoardId,
      kind: row.kind,
      title: row.title,
      coverUrl:
        row.coverAssetId && ready.has(row.coverAssetId)
          ? `${assetPath(ctx.link.id, row.coverAssetId)}/variants/512`
          : null,
    }));
  }

  async function toSession(ctx: GuestContext): Promise<GuestSession> {
    return {
      linkId: ctx.link.id,
      guest: { id: ctx.guest.id, name: ctx.guest.name },
      role: ctx.link.role,
      boardId: ctx.link.boardId,
      boards: await guestBoards(ctx),
      allowDownload: ctx.link.allowDownload,
      proofing: ctx.link.proofing,
      linkExpiresAt: ctx.link.expiresAt ? iso(ctx.link.expiresAt) : null,
      sessionExpiresAt: iso(ctx.guest.sessionExpiresAt),
    };
  }

  async function guestAssets(ctx: GuestContext, ids: string[]): Promise<GuestAsset[]> {
    if (ids.length === 0) return [];
    const [rows, variants] = await Promise.all([
      db
        .select()
        .from(asset)
        .where(and(inArray(asset.id, ids), eq(asset.projectId, ctx.link.projectId))),
      db.select().from(assetVariant).where(inArray(assetVariant.assetId, ids)),
    ]);
    const download = ctx.link.allowDownload;
    return rows
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        mime: row.mime,
        filename: download ? row.filename : null,
        size: download ? row.size : null,
        width: row.width,
        height: row.height,
        durationMs: row.durationMs,
        variants:
          row.status === 'ready'
            ? variants
                .filter((v) => v.assetId === row.id)
                .sort((a, b) => Number(a.size) - Number(b.size))
                .map((v) => ({
                  size: v.size,
                  width: v.width,
                  height: v.height,
                  url: `${assetPath(ctx.link.id, row.id)}/variants/${v.size}`,
                }))
            : [],
        downloadUrl: download ? `${assetPath(ctx.link.id, row.id)}/file` : null,
      }));
  }

  // Reviews as a guest sees them ---------------------------------------------------

  async function reviewRows(ctx: GuestContext, boardId: string, elementId?: string) {
    return db
      .select({ r: elementReview, userName: user.name, guestName: shareGuest.name })
      .from(elementReview)
      .leftJoin(user, eq(user.id, elementReview.changedBy))
      .leftJoin(shareGuest, eq(shareGuest.id, elementReview.changedByGuest))
      .where(
        and(
          eq(elementReview.boardId, boardId),
          or(isNull(elementReview.shareLinkId), eq(elementReview.shareLinkId, ctx.link.id)),
          elementId ? eq(elementReview.elementId, elementId) : undefined,
        ),
      );
  }
  type ReviewRow = Awaited<ReturnType<typeof reviewRows>>[number];

  function toGuestReview(row: ReviewRow, ctx: GuestContext): GuestElementReview {
    const { r } = row;
    const fromLink = r.shareLinkId !== null;
    return {
      elementId: r.elementId,
      status: r.status,
      // Notes only when a guest of this link wrote them.
      note: fromLink ? r.note : null,
      changedBy: fromLink
        ? { kind: 'guest', name: row.guestName, isYou: r.changedByGuest === ctx.guest.id }
        : r.changedBy
          ? { kind: 'team', name: row.userName, isYou: false }
          : { kind: 'deleted', name: null, isYou: false },
      changedAt: iso(r.changedAt),
    };
  }

  /**
   * Per card, the status this guest sees: the more recent of the team's and their link's
   * decision (the team's on a tie); a withdrawn decision of the link counts for nobody.
   */
  function seenReviews(rows: ReviewRow[], ctx: GuestContext) {
    const team = new Map<string, ReviewRow>();
    const own = new Map<string, ReviewRow>();
    for (const row of rows) (row.r.shareLinkId ? own : team).set(row.r.elementId, row);
    const out = new Map<string, { row: ReviewRow; review: GuestElementReview }>();
    for (const id of new Set([...team.keys(), ...own.keys()])) {
      const t = team.get(id);
      const o = own.get(id);
      const link = o && o.r.status !== 'none' ? o : undefined;
      const pick = t && link ? (link.r.changedAt > t.r.changedAt ? link : t) : (link ?? t);
      if (pick) out.set(id, { row: pick, review: toGuestReview(pick, ctx) });
    }
    return out;
  }

  async function snapshot(ctx: GuestContext, boardId: string) {
    const top = guests.requireBoard(ctx, boardId);
    const view = await docs.get(db, boardId);
    const shown = await guests.shown(ctx, boardId);
    const ids = shown.map((e) => e.id);
    const visible = new Set(ids);
    const assetIds = [...new Set(shown.flatMap(elementAssetIds))];
    const [boards, assets, reviews, commentCounts, picks, commentsVersion] = await Promise.all([
      guestBoards(ctx),
      guestAssets(ctx, assetIds),
      reviewRows(ctx, boardId),
      guestCan(ctx.link, 'read_comments') ? guestCommentCounts(db, ctx, boardId, ids) : [],
      db
        .select()
        .from(sharePick)
        .where(and(eq(sharePick.guestId, ctx.guest.id), eq(sharePick.boardId, boardId))),
      guestCan(ctx.link, 'read_comments') ? guestCommentVersion(db, ctx, boardId, ids) : null,
    ]);
    const breadcrumb: Array<{ id: string; title: string }> = [];
    for (let at = top.parentBoardId; at; at = ctx.boards.get(at)?.parentBoardId ?? null) {
      const b = ctx.boards.get(at);
      if (!b) break;
      breadcrumb.unshift({ id: b.row.id, title: b.row.title });
    }
    const board = boards.find((b) => b.id === boardId) as GuestBoard;
    const body: Omit<GuestBoardSnapshot, 'version' | 'generatedAt'> = {
      board: { ...board, aspect: top.row.kind === 'storyboard' ? view.aspect : null },
      breadcrumb,
      elements: shown.map((el) => guestElement(view, el) as GuestBoardSnapshot['elements'][number]),
      assets,
      reviews: [...seenReviews(reviews, ctx).values()]
        .filter(({ review }) => visible.has(review.elementId) && review.status !== 'none')
        .map(({ review }) => review)
        .sort((a, b) => a.elementId.localeCompare(b.elementId)),
      commentCounts,
      picks: picks
        .filter((p) => visible.has(p.elementId))
        .sort((a, b) => a.elementId.localeCompare(b.elementId))
        .map((p) => ({
          boardId: p.boardId,
          elementId: p.elementId,
          pick: p.pick,
          stars: p.stars,
          updatedAt: iso(p.updatedAt),
        })),
    };
    // Guests poll this to learn when to refetch comments too. Count-only changes miss edits
    // and replies; withdrawn reviews and changes to the link must also move the version.
    const version = createHash('sha256')
      .update(JSON.stringify(body))
      .update(
        JSON.stringify({
          document: await db
            .select({ updatedAt: boardDoc.updatedAt })
            .from(boardDoc)
            .where(eq(boardDoc.boardId, boardId)),
          link: ctx.link.updatedAt,
          boards: [...ctx.boards.values()].map(({ row }) => ({
            id: row.id,
            updatedAt: row.updatedAt,
          })),
          covers: await guestAssets(ctx, [
            ...new Set(
              [...ctx.boards.values()].flatMap(({ row }) =>
                row.coverAssetId ? [row.coverAssetId] : [],
              ),
            ),
          ]),
          commentsVersion,
          reviews: reviews
            .filter(({ r }) => visible.has(r.elementId))
            .sort((a, b) => a.r.id.localeCompare(b.r.id)),
        }),
      )
      .digest('base64url')
      .slice(0, 32);
    return { body, version };
  }

  /** Files guests may fetch: shown by a visible element of a link board, or a cover. */
  async function reachableAssets(ctx: GuestContext) {
    const shown = new Set<string>();
    for (const boardId of ctx.boards.keys())
      for (const el of await guests.shown(ctx, boardId))
        for (const id of elementAssetIds(el)) shown.add(id);
    return { shown, covers: await covers(ctx) };
  }

  async function projectAsset(ctx: GuestContext, assetId: string) {
    const [row] = await db
      .select()
      .from(asset)
      .where(and(eq(asset.id, assetId), eq(asset.projectId, ctx.link.projectId)));
    if (!row) throw new HttpError('not_found', 'Asset not found.');
    return row;
  }

  function guestFileHeaders(reply: FastifyReply, etag: string) {
    fileHeaders(reply, etag);
    // Checked on every request: a revoked link must stop serving at once.
    reply.header('cache-control', 'private, no-cache');
  }

  await app.register(async (scope) => {
    // The token must not leak to the sites of link cards nor into search engines.
    scope.addHook('onSend', async (_req, reply) => {
      reply.header('referrer-policy', 'no-referrer');
      reply.header('x-robots-tag', 'noindex, nofollow');
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    });

    scope.get(v1('/guest/by-token/:token'), async (req) => {
      if (!previews.take(req.ip))
        throw new HttpError('rate_limited', 'Too many requests: wait a minute.');
      const { token } = TokenParams.parse(req.params);
      const [link] = await db
        .select()
        .from(shareLink)
        .where(eq(shareLink.tokenHash, sha256(token)));
      if (!link) throw new HttpError('not_found', 'Share link not found.');
      const resolved = await resolveLink(db, docs, link);
      if (resolved.status !== 'active') throw linkStopped(resolved.status);
      const locked = link.passwordHash !== null;
      const [creator] =
        !locked && link.createdBy
          ? await db.select({ name: user.name }).from(user).where(eq(user.id, link.createdBy))
          : [];
      const body: ShareLinkPreview = {
        linkId: link.id,
        instanceName: config.INSTANCE_NAME,
        needsPassword: locked,
        boardTitle: locked ? null : (resolved.boards.get(link.boardId)?.row.title ?? null),
        sharedBy: creator?.name ?? null,
        role: locked ? null : link.role,
        expiresAt: !locked && link.expiresAt ? iso(link.expiresAt) : null,
      };
      return body;
    });

    scope.post(v1('/guest/links/:linkId/session'), async (req, reply) => {
      const { linkId } = LinkParams.parse(req.params);
      const input = CreateGuestSession.parse(req.body ?? {});
      const [link] = await db.select().from(shareLink).where(eq(shareLink.id, linkId));
      if (!link || !safeEqual(sha256(input.token), link.tokenHash))
        throw new HttpError('not_found', 'Share link not found.');
      const resolved = await resolveLink(db, docs, link);
      if (resolved.status !== 'active') throw linkStopped(resolved.status);
      if (link.passwordHash) {
        const key = `${link.id}|${req.ip}`;
        if (wrongPasswords.blocked(key))
          throw new HttpError('rate_limited', 'Too many wrong passwords: try again later.');
        if (!input.password)
          throw guestDenied('forbidden', 'password_required', 'This link needs a password.');
        // Reserve before the asynchronous hash check: simultaneous wrong passwords must
        // not all pass the limit while earlier checks are still running.
        if (!wrongPasswords.begin(key))
          throw new HttpError('rate_limited', 'Too many wrong passwords: try again later.');
        let valid = false;
        try {
          valid = await verifyPassword({ hash: link.passwordHash, password: input.password });
        } finally {
          wrongPasswords.finish(key, !valid);
        }
        if (!valid) {
          throw guestDenied('forbidden', 'wrong_password', 'Wrong password.');
        }
      }
      const returning = await guests.cookieGuest(req, link.id);
      if (!returning && !newGuests.take(`${link.id}|${req.ip}`))
        throw new HttpError('rate_limited', 'Too many new guests: try again later.');
      const guest = await db.transaction(async (tx) => {
        // Enforce the daily link-wide cap even for concurrent requests on different workers.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`guest-sessions:${link.id}`}))`,
        );
        if (!returning) {
          const [today] = await tx
            .select({ n: count() })
            .from(shareGuest)
            .where(
              and(
                eq(shareGuest.shareLinkId, link.id),
                gt(shareGuest.createdAt, sql`now() - interval '1 day'`),
              ),
            );
          if ((today?.n ?? 0) >= NEW_GUESTS_PER_DAY)
            throw new HttpError('rate_limited', 'Too many new guests today: try again tomorrow.');
        }
        const guest = await guests.startSession(reply, link, returning, input.name, tx);
        await tx
          .update(shareLink)
          .set({
            viewCount: sql`${shareLink.viewCount} + 1`,
            lastUsedAt: new Date(),
            updatedAt: sql`${shareLink.updatedAt}`,
          })
          .where(eq(shareLink.id, link.id));
        return guest;
      });
      return toSession({ link, guest, boards: resolved.boards, shown: new Map() });
    });

    scope.get(v1('/guest/links/:linkId/session'), async (req, reply) => {
      const { linkId } = LinkParams.parse(req.params);
      return toSession(await guests.requireGuest(req, reply, linkId));
    });

    scope.patch(v1('/guest/links/:linkId/session'), async (req, reply) => {
      const { linkId } = LinkParams.parse(req.params);
      const { name } = UpdateGuestSession.parse(req.body ?? {});
      const ctx = await guests.requireGuest(req, reply, linkId);
      guests.takeWrite(ctx);
      const [guest] = await db
        .update(shareGuest)
        .set({ name })
        .where(eq(shareGuest.id, ctx.guest.id))
        .returning();
      return toSession({ ...ctx, guest: guest ?? ctx.guest });
    });

    scope.delete(v1('/guest/links/:linkId/session'), async (req, reply) => {
      const { linkId } = LinkParams.parse(req.params);
      const guest = await guests.cookieGuest(req, linkId);
      if (guest)
        await db.update(shareGuest).set({ tokenHash: null }).where(eq(shareGuest.id, guest.id));
      guests.setCookie(reply, linkId, null);
      return reply.status(204).send();
    });

    scope.get(v1('/guest/links/:linkId/boards/:boardId'), async (req, reply) => {
      const { linkId, boardId } = BoardParams.parse(req.params);
      const ctx = await guests.requireGuest(req, reply, linkId);
      const { body, version } = await snapshot(ctx, boardId);
      reply.header('etag', `"${version}"`);
      reply.header('cache-control', 'private, no-cache');
      if (matchesEtag(req.headers['if-none-match'], version)) return reply.status(304).send();
      const full: GuestBoardSnapshot = { ...body, version, generatedAt: new Date().toISOString() };
      return full;
    });

    scope.get(v1('/guest/links/:linkId/assets/:assetId/variants/:size'), async (req, reply) => {
      const { linkId, assetId, size } = VariantParams.parse(req.params);
      const ctx = await guests.requireGuest(req, reply, linkId);
      const reachable = await reachableAssets(ctx);
      if (!reachable.shown.has(assetId) && !reachable.covers.has(assetId))
        throw new HttpError('not_found', 'Asset not found.');
      if ((await projectAsset(ctx, assetId)).status !== 'ready')
        throw new HttpError('not_found', 'The picture is not ready.');
      const [variant] = await db
        .select()
        .from(assetVariant)
        .where(and(eq(assetVariant.assetId, assetId), eq(assetVariant.size, size)));
      if (!variant) throw new HttpError('not_found', 'No such variant.');
      const etag = `${assetId}-${size}`;
      guestFileHeaders(reply, etag);
      if (matchesEtag(req.headers['if-none-match'], etag)) return reply.status(304).send();
      reply.header('content-type', 'image/webp');
      return reply.send(await storage.read(variant.storageKey));
    });

    scope.get(v1('/guest/links/:linkId/assets/:assetId/file'), async (req, reply) => {
      const { linkId, assetId } = AssetParams.parse(req.params);
      const ctx = await guests.requireGuest(req, reply, linkId);
      // Covers are thumbnails only: they never make an original reachable.
      if (!(await reachableAssets(ctx)).shown.has(assetId))
        throw new HttpError('not_found', 'Asset not found.');
      if (!ctx.link.allowDownload)
        throw new HttpError('forbidden', 'This link does not allow downloads.');
      const row = await projectAsset(ctx, assetId);
      if (row.status === 'pending') throw new HttpError('not_found', 'The upload is not finished.');
      const etag = row.sha256 ?? row.id;
      guestFileHeaders(reply, etag);
      if (matchesEtag(req.headers['if-none-match'], etag)) return reply.status(304).send();
      reply.header('content-type', 'application/octet-stream');
      reply.header('content-disposition', contentDisposition('attachment', row.filename));
      reply.header('accept-ranges', 'bytes');
      const range = parseRange(req.headers.range, row.size);
      if (range === undefined) {
        reply.header('content-range', `bytes */${row.size}`);
        return reply.status(416).send();
      }
      if (range) {
        reply.status(206);
        reply.header('content-range', `bytes ${range.start}-${range.end}/${row.size}`);
        reply.header('content-length', range.end - range.start + 1);
        return reply.send(await storage.read(row.storageKey, range));
      }
      reply.header('content-length', row.size);
      return reply.send(await storage.read(row.storageKey));
    });

    scope.put(
      v1('/guest/links/:linkId/boards/:boardId/elements/:elementId/review'),
      async (req, reply) => {
        const { linkId, boardId, elementId } = ElementParams.parse(req.params);
        const input = GuestSetElementReview.parse(req.body ?? {});
        const ctx = await guests.requireGuest(req, reply, linkId);
        guests.requireCan(ctx, 'review');
        guests.requireBoard(ctx, boardId);
        await guests.requireElement(ctx, boardId, elementId);
        guests.requireName(ctx);
        guests.takeWrite(ctx);
        await db.transaction(async (tx) => {
          // One decision per link and card at a time.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`review:${boardId}:${elementId}:${linkId}`}))`,
          );
          const rows = await tx
            .select()
            .from(elementReview)
            .where(
              and(
                eq(elementReview.boardId, boardId),
                eq(elementReview.elementId, elementId),
                or(isNull(elementReview.shareLinkId), eq(elementReview.shareLinkId, linkId)),
              ),
            );
          const own = rows.find((r) => r.shareLinkId === linkId);
          if (input.status === 'none') {
            const seen = seenReviews(
              rows.map((r) => ({ r, userName: null, guestName: null })),
              ctx,
            ).get(elementId);
            // A guest withdraws only a decision they made and still see.
            if (
              !seen ||
              seen.row.r.shareLinkId !== linkId ||
              seen.row.r.changedByGuest !== ctx.guest.id
            )
              throw new HttpError('forbidden', 'You can only withdraw your own decision.');
          }
          const note = input.status === 'none' ? null : input.note || null;
          const now = new Date();
          await tx
            .insert(elementReview)
            .values({
              boardId,
              elementId,
              projectId: ctx.link.projectId,
              status: input.status,
              note,
              changedByGuest: ctx.guest.id,
              shareLinkId: linkId,
              changedAt: now,
            })
            .onConflictDoUpdate({
              target: [elementReview.boardId, elementReview.elementId, elementReview.shareLinkId],
              set: { status: input.status, note, changedByGuest: ctx.guest.id, changedAt: now },
            });
          await tx.insert(elementReviewEvent).values({
            boardId,
            elementId,
            previous: own?.status ?? 'none',
            status: input.status,
            note,
            guestId: ctx.guest.id,
            shareLinkId: linkId,
          });
        });
        afterGuestWrite({
          kind: 'review',
          boardId,
          elementId,
          status: input.status,
          guestId: ctx.guest.id,
        });
        const after = await reviewRows(ctx, boardId, elementId);
        const seen = seenReviews(after, ctx).get(elementId);
        if (seen) return seen.review;
        // Withdrawn and the team never set a status: the guest's own `none`.
        const own = after.find((r) => r.r.shareLinkId === linkId);
        if (!own) throw new Error('Review row missing');
        return toGuestReview(own, ctx);
      },
    );

    scope.put(
      v1('/guest/links/:linkId/boards/:boardId/elements/:elementId/pick'),
      async (req, reply) => {
        const { linkId, boardId, elementId } = ElementParams.parse(req.params);
        const input = SetPick.parse(req.body ?? {});
        const ctx = await guests.requireGuest(req, reply, linkId);
        guests.requireCan(ctx, 'pick');
        guests.requireBoard(ctx, boardId);
        const el = await guests.requireElement(ctx, boardId, elementId);
        const picture = pictureAssetId(el);
        if (!picture) throw new HttpError('bad_request', 'Only pictures can be picked.');
        guests.requireName(ctx);
        guests.takeWrite(ctx);
        const key = and(
          eq(sharePick.guestId, ctx.guest.id),
          eq(sharePick.boardId, boardId),
          eq(sharePick.elementId, elementId),
        );
        const [existing] = await db.select().from(sharePick).where(key);
        const pick = input.pick === undefined ? (existing?.pick ?? null) : input.pick;
        const stars = input.stars === undefined ? (existing?.stars ?? null) : input.stars;
        const now = new Date();
        let body: GuestPick;
        if (pick === null && stars === null) {
          await db.delete(sharePick).where(key);
          body = { boardId, elementId, pick: null, stars: null, updatedAt: iso(now) };
        } else {
          const [known] = await db
            .select({ id: asset.id })
            .from(asset)
            .where(and(eq(asset.id, picture), eq(asset.projectId, ctx.link.projectId)));
          const assetId = known?.id ?? null;
          const [row] = await db
            .insert(sharePick)
            .values({
              guestId: ctx.guest.id,
              shareLinkId: linkId,
              boardId,
              elementId,
              assetId,
              pick,
              stars,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [sharePick.guestId, sharePick.boardId, sharePick.elementId],
              set: { pick, stars, assetId, updatedAt: now },
            })
            .returning();
          if (!row) throw new Error('Pick not saved');
          body = {
            boardId,
            elementId,
            pick: row.pick,
            stars: row.stars,
            updatedAt: iso(row.updatedAt),
          };
        }
        return body;
      },
    );

    registerGuestCommentRoutes(scope, { db, guests, afterWrite: afterGuestWrite });
  });
}
