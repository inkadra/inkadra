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
  VariantQuery,
  z,
} from '@inkadra/shared';
import { verifyPassword } from 'better-auth/crypto';
import { and, asc, count, eq, getTableColumns, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { guestCan } from '../access.ts';
import { storedElement } from '../board-content.ts';
import { type BoardNotifier, noNotices } from '../board-notices.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  asset,
  assetVariant,
  boardDoc,
  comment,
  elementReview,
  elementReviewEvent,
  shareGuest,
  shareLink,
  sharePick,
  user,
} from '../db/schema.ts';
import { afterCommit, notify, Recipients } from '../notifications.ts';
import { addressBucket, Failures } from '../rate-limits.ts';
import { safeEqual, sha256 } from '../secrets.ts';
import {
  type DocViews,
  elementAssetIds,
  guestElement,
  pictureAssetId,
  resolveLink,
} from '../share-links.ts';
import { animatedVariantKey, type Storage } from '../storage.ts';
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
  notices?: BoardNotifier;
}

const TokenParams = z.object({ token: z.string().min(16).max(128) });
const LinkParams = z.object({ linkId: Id });
const BoardParams = z.object({ linkId: Id, boardId: Id });
const ElementParams = BoardParams.extend({ elementId: ElementRef });
const AssetParams = z.object({ linkId: Id, assetId: Id });
const VariantParams = AssetParams.extend({ size: ThumbnailSize });

type GuestEvent =
  | GuestCommentEvent
  | {
      kind: 'review';
      projectId: string;
      boardId: string;
      elementId: string;
      status: ReviewStatus;
      previous: ReviewStatus;
      requestedBy: string | null;
      guestId: string;
    };

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
  const notices = deps.notices ?? noNotices;

  /** Use the same recipients, access checks and queued email preferences as team writes. */
  async function afterGuestWrite(event: GuestEvent) {
    await afterCommit(app.log, async () => {
      const recipients = new Recipients(null);
      if (event.kind === 'comment') {
        // Guests cannot mention; edits and deletions only invalidate the board's comments.
        if (event.action !== 'created') return;
        if (event.commentId !== event.threadId) {
          const writers = await db
            .selectDistinct({ id: comment.authorId })
            .from(comment)
            .where(
              and(
                eq(comment.boardId, event.boardId),
                or(eq(comment.id, event.threadId), eq(comment.threadId, event.threadId)),
                isNull(comment.deletedAt),
              ),
            );
          for (const writer of writers) recipients.add(writer.id, 'reply');
        } else if (event.elementId) {
          const card = await storedElement(db, event.boardId, event.elementId);
          recipients.add(card?.createdBy, 'comment');
        }
      } else {
        if (event.previous === event.status) return;
        const card = await storedElement(db, event.boardId, event.elementId);
        recipients.add(card?.createdBy, 'review').add(event.requestedBy, 'review');
      }
      await notify(
        db,
        {
          actor: { guestId: event.guestId },
          projectId: event.projectId,
          boardId: event.boardId,
          elementId: event.elementId,
          commentId: event.kind === 'comment' ? event.commentId : null,
          reviewStatus: event.kind === 'review' ? event.status : null,
        },
        recipients,
      );
    });
    // The injected notifier delivers in all and split mode, even if notification fanout fails.
    await afterCommit(app.log, () =>
      notices.notify(
        event.boardId,
        event.kind === 'comment'
          ? { type: 'comments', elementId: event.elementId, threadId: event.threadId }
          : { type: 'review', elementId: event.elementId },
      ),
    );
  }
  const guests = createGuestAuth({ config, db, docs });
  const previews = new RateLimiter(60, 60_000);
  const wrongPasswords = new Failures(10, 15 * 60_000);
  const linkPasswords = new Failures(100, 15 * 60_000);
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
    const [creator] = ctx.link.createdBy
      ? await db.select({ name: user.name }).from(user).where(eq(user.id, ctx.link.createdBy))
      : [];
    return {
      sharedBy: creator?.name ?? null,
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

  /** The ready audio file of a storyboard animatic of the link (decision 0046). */
  function streamable(ctx: GuestContext, row: { id: string; kind: string; status: string }) {
    return ctx.assets.audio.has(row.id) && row.kind === 'audio' && row.status === 'ready';
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
        animated: row.animated,
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
        streamUrl: streamable(ctx, row) ? `${assetPath(ctx.link.id, row.id)}/stream` : null,
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
          ? { kind: 'team', name: r.importedAuthor ?? row.userName, isYou: false }
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
    const view = ctx.views.get(boardId);
    if (!view) throw new HttpError('not_found', 'Board not found.');
    const shown = await guests.shown(ctx, boardId);
    const ids = shown.map((e) => e.id);
    const visible = new Set(ids);
    const shownAssets = new Set(shown.flatMap(elementAssetIds));
    const track = top.row.kind === 'storyboard' ? view.audio : null;
    const assetIds = [...new Set([...shownAssets, ...(track ? [track.assetId] : [])])];
    const [boards, listed, reviews, commentCounts, picks, commentsVersion] = await Promise.all([
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
    // The sound track only once its file can be streamed; nothing about it before.
    const playable = track && listed.some((a) => a.id === track.assetId && a.streamUrl);
    const assets = listed.filter((a) => shownAssets.has(a.id) || (playable && a.id === track.assetId));
    const body: Omit<GuestBoardSnapshot, 'version' | 'generatedAt'> = {
      board: {
        ...board,
        aspect: top.row.kind === 'storyboard' ? view.aspect : null,
        animaticAudio: playable ? { assetId: track.assetId, volume: track.volume } : null,
      },
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

    scope.get(v1('/guest/by-token/:token'), async (req, reply) => {
      if (!previews.take(addressBucket(req.ip))) {
        reply.header('retry-after', previews.retryAfterSeconds(addressBucket(req.ip)));
        throw new HttpError('rate_limited', 'Too many requests: wait a minute.');
      }
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
        const key = `${link.id}|${addressBucket(req.ip)}`;
        const passwordLimit = () => {
          // In-flight verifications have no known completion time. With no completed
          // blocking window, zero allows a retry instead of inventing a 15-minute lockout.
          reply.header(
            'retry-after',
            Math.max(
              wrongPasswords.retryAfterSeconds(key),
              linkPasswords.retryAfterSeconds(link.id),
            ),
          );
          return new HttpError('rate_limited', 'Too many wrong passwords: try again later.');
        };
        if (wrongPasswords.blocked(key) || linkPasswords.blocked(link.id)) throw passwordLimit();
        if (!input.password)
          throw guestDenied('forbidden', 'password_required', 'This link needs a password.');
        // Reserve before the asynchronous hash check: simultaneous wrong passwords must
        // not all pass the limit while earlier checks are still running.
        if (!linkPasswords.begin(link.id)) throw passwordLimit();
        if (!wrongPasswords.begin(key)) {
          linkPasswords.finish(link.id, false);
          throw passwordLimit();
        }
        let valid = false;
        try {
          valid = await verifyPassword({ hash: link.passwordHash, password: input.password });
        } finally {
          wrongPasswords.finish(key, !valid);
          linkPasswords.finish(link.id, !valid);
        }
        if (!valid) {
          throw guestDenied('forbidden', 'wrong_password', 'Wrong password.');
        }
      }
      const returning = await guests.cookieGuest(req, link.id);
      const addressKey = `${link.id}|${addressBucket(req.ip)}`;
      if (!returning && !newGuests.take(addressKey)) {
        reply.header('retry-after', newGuests.retryAfterSeconds(addressKey));
        throw new HttpError('rate_limited', 'Too many new guests: try again later.');
      }
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
          if ((today?.n ?? 0) >= NEW_GUESTS_PER_DAY) {
            const [release] = await tx
              .select({
                seconds: sql<number>`ceil(extract(epoch from (${shareGuest.createdAt} + interval '1 day' - now())))::integer`,
              })
              .from(shareGuest)
              .where(
                and(
                  eq(shareGuest.shareLinkId, link.id),
                  gt(shareGuest.createdAt, sql`now() - interval '1 day'`),
                ),
              )
              .orderBy(asc(shareGuest.createdAt))
              .offset((today?.n ?? 0) - NEW_GUESTS_PER_DAY)
              .limit(1);
            reply.header('retry-after', Math.max(0, release?.seconds ?? 0));
            throw new HttpError('rate_limited', 'Too many new guests today: try again later.');
          }
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
      return toSession({ link, guest, ...resolved });
    });

    scope.get(v1('/guest/links/:linkId/session'), async (req, reply) => {
      const { linkId } = LinkParams.parse(req.params);
      return toSession(await guests.requireGuest(req, reply, linkId));
    });

    scope.patch(v1('/guest/links/:linkId/session'), async (req, reply) => {
      const { linkId } = LinkParams.parse(req.params);
      const { name } = UpdateGuestSession.parse(req.body ?? {});
      const ctx = await guests.requireGuest(req, reply, linkId);
      guests.takeWrite(ctx, reply);
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
      const { animated } = VariantQuery.parse(req.query ?? {});
      const ctx = await guests.requireGuest(req, reply, linkId);
      const reachable = ctx.assets;
      if (!reachable.shown.has(assetId) && !reachable.covers.has(assetId))
        throw new HttpError('not_found', 'Asset not found.');
      if ((await projectAsset(ctx, assetId)).status !== 'ready')
        throw new HttpError('not_found', 'The picture is not ready.');
      if (animated) {
        const key = animatedVariantKey(assetId, size);
        if ((await storage.size(key)) === null)
          throw new HttpError('not_found', 'No such variant.');
        const etag = createHash('sha256')
          .update(`${assetId}-${size}-animated-${key}`)
          .digest('hex');
        guestFileHeaders(reply, etag);
        if (matchesEtag(req.headers['if-none-match'], etag)) return reply.status(304).send();
        reply.header('content-type', 'image/webp');
        return reply.send(await storage.read(key));
      }
      const [variant] = await db
        .select({ ...getTableColumns(assetVariant), revision: sql<string>`xmin::text` })
        .from(assetVariant)
        .where(and(eq(assetVariant.assetId, assetId), eq(assetVariant.size, size)));
      if (!variant) throw new HttpError('not_found', 'No such variant.');
      const etag = createHash('sha256')
        .update(`${assetId}-${size}-${variant.storageKey}-${variant.revision}`)
        .digest('hex');
      guestFileHeaders(reply, etag);
      if (matchesEtag(req.headers['if-none-match'], etag)) return reply.status(304).send();
      reply.header('content-type', 'image/webp');
      return reply.send(await storage.read(variant.storageKey));
    });

    scope.get(v1('/guest/links/:linkId/assets/:assetId/file'), async (req, reply) => {
      const { linkId, assetId } = AssetParams.parse(req.params);
      const ctx = await guests.requireGuest(req, reply, linkId);
      // Covers are thumbnails only: they never make an original reachable.
      if (!ctx.assets.shown.has(assetId)) throw new HttpError('not_found', 'Asset not found.');
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

    // The sound track of a storyboard animatic: played inline whatever `allowDownload` says,
    // never as an attachment nor with its name (decision 0046).
    scope.get(v1('/guest/links/:linkId/assets/:assetId/stream'), async (req, reply) => {
      const { linkId, assetId } = AssetParams.parse(req.params);
      const ctx = await guests.requireGuest(req, reply, linkId);
      if (!ctx.assets.audio.has(assetId)) throw new HttpError('not_found', 'Asset not found.');
      const row = await projectAsset(ctx, assetId);
      if (!streamable(ctx, row)) throw new HttpError('not_found', 'Asset not found.');
      guestFileHeaders(reply, row.sha256 ?? row.id);
      reply.header('cache-control', 'private, no-store');
      reply.header('content-type', row.mime.startsWith('audio/') ? row.mime : 'audio/mpeg');
      reply.header('content-disposition', 'inline');
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
        guests.takeWrite(ctx, reply);
        const change = await db.transaction(async (tx) => {
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
          return {
            previous: own?.status ?? 'none',
            requestedBy: rows.find((r) => r.shareLinkId === null)?.requestedBy ?? null,
          };
        });
        await afterGuestWrite({
          kind: 'review',
          projectId: ctx.link.projectId,
          ...change,
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
        guests.takeWrite(ctx, reply);
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
