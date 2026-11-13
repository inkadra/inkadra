import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  type AssetPlayback,
  VIDEO_RUNGS,
  type VideoRung,
  type VideoSettings,
} from '@inkadra/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.ts';
import { type asset, assetRendition } from '../db/schema.ts';
import { generationOf } from '../media/ladder.ts';
import type { VideoEncoder } from '../media/hwaccel.ts';
import {
  type LiveLimits,
  type LiveSessions,
  type LiveViewer,
  livePlaylist,
  liveRungs,
  liveVariant,
} from '../media/live.ts';
import type { ProxySettings } from '../media/video.ts';
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
  /** Rungs offered live (decision 0128): playable at once, before or instead of a file. */
  live: VideoRung[] = [],
): AssetPlayback | null {
  if (rows.length === 0 && live.length === 0) return null;
  const sorted = [...rows].sort(order);
  const ready = sorted.some(isReady);
  // A rung offered only live has no row: it is listed as waiting, with `live`.
  const extra = live
    .filter((name) => !sorted.some((r) => r.name === name))
    .map((name) => ({
      name,
      status: 'queued' as const,
      progress: null,
      width: null,
      height: null,
      bitrate: null,
      size: null,
      url: null,
      live: true,
    }));
  return {
    hls:
      ready || live.length > 0
        ? `${base}/master.m3u8?v=${version(sorted)}${live.length ? '-l' : ''}`
        : null,
    original,
    renditions: [
      ...sorted.map((r) => ({
      name: r.name,
      status: r.status === 'ready' && !isReady(r) ? 'failed' : r.status,
      progress: r.status === 'ready' ? 100 : r.progress,
      width: r.width,
      height: r.height,
      bitrate: r.bitrate,
      size: r.bytes,
      url: isReady(r) ? `${base}/${r.name}.mp4?v=${generationOf(r.storageKey)}` : null,
        ...(live.includes(r.name) ? { live: true } : {}),
      })),
      ...extra,
    ].sort((a, b) => VIDEO_RUNGS.indexOf(a.name) - VIDEO_RUNGS.indexOf(b.name)),
  };
}

type LiveEntry = ReturnType<typeof liveVariant>;

/**
 * The HLS master playlist of the ready rungs and of those offered live, smallest first, with
 * relative URIs. Live rungs keep the same two-second keyframes, so hls.js switches between them.
 */
export function masterPlaylist(rows: RenditionRow[], live: LiveEntry[] = []) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  const stored = [...rows].sort(order).filter(isReady);
  const entries = [
    ...stored.map((r) => ({ kind: 'stored' as const, r, at: VIDEO_RUNGS.indexOf(r.name) })),
    ...live.map((l) => ({ kind: 'live' as const, l, at: VIDEO_RUNGS.indexOf(l.name) })),
  ].sort((a, b) => a.at - b.at);
  for (const entry of entries) {
    if (entry.kind === 'live') {
      const l = entry.l;
      const rate = l.frameRate ? `,FRAME-RATE=${l.frameRate.toFixed(3)}` : '';
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${l.bandwidth},AVERAGE-BANDWIDTH=${l.average},RESOLUTION=${l.width}x${l.height}${rate},CODECS="${l.codecs}"`,
        `live/${l.name}.m3u8`,
      );
      continue;
    }
    const r = entry.r;
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
const LIVE = /^live\/(480|720|1080|2160)(?:\.m3u8|\/(init\.mp4|seg-(\d{1,6})\.m4s))$/;

/**
 * Parses `master.m3u8`, `{rung}.m3u8`, `{rung}.mp4`, and the live files `live/{rung}.m3u8`,
 * `live/{rung}/init.mp4`, `live/{rung}/seg-{n}.m4s`; null for anything else.
 */
export function hlsFile(name: string) {
  const live = LIVE.exec(name);
  if (live) {
    const rung = live[1] as VideoRung;
    if (!live[2]) return { kind: 'live-playlist' as const, rung };
    return {
      kind: 'live-file' as const,
      rung,
      file: live[3] === undefined ? ('init' as const) : Number(live[3]),
    };
  }
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
  /** Live playback of this server and who asks (decision 0128); absent: stored rungs only. */
  live?: { context: LiveContext; who: LiveViewer },
) {
  const parsed = hlsFile(file);
  if (!parsed) return send.notFound(reply);
  const rows = await db.select().from(assetRendition).where(eq(assetRendition.assetId, row.id));
  const offered = live ? await offeredLive(live.context, row, rows) : null;
  if (parsed.kind === 'master') {
    // Live rungs only within the limits: past them the viewer gets the stored rungs.
    const liveNames =
      live && offered && offered.names.length > 0 &&
      live.context.sessions.reserve(live.who, row.id, offered.limits)
        ? offered.names
        : [];
    if (!rows.some(isReady) && liveNames.length === 0) {
      reply.header('retry-after', '5');
      return send.notFound(reply);
    }
    reply.header('cache-control', 'private, no-cache');
    reply.header('content-type', 'application/vnd.apple.mpegurl');
    const proxies = live?.context.proxies;
    return reply.send(
      masterPlaylist(rows, proxies ? liveNames.map((name) => liveVariant(row, name, proxies)) : []),
    );
  }
  if (parsed.kind === 'live-playlist' || parsed.kind === 'live-file') {
    if (!live || !offered?.names.includes(parsed.rung) || !row.durationMs)
      return send.notFound(reply);
    reply.header('cache-control', 'private, no-store');
    if (parsed.kind === 'live-playlist') {
      reply.header('content-type', 'application/vnd.apple.mpegurl');
      return reply.send(livePlaylist(row.durationMs, parsed.rung));
    }
    const path = await live.context.sessions.file(
      live.who,
      row,
      parsed.rung,
      parsed.file,
      offered.limits,
    );
    if (!path) {
      // Past the limits or not made in time: the player retries, then keeps to stored rungs.
      reply.header('retry-after', '2');
      return reply.status(503).send({ code: 'unavailable', message: 'Not ready yet.' });
    }
    reply.header('content-type', parsed.file === 'init' ? 'video/mp4' : 'video/iso.segment');
    return reply.send(createReadStream(path));
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

/** What a server needs to offer live rungs (decision 0128). */
export interface LiveContext {
  sessions: LiveSessions;
  encoder?: VideoEncoder;
  proxies: ProxySettings;
  /** The settings of the Video page, read through a short cache. */
  settings: () => Promise<VideoSettings>;
}

/** The live rungs of a video and the limits that apply. */
export async function offeredLive(
  context: LiveContext,
  row: typeof asset.$inferSelect,
  rows: RenditionRow[],
) {
  const settings = await context.settings();
  const ready = rows.filter(isReady).map((r) => r.name);
  const names = liveRungs(row, ready, settings, context.encoder);
  const limits: LiveLimits = {
    maxSessions: settings.live.maxSessions,
    perViewer: settings.live.perViewer,
  };
  return { names, limits };
}
