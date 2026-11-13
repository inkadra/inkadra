import { createHash } from 'node:crypto';
import { type AssetPlayback, VIDEO_RUNGS, type VideoRung } from '@inkadra/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.ts';
import { type asset, assetRendition } from '../db/schema.ts';
import { generationOf } from '../media/ladder.ts';
import type { Storage } from '../storage.ts';

export type RenditionRow = typeof assetRendition.$inferSelect;

/** The rungs of these assets, smallest first. */
export const renditionsOf = (db: Pick<Database, 'select'>, assetIds: string[]) =>
  assetIds.length === 0
    ? Promise.resolve([] as RenditionRow[])
    : db
        .select()
        .from(assetRendition)
        .where(inArray(assetRendition.assetId, assetIds))
        .orderBy(asc(assetRendition.assetId));

/** The stored files of the rungs of these assets, to delete once their rows are gone. */
export async function renditionFiles(tx: Pick<Database, 'select'>, assetIds: string[]) {
  if (assetIds.length === 0) return [];
  const rows = await tx
    .select({ key: assetRendition.storageKey })
    .from(assetRendition)
    .where(inArray(assetRendition.assetId, assetIds));
  return rows.flatMap((r) => (r.key ? [r.key] : []));
}

const order = (a: RenditionRow, b: RenditionRow) =>
  VIDEO_RUNGS.indexOf(a.name) - VIDEO_RUNGS.indexOf(b.name);

const isReady = (r: RenditionRow) =>
  r.status === 'ready' && Boolean(r.storageKey) && Boolean(r.playlist);

/** A short tag of the ready files: the master playlist changes address when they change. */
const version = (rows: RenditionRow[]) =>
  createHash('sha256')
    .update(
      rows
        .filter(isReady)
        .map((r) => r.storageKey)
        .join(','),
    )
    .digest('base64url')
    .slice(0, 8);

/**
 * `Asset.playback` of a video from its rungs (decision 0128), with URLs under `base`
 * (`/api/v1/assets/{id}/hls`, or the guest path); null when it has none.
 */
export function toPlayback(
  rows: RenditionRow[],
  base: string,
  original: boolean,
): AssetPlayback | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort(order);
  const ready = sorted.some(isReady);
  return {
    hls: ready ? `${base}/master.m3u8?v=${version(sorted)}` : null,
    original,
    renditions: sorted.map((r) => ({
      name: r.name,
      status: r.status === 'ready' && !isReady(r) ? 'failed' : r.status,
      progress: r.status === 'ready' ? 100 : r.progress,
      width: r.width,
      height: r.height,
      bitrate: r.bitrate,
      size: r.bytes,
      url: isReady(r) ? `${base}/${r.name}.mp4?v=${generationOf(r.storageKey)}` : null,
    })),
  };
}

/** The HLS master playlist of the ready rungs, with relative URIs. */
export function masterPlaylist(rows: RenditionRow[]) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const r of [...rows].sort(order).filter(isReady)) {
    const attributes = [
      `BANDWIDTH=${Math.max(1, r.peakBitrate ?? r.bitrate ?? 1)}`,
      ...(r.bitrate ? [`AVERAGE-BANDWIDTH=${r.bitrate}`] : []),
      ...(r.width && r.height ? [`RESOLUTION=${r.width}x${r.height}`] : []),
      ...(r.frameRate ? [`FRAME-RATE=${r.frameRate.toFixed(3)}`] : []),
      ...(r.codecs ? [`CODECS="${r.codecs}"`] : []),
    ];
    lines.push(`#EXT-X-STREAM-INF:${attributes.join(',')}`, `${r.name}.m3u8`);
  }
  return `${lines.join('\n')}\n`;
}

/** The ready rung `Asset.proxy` plays: the largest up to 1080, else the smallest. */
export function proxyRendition(rows: RenditionRow[]) {
  const ready = [...rows].sort(order).filter(isReady);
  return ready.filter((r) => Number(r.name) <= 1080).at(-1) ?? ready[0] ?? null;
}

const FILE = /^(master|480|720|1080|2160)\.(m3u8|mp4)$/;

/** Parses `master.m3u8`, `{rung}.m3u8` or `{rung}.mp4`; null for anything else. */
export function hlsFile(name: string) {
  const m = FILE.exec(name);
  if (!m) return null;
  if (m[1] === 'master') return m[2] === 'm3u8' ? { kind: 'master' as const } : null;
  return {
    kind: m[2] === 'mp4' ? ('file' as const) : ('playlist' as const),
    rung: m[1] as VideoRung,
  };
}

/**
 * Answers one HLS request of a video whose access the caller checked: the master playlist
 * generated from the ready rungs, a rung's playlist from its row, or its file with `Range`.
 * Playlists change as rungs get ready (`no-cache`); files never change at their address.
 */
export async function sendHls(
  req: FastifyRequest,
  reply: FastifyReply,
  db: Pick<Database, 'select'>,
  storage: Storage,
  row: typeof asset.$inferSelect,
  file: string,
  send: {
    notFound: (reply: FastifyReply) => unknown;
    ranged: (key: string, size: number) => unknown;
    fileHeaders: (reply: FastifyReply, etag: string) => void;
  },
) {
  const parsed = hlsFile(file);
  if (!parsed) return send.notFound(reply);
  const rows = await db.select().from(assetRendition).where(eq(assetRendition.assetId, row.id));
  if (parsed.kind === 'master') {
    if (!rows.some(isReady)) return send.notFound(reply);
    reply.header('cache-control', 'private, no-cache');
    reply.header('content-type', 'application/vnd.apple.mpegurl');
    return reply.send(masterPlaylist(rows));
  }
  const rung = rows.find((r) => r.name === parsed.rung && isReady(r));
  if (!rung?.storageKey || !rung.playlist) return send.notFound(reply);
  if (parsed.kind === 'playlist') {
    reply.header('cache-control', 'private, no-cache');
    reply.header('content-type', 'application/vnd.apple.mpegurl');
    return reply.send(rung.playlist);
  }
  const etag = `${row.id}-${generationOf(rung.storageKey)}-${rung.name}`;
  send.fileHeaders(reply, etag);
  if (req.headers['if-none-match'] === `"${etag}"`) return reply.status(304).send();
  reply.header('content-type', 'video/mp4');
  const size = rung.bytes ?? (await storage.size(rung.storageKey)) ?? 0;
  return send.ranged(rung.storageKey, size);
}
