import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { asset, assetVariant } from '../db/schema.ts';
import { proxyKey, readAll, type Storage } from '../storage.ts';
import { gpuDecodes, SOFTWARE_ENCODER, type VideoEncoder } from './hwaccel.ts';
import { ensureFreeSpace, privateInput, withJobDir } from './scratch.ts';
import {
  copiesVideo,
  DEFAULT_PROXY_SETTINGS,
  makeProxy,
  mediaTools,
  type ProxySettings,
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
  const info = await probeVideo(ffprobe, source);
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
  const run = (override?: VideoEncoder) =>
    makeProxy(ffmpeg, source, out, info, settings, {
      timeoutMs: proxyTimeoutMs(info, settings),
      sourceBytes: row.size,
      ...(override ? { encoder: override } : {}),
      onProgress: (percent) => {
        // One write at a time, every few seconds: a fast copy must not flood the database.
        if (Date.now() - written < PROGRESS_EVERY_MS || percent <= shown) return;
        written = Date.now();
        shown = percent;
        writing = writing
          .then(() => setProxy(db, assetId, { proxyStatus: 'processing', proxyProgress: percent }))
          .then(() => onProgress?.(percent))
          .catch(() => {});
      },
    });
  // What made the picture: `copy` (a remux), a hardware backend, or `software`.
  let used: string = encoder?.backend ?? 'copy';
  // A GPU that cannot take this file never fails the copy: when it decoded the source, it is
  // tried again decoding on the CPU (a codec or profile the card does not decode), then with
  // libx264 (an encoder that refuses it, a busy device), under the same limits each time.
  const retries: VideoEncoder[] =
    encoder && encoder.backend !== 'software'
      ? [
          ...(gpuDecodes(info.videoCodec, info.pixelFormat)
            ? [{ ...encoder, cpuDecode: true }]
            : []),
          SOFTWARE_ENCODER,
        ]
      : [];
  for (let attempt = 0; ; attempt++) {
    try {
      await run(attempt === 0 ? undefined : retries[attempt - 1]);
      break;
    } catch (err) {
      const next = retries[attempt];
      if (!next) throw err;
      deps.log?.warn(
        { err, assetId, encoder: encoder?.backend },
        next.backend === 'software'
          ? 'hardware encoding failed: making the playable copy with libx264'
          : 'hardware decoding failed: decoding on the CPU, encoding on the GPU',
      );
      await writing;
      used = next.backend === 'software' ? 'software' : `${next.backend}+cpu-decode`;
    }
  }
  await writing;

  const result = await probeVideo(ffprobe, out);
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
