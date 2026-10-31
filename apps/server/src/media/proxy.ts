import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { asset, assetVariant } from '../db/schema.ts';
import { proxyKey, readAll, type Storage } from '../storage.ts';
import {
  DEFAULT_PROXY_SETTINGS,
  makeProxy,
  mediaTools,
  type ProxySettings,
  probeVideo,
  proxyPlan,
  proxyTimeoutMs,
  sniffVideo,
} from './video.ts';

export interface ProxyDeps {
  db: Database;
  storage: Storage;
  tmpDir: string;
  proxies?: ProxySettings;
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
  if (row?.kind !== 'video') return { skipped: 'gone' as const };
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
  await mkdir(deps.tmpDir, { recursive: true });
  const copy = await storage.localCopy(row.storageKey, join(deps.tmpDir, `${assetId}.proxy-src`));
  const out = join(deps.tmpDir, `${assetId}.proxy.mp4`);
  try {
    const info = await probeVideo(tools.ffprobe, copy.path);
    const plan = proxyPlan(container, info, row.size, settings);
    if (plan !== 'make') {
      await setProxy(db, assetId, {
        proxyStatus: plan === 'skip' ? 'skipped' : null,
        proxyProgress: null,
      });
      return { skipped: plan };
    }
    await setProxy(db, assetId, { proxyStatus: 'processing', proxyProgress: 0 });
    let written = 0;
    let shown = 0;
    let writing: Promise<unknown> = Promise.resolve();
    await makeProxy(tools.ffmpeg, copy.path, out, info, settings, {
      timeoutMs: proxyTimeoutMs(info),
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
    await writing;

    const result = await probeVideo(tools.ffprobe, out);
    const bytes = (await stat(out)).size;
    const key = proxyKey(assetId);
    await storage.writeStream(key, createReadStream(out), 'video/mp4');
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
    await onProgress?.(100);
    return { bytes };
  } finally {
    await copy.done();
    await rm(out, { force: true });
  }
}

/** Called when the last attempt failed: the card falls back to the poster and Download. */
export async function markProxyFailed(db: Database, assetId: string) {
  await setProxy(db, assetId, { proxyStatus: 'failed', proxyProgress: null });
}
