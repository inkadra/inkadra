import { createReadStream } from 'node:fs';
import { stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { asset, assetVariant } from '../db/schema.ts';
import { proxyKey, readAll, type Storage } from '../storage.ts';
import { SOFTWARE_ENCODER, type VideoEncoder } from './hwaccel.ts';
import { ensureFreeSpace, privateInput, withJobDir } from './scratch.ts';
import {
  copiesVideo,
  DEFAULT_PROXY_SETTINGS,
  decodesOnGpu,
  makeProxy,
  mediaTools,
  type ProxySettings,
  ProxyTimeout,
  probeVideo,
  proxyMaxBytes,
  proxyPlan,
  proxyTimeoutMs,
  sniffVideo,
} from './video.ts';

export interface ProxyDeps {
  db: Database;
  storage: Storage;
  tmpDir: string;
  proxies?: ProxySettings;
  log?: { warn: (fields: Record<string, unknown>, message: string) => void };
}

/** How often progress is written to the row while ffmpeg runs. */
const PROGRESS_EVERY_MS = 2000;

const setProxy = (
  db: Database,
  assetId: string,
  fields: Pick<typeof asset.$inferInsert, 'proxyStatus' | 'proxyProgress'>,
) => db.update(asset).set(fields).where(eq(asset.id, assetId));

/**
 * Makes the playable H.264/AAC MP4 of a video (decision 0048) and stores it as the `proxy`
 * variant, at `variants/<assetId>/proxy.mp4`. Queued by `processAsset` once the poster is
 * there, so a long transcode never holds thumbnails back. Safe to run twice: a copy already
 * made is kept, since originals never change. `onProgress` gets the percent done.
 */
export async function runProxy(
  deps: ProxyDeps,
  assetId: string,
  onProgress?: (percent: number) => void | Promise<void>,
) {
  const { db, storage } = deps;
  const settings = deps.proxies ?? DEFAULT_PROXY_SETTINGS;
  const [row] = await db.select().from(asset).where(eq(asset.id, assetId));
  if (row?.kind !== 'video') {
    // An earlier attempt may have written the file just as the asset was deleted.
    if (!row) await storage.remove([proxyKey(assetId)]);
    return { skipped: 'gone' as const };
  }
  const [made] = await db
    .select({ size: assetVariant.size })
    .from(assetVariant)
    .where(and(eq(assetVariant.assetId, assetId), eq(assetVariant.size, 'proxy')));
  if (made) {
    await setProxy(db, assetId, { proxyStatus: 'ready', proxyProgress: 100 });
    return { skipped: 'made' as const };
  }
  const tools = await mediaTools();
  if (!settings.enabled || !tools.ffmpeg || !tools.ffprobe) {
    await setProxy(db, assetId, { proxyStatus: 'skipped', proxyProgress: null });
    return { skipped: 'off' as const };
  }

  const head = await readAll(await storage.read(row.storageKey, { start: 0, end: 255 }));
  const container = sniffVideo(head);
  if (!container) {
    await setProxy(db, assetId, { proxyStatus: null, proxyProgress: null });
    return { skipped: 'not-video' as const };
  }
  return withJobDir(deps.tmpDir, async (dir) => {
    // A bucket copies the source here first; the local volume reads it where it is.
    if (storage.copiesToLocal) await ensureFreeSpace(dir, row.size, 'the copy of the video');
    const copy = await storage.localCopy(row.storageKey, dir);
    try {
      const source = await privateInput(dir, copy.path);
      return await transcode(deps, row, container, source, dir, onProgress);
    } finally {
      await copy.done();
    }
  });
}

async function transcode(
  deps: ProxyDeps,
  row: typeof asset.$inferSelect,
  container: string,
  source: string,
  dir: string,
  onProgress?: (percent: number) => void | Promise<void>,
) {
  const { db, storage } = deps;
  const assetId = row.id;
  const settings = deps.proxies ?? DEFAULT_PROXY_SETTINGS;
  const { ffmpeg, ffprobe } = await mediaTools();
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg is not there any more');
  const out = join(dir, 'proxy.mp4');
  const info = await probeVideo(ffprobe, source, container);
  const plan = proxyPlan(container, info, row.size, settings);
  if (plan !== 'make') {
    await setProxy(db, assetId, {
      proxyStatus: plan === 'skip' ? 'skipped' : null,
      proxyProgress: null,
    });
    return { skipped: plan };
  }
  await ensureFreeSpace(dir, proxyMaxBytes(info, settings, row.size), 'the playable copy');
  await setProxy(db, assetId, { proxyStatus: 'processing', proxyProgress: 0 });
  let written = 0;
  let shown = 0;
  let writing: Promise<unknown> = Promise.resolve();
  const encoder = copiesVideo(info, settings) ? null : (settings.encoder ?? SOFTWARE_ENCODER);
  // A GPU that cannot take this file never fails the copy: when it decoded the source, it is
  // tried again decoding on the CPU (a codec or profile the card does not decode), then with
  // libx264 (an encoder that refuses it, a busy device). Not after a timeout, though.
  const retries: VideoEncoder[] =
    encoder && encoder.backend !== 'software'
      ? [
          ...(decodesOnGpu(encoder, info) ? [{ ...encoder, cpuDecode: true }] : []),
          SOFTWARE_ENCODER,
        ]
      : [];
  const used = await runAttempts({
    first: encoder,
    retries,
    totalMs: proxyTimeoutMs(info, settings),
    // The sweep of stale job folders goes by mtime: each attempt marks this one as alive.
    touch: async () => {
      const now = new Date();
      await utimes(dir, now, now);
    },
    onRetry: async (err, next) => {
      deps.log?.warn(
        { err, assetId, encoder: encoder?.backend },
        next.backend === 'software'
          ? 'hardware encoding failed: making the playable copy with libx264'
          : 'hardware decoding failed: decoding on the CPU, encoding on the GPU',
      );
      await writing;
      // The new attempt starts from 0 %: its progress is shown again.
      written = 0;
      shown = 0;
    },
    run: (attempt, timeoutMs) =>
      makeProxy(ffmpeg, source, out, info, settings, {
        timeoutMs,
        sourceBytes: row.size,
        container,
        ...(attempt ? { encoder: attempt } : {}),
        onProgress: (percent) => {
          // One write at a time, every few seconds: a fast copy must not flood the database.
          if (Date.now() - written < PROGRESS_EVERY_MS || percent <= shown) return;
          written = Date.now();
          shown = percent;
          writing = writing
            .then(() =>
              setProxy(db, assetId, { proxyStatus: 'processing', proxyProgress: percent }),
            )
            .then(() => onProgress?.(percent))
            .catch(() => {});
        },
      }),
  });
  await writing;

  const result = await probeVideo(ffprobe, out, 'video/mp4');
  const bytes = (await stat(out)).size;
  const key = proxyKey(assetId);
  await storage.writeStream(key, createReadStream(out), 'video/mp4');
  try {
    await saveProxy(db, row, info, result, key, bytes);
  } catch (err) {
    // Most likely the asset was deleted while ffmpeg ran: its file must not stay behind.
    await storage.remove([key]);
    const [still] = await db.select({ id: asset.id }).from(asset).where(eq(asset.id, assetId));
    if (!still) return { skipped: 'gone' as const };
    throw err;
  }
  await onProgress?.(100);
  return { bytes, encoder: used };
}

/**
 * Runs the copy with `first` (null: a remux), then with each of `retries` while the previous
 * attempt failed. All attempts share one deadline, `totalMs` from now: each gets the time
 * left, none starts past it, and a ProxyTimeout is never retried, so a hung GPU costs the
 * job at most `totalMs` (4 hours) in all. Returns what made the copy: `copy`, a backend,
 * `<backend>+cpu-decode` or `software`.
 */
export async function runAttempts(opts: {
  first: VideoEncoder | null;
  retries: VideoEncoder[];
  totalMs: number;
  touch: () => Promise<void>;
  onRetry: (err: unknown, next: VideoEncoder) => Promise<void>;
  run: (encoder: VideoEncoder | null, timeoutMs: number) => Promise<void>;
  now?: () => number;
}) {
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.totalMs;
  const attempts = [opts.first, ...opts.retries];
  for (let i = 0; i < attempts.length; i++) {
    const encoder = attempts[i] ?? null;
    const left = deadline - now();
    if (left <= 0)
      throw new ProxyTimeout(`ffmpeg ran past ${Math.round(opts.totalMs / 60_000)} minutes`);
    await opts.touch();
    try {
      await opts.run(i === 0 ? null : encoder, left);
      if (!encoder) return 'copy';
      if (i === 0 || encoder.backend === 'software') return encoder.backend;
      return `${encoder.backend}+cpu-decode`;
    } catch (err) {
      const next = attempts[i + 1];
      if (err instanceof ProxyTimeout || !next) throw err;
      await opts.onRetry(err, next);
    }
  }
  throw new Error('no attempt ran');
}

async function saveProxy(
  db: Database,
  row: typeof asset.$inferSelect,
  info: Awaited<ReturnType<typeof probeVideo>>,
  result: Awaited<ReturnType<typeof probeVideo>>,
  key: string,
  bytes: number,
) {
  const assetId = row.id;
  await db.transaction(async (tx) => {
    await tx
      .delete(assetVariant)
      .where(and(eq(assetVariant.assetId, assetId), eq(assetVariant.size, 'proxy')));
    await tx.insert(assetVariant).values({
      assetId,
      size: 'proxy',
      width: result.width ?? info.width ?? 0,
      height: result.height ?? info.height ?? 0,
      storageKey: key,
      mime: 'video/mp4',
      bytes,
    });
    await tx
      .update(asset)
      .set({ proxyStatus: 'ready', proxyProgress: 100 })
      .where(eq(asset.id, assetId));
  });
}

/** Called when the last attempt failed: the card falls back to the poster and Download. */
export async function markProxyFailed(db: Database, assetId: string) {
  await setProxy(db, assetId, { proxyStatus: 'failed', proxyProgress: null });
}
