import {
  API_PREFIX,
  type Asset,
  type AssetProxy,
  atLeast,
  CAPABILITY_ROLE,
  Id,
  VariantParams,
  VariantQuery,
  z,
} from '@inkadra/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAssetRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { type asset, assetVariant } from '../db/schema.ts';
import { animatedVariantKey, type Storage } from '../storage.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError, sendError } from './errors.ts';

interface Deps {
  db: Database;
  auth: Auth;
  storage: Storage;
}

const AssetParams = z.object({ assetId: Id });
const FileQuery = z.object({ download: z.enum(['1']).optional() });

const v1 = (path: string) => `${API_PREFIX}${path}`;
export const fileUrl = (assetId: string) => v1(`/assets/${assetId}/file`);
export const variantUrl = (assetId: string, size: string) =>
  v1(`/assets/${assetId}/variants/${size}`);
export const proxyUrl = (assetId: string) => v1(`/assets/${assetId}/proxy`);
export const waveformUrl = (assetId: string) => v1(`/assets/${assetId}/waveform`);

type VariantRow = typeof assetVariant.$inferSelect;
/**
 * A WebP thumbnail row, not the playable copy of a video or audio file (`proxy`, decision
 * 0048) nor the peaks of an audio file (`waveform`, #327).
 */
export type ThumbnailRow = VariantRow & {
  size: Exclude<VariantRow['size'], 'proxy' | 'waveform'>;
};
export const isThumbnail = (v: VariantRow): v is ThumbnailRow =>
  v.size !== 'proxy' && v.size !== 'waveform';

/** Where the playable copy of a video stands, for the API; null when there is none to make. */
export function toProxy(row: typeof asset.$inferSelect, variants: VariantRow[]): AssetProxy | null {
  if (!row.proxyStatus) return null;
  const made = row.proxyStatus === 'ready' ? variants.find((v) => v.size === 'proxy') : undefined;
  return {
    status: row.proxyStatus === 'ready' && !made ? 'failed' : row.proxyStatus,
    progress: row.proxyProgress,
    url: made ? proxyUrl(row.id) : null,
    mime: row.kind === 'audio' ? 'audio/mp4' : 'video/mp4',
    width: made?.width ?? null,
    height: made?.height ?? null,
    size: made?.bytes ?? null,
  };
}

/** Types shown in the page; anything else (HTML, SVG, scripts, documents) is downloaded. */
const INLINE =
  /^(image\/(jpeg|png|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/[a-z0-9.+-]+|application\/pdf)$/;

// Files never change after upload: cache them for good, but only in the viewer's browser.
const IMMUTABLE = 'private, max-age=31536000, immutable';

export function toAsset(row: typeof asset.$inferSelect, variants: VariantRow[]): Asset {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    mime: row.mime,
    filename: row.filename,
    size: row.size,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    videoCodec: row.videoCodec,
    audioCodec: row.audioCodec,
    frameRate: row.frameRate,
    pageCount: row.pageCount,
    proxy: toProxy(row, variants),
    waveformUrl:
      row.status === 'ready' && variants.some((v) => v.size === 'waveform')
        ? waveformUrl(row.id)
        : null,
    status: row.status,
    url: fileUrl(row.id),
    variants:
      row.status === 'ready'
        ? variants
            .filter(isThumbnail)
            .map((v) => ({
              size: v.size,
              width: v.width,
              height: v.height,
              url: variantUrl(row.id, v.size),
            }))
            .sort((a, b) => Number(a.size) - Number(b.size))
        : [],
    exif: row.exif ?? null,
    palette: row.palette ?? null,
    animated: row.animated,
    track: row.track ?? null,
    sourceUrl: row.sourceUrl,
    createdAt: iso(row.createdAt),
  };
}

/** Parses a single `bytes=` range; null means "send everything", undefined "unsatisfiable". */
export function parseRange(header: string | undefined, size: number) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // ignore what we do not understand
  let start: number;
  let end: number;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return undefined;
  return { start, end };
}

export function contentDisposition(kind: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function fileHeaders(reply: FastifyReply, etag: string) {
  reply.header('cache-control', IMMUTABLE);
  reply.header('etag', `"${etag}"`);
  // Even an image cannot run anything if a browser is tricked into rendering it as a page.
  reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  reply.header('cross-origin-resource-policy', 'same-origin');
}

/** Sends a stored file, or the single byte range asked for. */
export async function sendRanged(
  req: FastifyRequest,
  reply: FastifyReply,
  storage: Storage,
  key: string,
  size: number,
) {
  reply.header('accept-ranges', 'bytes');
  const range = parseRange(req.headers.range, size);
  if (range === undefined) {
    reply.header('content-range', `bytes */${size}`);
    return reply.status(416).send();
  }
  if (range) {
    reply.status(206);
    reply.header('content-range', `bytes ${range.start}-${range.end}/${size}`);
    reply.header('content-length', range.end - range.start + 1);
    return reply.send(await storage.read(key, range));
  }
  reply.header('content-length', size);
  return reply.send(await storage.read(key));
}

export function registerAssetRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth, storage } = deps;

  app.get(v1('/assets/:assetId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { assetId } = AssetParams.parse(req.params);
    const { asset: row } = await requireAssetRole(db, actor, assetId, 'viewer');
    const variants = await db
      .select()
      .from(assetVariant)
      .where(eq(assetVariant.assetId, assetId))
      .orderBy(asc(assetVariant.width));
    return toAsset(row, variants);
  });

  app.get(v1('/assets/:assetId/file'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { assetId } = AssetParams.parse(req.params);
    const { download } = FileQuery.parse(req.query ?? {});
    const { asset: row, role } = await requireAssetRole(db, actor, assetId, 'viewer');
    if (row.status === 'pending') throw new HttpError('not_found', 'The upload is not finished.');
    // Viewers do not download originals (decision 0011): images have thumbnails to look at;
    // video, audio and PDF stream because there is nothing else to show.
    if (!atLeast(role, CAPABILITY_ROLE.download)) {
      if (download) throw new HttpError('forbidden', 'Viewers cannot download originals.');
      if (row.kind === 'image') {
        const [variant] = await db
          .select({ size: assetVariant.size })
          .from(assetVariant)
          .where(eq(assetVariant.assetId, assetId))
          .limit(1);
        if (variant) throw new HttpError('forbidden', 'Viewers see images through thumbnails.');
      }
    }
    const etag = row.sha256 ?? row.id;
    fileHeaders(reply, etag);
    if (req.headers['if-none-match'] === `"${etag}"`) return reply.status(304).send();

    const inline = !download && INLINE.test(row.mime);
    reply.header('content-type', inline ? row.mime : 'application/octet-stream');
    reply.header(
      'content-disposition',
      contentDisposition(inline ? 'inline' : 'attachment', row.filename),
    );
    return sendRanged(req, reply, storage, row.storageKey, row.size);
  });

  app.get(v1('/assets/:assetId/proxy'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { assetId } = AssetParams.parse(req.params);
    const { asset: row } = await requireAssetRole(db, actor, assetId, 'viewer');
    // Like the stream of an original video, every role that sees the card may play it.
    const [made] = await db
      .select()
      .from(assetVariant)
      .where(and(eq(assetVariant.assetId, assetId), eq(assetVariant.size, 'proxy')));
    if (!made || row.proxyStatus !== 'ready')
      return sendError(reply, 'not_found', 'This file has no playable copy.');
    const etag = `${row.sha256 ?? row.id}-proxy`;
    fileHeaders(reply, etag);
    if (req.headers['if-none-match'] === `"${etag}"`) return reply.status(304).send();
    const audio = made.mime === 'audio/mp4';
    reply.header('content-type', audio ? 'audio/mp4' : 'video/mp4');
    const name = `${row.filename.replace(/\.[^.]*$/, '') || 'video'}.${audio ? 'm4a' : 'mp4'}`;
    reply.header('content-disposition', contentDisposition('inline', name));
    const size = made.bytes ?? (await storage.size(made.storageKey)) ?? 0;
    return sendRanged(req, reply, storage, made.storageKey, size);
  });

  // The peaks of an audio file (#327), for every role that sees its card.
  app.get(v1('/assets/:assetId/waveform'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { assetId } = AssetParams.parse(req.params);
    await requireAssetRole(db, actor, assetId, 'viewer');
    return sendWaveform(db, storage, req, reply, assetId, fileHeaders);
  });

  app.get(v1('/assets/:assetId/variants/:size'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { assetId, size } = VariantParams.parse(req.params);
    const { animated } = VariantQuery.parse(req.query ?? {});
    await requireAssetRole(db, actor, assetId, 'viewer');
    if (animated) {
      // Moving thumbnails have keys of their own: no row says whether one exists.
      const key = animatedVariantKey(assetId, size);
      if ((await storage.size(key)) === null)
        return sendError(reply, 'not_found', 'This picture does not move.');
      const etag = `${assetId}-${size}-animated`;
      fileHeaders(reply, etag);
      if (req.headers['if-none-match'] === `"${etag}"`) return reply.status(304).send();
      reply.header('content-type', 'image/webp');
      return reply.send(await storage.read(key));
    }
    const [variant] = await db
      .select()
      .from(assetVariant)
      .where(eq(assetVariant.assetId, assetId))
      .then((rows) => rows.filter((r) => r.size === size));
    if (!variant) return sendError(reply, 'not_found', 'No such variant.');
    const etag = `${assetId}-${size}`;
    fileHeaders(reply, etag);
    if (req.headers['if-none-match'] === `"${etag}"`) return reply.status(304).send();
    reply.header('content-type', 'image/webp');
    return reply.send(await storage.read(variant.storageKey));
  });
}

/** Sends the `waveform` variant of an asset as JSON, or 404 when it has none. */
export async function sendWaveform(
  db: Database,
  storage: Storage,
  req: FastifyRequest,
  reply: FastifyReply,
  assetId: string,
  headers: (reply: FastifyReply, etag: string) => void,
) {
  const [made] = await db
    .select()
    .from(assetVariant)
    .where(and(eq(assetVariant.assetId, assetId), eq(assetVariant.size, 'waveform')));
  if (!made) return sendError(reply, 'not_found', 'This file has no waveform.');
  const etag = `${assetId}-waveform-${made.bytes ?? 0}`;
  headers(reply, etag);
  if (req.headers['if-none-match'] === `"${etag}"`) return reply.status(304).send();
  reply.header('content-type', 'application/json; charset=utf-8');
  return reply.send(await storage.read(made.storageKey));
}
