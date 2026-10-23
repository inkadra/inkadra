import { API_PREFIX, type Asset, Id, VariantParams, z } from '@inkadra/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAssetRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { type asset, assetVariant } from '../db/schema.ts';
import type { Storage } from '../storage.ts';
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

/** Types shown in the page; anything else (HTML, SVG, scripts, documents) is downloaded. */
const INLINE =
  /^(image\/(jpeg|png|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/[a-z0-9.+-]+|application\/pdf)$/;

// Files never change after upload: cache them for good, but only in the viewer's browser.
const IMMUTABLE = 'private, max-age=31536000, immutable';

export function toAsset(
  row: typeof asset.$inferSelect,
  variants: Array<typeof assetVariant.$inferSelect>,
): Asset {
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
    status: row.status,
    url: fileUrl(row.id),
    variants:
      row.status === 'ready'
        ? variants
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

function contentDisposition(kind: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function fileHeaders(reply: FastifyReply, etag: string) {
  reply.header('cache-control', IMMUTABLE);
  reply.header('etag', `"${etag}"`);
  // Even an image cannot run anything if a browser is tricked into rendering it as a page.
  reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  reply.header('cross-origin-resource-policy', 'same-origin');
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
    if (role === 'viewer') {
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

  app.get(v1('/assets/:assetId/variants/:size'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { assetId, size } = VariantParams.parse(req.params);
    await requireAssetRole(db, actor, assetId, 'viewer');
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
