import {
  API_PREFIX,
  GUEST_VERSIONS_LIMIT,
  type GuestAsset,
  type GuestElement,
  type GuestReviewSummary,
  type GuestVersions,
  Id,
  ThumbnailSize,
  VariantQuery,
  z,
} from '@inkadra/shared';
import { and, desc, eq, gte, inArray, max, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.ts';
import { boardVersion, elementReview, notification } from '../db/schema.ts';
import { notify, Recipients } from '../notifications.ts';
import { type DocViews, guestElement } from '../share-links.ts';
import { iso } from './api-routes.ts';
import { HttpError } from './errors.ts';
import { type GuestAuth, type GuestContext, guestPath } from './guest-context.ts';

/**
 * The phone review of a share link (decision 0074): the frames of named versions, to compare a
 * shot before and after, and the summary a guest sends the team once they went through it.
 */

const BoardParams = z.object({ linkId: Id, boardId: Id });
const VersionVariantParams = BoardParams.extend({
  versionId: Id,
  assetId: Id,
  size: ThumbnailSize,
});

interface Deps {
  db: Database;
  docs: DocViews;
  guests: GuestAuth;
  guestAssets: (ctx: GuestContext, ids: string[]) => Promise<GuestAsset[]>;
  sendVariant: (
    ctx: GuestContext,
    req: FastifyRequest,
    reply: FastifyReply,
    variant: { assetId: string; size: ThumbnailSize; animated?: string | undefined },
  ) => Promise<unknown>;
}

export function registerGuestReviewRoutes(app: FastifyInstance, deps: Deps) {
  const { db, docs, guests } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  /**
   * Frames of a named version that guests of the link see there and still see now; nothing
   * else of the version (other cards, hidden frames, fields outside the allow list) leaves it.
   */
  function versionFrames(
    ctx: GuestContext,
    boardId: string,
    version: { id: string; state: Uint8Array },
  ) {
    const now = new Set(
      (ctx.shown.get(boardId) ?? []).filter((el) => el.type === 'frame').map((el) => el.id),
    );
    const view = docs.versionView(version.id, version.state);
    return view.visible
      .filter((el) => el.type === 'frame' && now.has(el.id))
      .map((el) => guestElement(view, el) as GuestElement);
  }

  async function namedVersions(boardId: string, versionId?: string) {
    return db
      .select({
        id: boardVersion.id,
        name: boardVersion.name,
        createdAt: boardVersion.createdAt,
        state: boardVersion.state,
      })
      .from(boardVersion)
      .where(
        and(
          eq(boardVersion.boardId, boardId),
          eq(boardVersion.kind, 'named'),
          versionId ? eq(boardVersion.id, versionId) : undefined,
        ),
      )
      .orderBy(desc(boardVersion.createdAt), desc(boardVersion.id))
      .limit(GUEST_VERSIONS_LIMIT);
  }

  app.get(v1('/guest/links/:linkId/boards/:boardId/versions'), async (req, reply) => {
    const { linkId, boardId } = BoardParams.parse(req.params);
    const ctx = await guests.requireGuest(req, reply, linkId);
    guests.requireCan(ctx, 'review');
    guests.requireBoard(ctx, boardId);
    const rows = await namedVersions(boardId);
    const versions = rows.map((row) => ({
      id: row.id,
      name: row.name ?? '',
      createdAt: iso(row.createdAt),
      frames: versionFrames(ctx, boardId, row),
    }));
    // Pictures the snapshot already lists keep their own URLs; the others are served only as
    // thumbnails of the first version that shows them.
    const firstVersion = new Map<string, string>();
    for (const version of versions)
      for (const frame of version.frames) {
        const assetId = typeof frame.assetId === 'string' ? frame.assetId : null;
        if (assetId && !ctx.assets.shown.has(assetId) && !firstVersion.has(assetId))
          firstVersion.set(assetId, version.id);
      }
    const assets = (await deps.guestAssets(ctx, [...firstVersion.keys()])).map((a) => ({
      ...a,
      filename: null,
      size: null,
      downloadUrl: null,
      streamUrl: null,
      waveformUrl: null,
      variants: a.variants.map((v) => ({
        ...v,
        url: `${guestPath(linkId)}/boards/${boardId}/versions/${firstVersion.get(a.id)}/assets/${a.id}/variants/${v.size}`,
      })),
    }));
    reply.header('cache-control', 'private, no-cache');
    return { versions, assets } satisfies GuestVersions;
  });

  app.get(
    v1('/guest/links/:linkId/boards/:boardId/versions/:versionId/assets/:assetId/variants/:size'),
    async (req, reply) => {
      const { linkId, boardId, versionId, assetId, size } = VersionVariantParams.parse(req.params);
      const { animated } = VariantQuery.parse(req.query ?? {});
      const ctx = await guests.requireGuest(req, reply, linkId);
      guests.requireCan(ctx, 'review');
      guests.requireBoard(ctx, boardId);
      // Only a recent named version of this board, and only a picture of one of its frames
      // that the link shows: a version of another board, or an older one, is a 404.
      const [row] = (await namedVersions(boardId)).filter((v) => v.id === versionId);
      if (!row) throw new HttpError('not_found', 'Version not found.');
      const shown = versionFrames(ctx, boardId, row).some((frame) => frame.assetId === assetId);
      if (!shown) throw new HttpError('not_found', 'Asset not found.');
      return deps.sendVariant(ctx, req, reply, { assetId, size, animated });
    },
  );

  app.post(v1('/guest/links/:linkId/boards/:boardId/review-summary'), async (req, reply) => {
    const { linkId, boardId } = BoardParams.parse(req.params);
    const ctx = await guests.requireGuest(req, reply, linkId);
    guests.requireCan(ctx, 'review');
    guests.requireBoard(ctx, boardId);
    guests.requireName(ctx);
    guests.takeWrite(ctx, reply);
    const visible = (await guests.shown(ctx, boardId)).map((el) => el.id);
    const decisions =
      visible.length === 0
        ? []
        : await db
            .select({ status: elementReview.status, changedAt: elementReview.changedAt })
            .from(elementReview)
            .where(
              and(
                eq(elementReview.boardId, boardId),
                eq(elementReview.shareLinkId, linkId),
                inArray(elementReview.status, ['approved', 'changes_requested']),
                inArray(elementReview.elementId, visible),
              ),
            );
    const approved = decisions.filter((d) => d.status === 'approved').length;
    const changesRequested = decisions.length - approved;
    const latest = decisions.reduce<Date | null>(
      (at, d) => (!at || d.changedAt > at ? d.changedAt : at),
      null,
    );
    const creator = ctx.link.createdBy;
    let sent = false;
    if (latest && creator) {
      // One summary per state of the decisions: sending again without a change notifies nobody.
      // shortcut: compares the app clock (changedAt) with the database clock (createdAt); fine
      // while both run on synchronised hosts, else store the summarised state on a row.
      sent = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`review-summary:${linkId}:${boardId}`}))`,
        );
        const [already] = await tx
          .select({ at: max(notification.createdAt) })
          .from(notification)
          .where(
            and(
              eq(notification.type, 'review_submitted'),
              eq(notification.boardId, boardId),
              eq(notification.shareLinkId, linkId),
              gte(notification.createdAt, latest),
            ),
          );
        if (already?.at) return false;
        const count = await notify(
          tx as unknown as Database,
          {
            actor: { guestId: ctx.guest.id },
            projectId: ctx.link.projectId,
            boardId,
            shareLinkId: linkId,
          },
          new Recipients(null).add(creator, 'review_submitted'),
        );
        return count > 0;
      });
    }
    return { approved, changesRequested, sent } satisfies GuestReviewSummary;
  });
}
