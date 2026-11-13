import { createReadStream } from 'node:fs';
import { stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import type { VideoRung } from '@inkadra/shared';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { asset, assetRendition } from '../db/schema.ts';
import { SOFTWARE_ENCODER, type VideoEncoder } from './hwaccel.ts';
import {
  generationOf,
  ladderArgs,
  ladderMemory,
  newGeneration,
  recipeOf,
  renditionCodecs,
  renditionKey,
  rungMaxBytes,
  rungSide,
  type VideoPlan,
} from './ladder.ts';
import { PROGRESS_EVERY_MS, type ProxyDeps, runAttempts, setProxy } from './proxy.ts';
import { ensureFreeSpace } from './scratch.ts';
import { mediaPlaylist, readFragmentIndex } from './sidx.ts';
import {
  DEFAULT_PROXY_SETTINGS,
  decodesOnGpu,
  mediaTools,
  PROXY_MAX_RUN_MS,
  probeVideo,
  runEncode,
  shortCopy,
  type VideoInfo,
} from './video.ts';

type AssetRow = typeof asset.$inferSelect;

const setRendition = (
  db: Database,
  assetId: string,
  name: VideoRung,
  fields: Partial<typeof assetRendition.$inferInsert>,
) =>
  db
    .update(assetRendition)
    .set(fields)
    .where(and(eq(assetRendition.assetId, assetId), eq(assetRendition.name, name)));

/**
 * Makes the rungs of the H.264 ladder of a video that are missing or were made with other
 * settings (decision 0128), smallest first: the smallest alone, so the card plays early, then
 * the others in one run that decodes the source once. A rung already made with the current
 * recipe is kept: the job can run twice. A rung made otherwise keeps playing until the new
 * file replaces it. A run that fails marks its rungs failed and the next run still goes; the
 * job fails only when no rung is ready.
 */
export async function makeLadder(
  deps: ProxyDeps,
  row: AssetRow,
  container: string,
  source: string,
  dir: string,
  info: VideoInfo,
  plan: Extract<VideoPlan, { kind: 'ladder' }>,
  onProgress?: (percent: number) => void | Promise<void>,
  opts: { regenerate?: boolean } = {},
) {
  const { db, storage } = deps;
  const settings = deps.proxies ?? DEFAULT_PROXY_SETTINGS;
  const { ffmpeg, ffprobe } = await mediaTools();
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg is not there any more');
  const assetId = row.id;
  const recipe = recipeOf(settings);
  const rows = await db.select().from(assetRendition).where(eq(assetRendition.assetId, assetId));
  const current = (name: VideoRung) =>
    rows.find((r) => r.name === name && r.status === 'ready' && r.recipe === recipe);
  const todo = plan.rungs.filter((name) => !current(name));
  // A regeneration also takes away the rungs no longer chosen, row then file.
  if (opts.regenerate) {
    const dropped = rows.filter((r) => !plan.rungs.includes(r.name));
    for (const r of dropped) {
      await db
        .delete(assetRendition)
        .where(and(eq(assetRendition.assetId, assetId), eq(assetRendition.name, r.name)));
      if (r.storageKey) await storage.remove([r.storageKey]);
    }
  }
  // The original plays: the old copy status stays null, the rungs are read from Asset.playback.
  const aggregate = !plan.original;
  if (todo.length === 0) {
    if (aggregate) await setProxy(db, assetId, { proxyStatus: 'ready', proxyProgress: 100 });
    return { skipped: 'made' as const };
  }
  for (const name of todo) {
    const old = rows.find((r) => r.name === name);
    // A rung that plays keeps playing (and its row stays ready) until its new file is in.
    if (old?.status === 'ready') continue;
    await db
      .insert(assetRendition)
      .values({ assetId, name, status: 'queued', progress: null, recipe })
      .onConflictDoUpdate({
        target: [assetRendition.assetId, assetRendition.name],
        set: { status: 'queued', progress: null, recipe },
      });
  }
  if (aggregate) await setProxy(db, assetId, { proxyStatus: 'processing', proxyProgress: 0 });

  // Progress of the whole ladder, weighted by the pixels of each rung.
  const weight = (name: VideoRung) => rungSide(info, settings, name) ** 2;
  const total = todo.reduce((sum, name) => sum + weight(name), 0);
  let doneWeight = 0;
  let writing: Promise<unknown> = Promise.resolve();
  let written = 0;
  let shown = -1;
  const report = (runRungs: VideoRung[], percent: number) => {
    const runWeight = runRungs.reduce((sum, name) => sum + weight(name), 0);
    const overall = Math.min(
      99,
      Math.floor(((doneWeight + (runWeight * percent) / 100) / total) * 100),
    );
    if (Date.now() - written < PROGRESS_EVERY_MS || overall <= shown) return;
    written = Date.now();
    shown = overall;
    writing = writing
      .then(async () => {
        for (const name of runRungs)
          if (!current(name) && rows.find((r) => r.name === name)?.status !== 'ready')
            await setRendition(db, assetId, name, { status: 'processing', progress: percent });
        if (aggregate)
          await setProxy(db, assetId, { proxyStatus: 'processing', proxyProgress: overall });
        await onProgress?.(overall);
      })
      .catch(() => {});
  };

  const runs = [todo.slice(0, 1), todo.slice(1)].filter((r) => r.length > 0);
  let lastError: unknown = null;
  let made = 0;
  const used: string[] = [];
  for (const runRungs of runs) {
    try {
      const run = await encodeRun(deps, row, container, source, dir, info, runRungs, (p) =>
        report(runRungs, p),
      );
      await writing;
      used.push(run.encoder);
      const generation = newGeneration();
      for (const name of runRungs) {
        await storeRung(db, storage, row, info, name, join(dir, `${name}.mp4`), {
          generation,
          recipe,
          encoder: run.encoder,
          // One run makes all its rungs: each is charged its share of the time.
          encodeMs: Math.round(run.ms / runRungs.length),
          previous: rows.find((r) => r.name === name)?.storageKey ?? null,
          ffprobe,
        });
        made += 1;
      }
    } catch (err) {
      await writing;
      lastError = err;
      deps.log?.warn({ err, assetId, rungs: runRungs }, 'a run of the video ladder failed');
      for (const name of runRungs)
        if (rows.find((r) => r.name === name)?.status !== 'ready')
          await setRendition(db, assetId, name, { status: 'failed', progress: null });
    }
    doneWeight += runRungs.reduce((sum, name) => sum + weight(name), 0);
  }
  const [still] = await db.select({ id: asset.id }).from(asset).where(eq(asset.id, assetId));
  if (!still) return { skipped: 'gone' as const };
  const ready = await db
    .select({ name: assetRendition.name })
    .from(assetRendition)
    .where(and(eq(assetRendition.assetId, assetId), eq(assetRendition.status, 'ready')));
  if (ready.length === 0) throw lastError ?? new Error('no rung of the ladder was made');
  if (aggregate) await setProxy(db, assetId, { proxyStatus: 'ready', proxyProgress: 100 });
  await onProgress?.(100);
  return { rungs: made, encoder: used.join(',') };
}

/**
 * Encodes `rungs` in one ffmpeg run, through the fallback chain of single copies (GPU, then the
 * GPU with CPU decoding, then libx264), and checks every file is as long as the source.
 */
async function encodeRun(
  deps: ProxyDeps,
  row: AssetRow,
  container: string,
  source: string,
  dir: string,
  info: VideoInfo,
  rungs: VideoRung[],
  onPercent: (percent: number) => void,
) {
  const settings = deps.proxies ?? DEFAULT_PROXY_SETTINGS;
  const { ffmpeg, ffprobe } = await mediaTools();
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg is not there any more');
  const outputs = rungs.map((rung) => ({ rung, path: join(dir, `${rung}.mp4`) }));
  const largest = Math.max(...rungs.map((r) => rungMaxBytes(info, settings, r)));
  await ensureFreeSpace(
    dir,
    rungs.reduce((sum, r) => sum + rungMaxBytes(info, settings, r), 0),
    'the playable copies',
  );
  const encoder = settings.encoder ?? SOFTWARE_ENCODER;
  const retries: VideoEncoder[] =
    encoder.backend !== 'software'
      ? [
          ...(decodesOnGpu(encoder, info) ? [{ ...encoder, cpuDecode: true }] : []),
          SOFTWARE_ENCODER,
        ]
      : [];
  const started = Date.now();
  const used = await runAttempts({
    first: encoder,
    retries,
    totalMs: PROXY_MAX_RUN_MS,
    touch: async () => {
      const now = new Date();
      await utimes(dir, now, now);
    },
    onRetry: async (err, next) => {
      deps.log?.warn(
        { err, assetId: row.id, encoder: encoder.backend },
        next.backend === 'software'
          ? 'hardware encoding failed: making the video ladder with libx264'
          : 'hardware decoding failed: decoding on the CPU, encoding on the GPU',
      );
    },
    run: async (attempt, timeoutMs) => {
      const using = attempt ?? encoder;
      await runEncode(ffmpeg, ladderArgs(source, outputs, info, settings, using, container), info, {
        timeoutMs,
        memoryBytes: ladderMemory(info, using, outputs.length),
        fileBytes: largest + 64 * 1024 * 1024,
        onProgress: onPercent,
      });
      for (const o of outputs) {
        const made = await probeVideo(ffprobe, o.path, 'video/mp4');
        const short = shortCopy(info, made, settings);
        if (short) throw new Error(`${o.rung}p: ${short}`);
      }
    },
  });
  return { encoder: used, ms: Date.now() - started };
}

/** Indexes, stores and records one rung; the file it replaces goes once the row points away. */
async function storeRung(
  db: Database,
  storage: ProxyDeps['storage'],
  row: AssetRow,
  info: VideoInfo,
  name: VideoRung,
  path: string,
  opts: {
    generation: string;
    recipe: string;
    encoder: string;
    encodeMs: number;
    previous: string | null;
    ffprobe: string;
  },
) {
  const assetId = row.id;
  const result = await probeVideo(opts.ffprobe, path, 'video/mp4');
  const index = await readFragmentIndex(path);
  const bytes = (await stat(path)).size;
  const key = renditionKey(assetId, opts.generation, name);
  const width = result.width ?? 0;
  const height = result.height ?? 0;
  await storage.writeStream(key, createReadStream(path), 'video/mp4');
  try {
    await db
      .update(assetRendition)
      .set({
        status: 'ready',
        progress: 100,
        width,
        height,
        codecs: renditionCodecs(width, height, info.frameRate),
        bitrate: index.average,
        peakBitrate: index.peak,
        frameRate: info.frameRate,
        bytes,
        storageKey: key,
        playlist: mediaPlaylist(index, `${name}.mp4?v=${opts.generation}`),
        recipe: opts.recipe,
        encoder: opts.encoder,
        encodeMs: opts.encodeMs,
      })
      .where(and(eq(assetRendition.assetId, assetId), eq(assetRendition.name, name)));
  } catch (err) {
    await storage.remove([key]);
    throw err;
  }
  const [kept] = await db
    .select({ key: assetRendition.storageKey })
    .from(assetRendition)
    .where(and(eq(assetRendition.assetId, assetId), eq(assetRendition.name, name)));
  if (!kept) {
    // The asset was deleted while ffmpeg ran: its file must not stay behind.
    await storage.remove([key]);
    return;
  }
  // The row points at the new file: the one it replaces is no longer served.
  if (opts.previous && opts.previous !== key && generationOf(opts.previous))
    await storage.remove([opts.previous]);
}
