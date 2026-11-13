#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VideoRung } from '@inkadra/shared';
import pino, { type Logger } from 'pino';
import { startInlineExpirySweep } from './access-expiry.ts';
import { disableAdminTwoFactor } from './admin-two-factor.ts';
import { createAuth } from './auth.ts';
import { authSecurity, authSource } from './auth-security.ts';
import { backupsDir, restoreBackup, runBackup, startBackup } from './backup.ts';
import { type BoardReader, directBoardReader } from './board-content.ts';
import { type BoardNotifier, directBoardNotifier } from './board-notices.ts';
import { type BoardWriter, directBoardWriter } from './board-writer.ts';
import { attachCollab, createCollabServer, DEMO_COLLAB_LIMITS } from './collab.ts';
import { type Config, loadConfig, VERSION } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { startSandboxSweep } from './demo.ts';
import { createApp } from './http/app.ts';
import { sweepClipTemp } from './http/clip-routes.ts';
import type { LiveContext } from './http/hls.ts';
import type { Jobs } from './jobs.ts';
import { createMailer } from './mailer.ts';
import { chooseVideoEncoder, forgetVideoEncoder } from './media/encoder-setting.ts';
import type { VideoEncoder } from './media/hwaccel.ts';
import { detectVideoEncoder } from './media/hwaccel.ts';
import { LiveSessions } from './media/live.ts';
import { mapUserAgent } from './media/maps.ts';
import { DEFAULT_VIDEO_QUALITY } from './media/quality.ts';
import { sweepJobDirs } from './media/scratch.ts';
import { mediaTools } from './media/tools.ts';
import { checkHealth } from './monitor/health.ts';
import { LatencyRecorder, startSampler } from './monitor/sampler.ts';
import { type MonitorStore, memoryStore, monitorRedis, redisStore } from './monitor/store.ts';
import {
  createQueues,
  inlineJobs,
  queuedBoardNotifier,
  queuedBoardWriter,
  startBoardWorker,
  startWorkers,
} from './queues.ts';
import { startIndexBackfill } from './search/index-doc.ts';
import { createStorage } from './storage.ts';
import { directVersionWriter, type VersionWriter } from './versions.ts';
import { cachedVideoSettings } from './video-settings.ts';

const COMMANDS = [
  'web',
  'collab',
  'worker',
  'all',
  'migrate',
  'unlock-auth',
  'admin-2fa',
  'backup',
] as const;
type Command = (typeof COMMANDS)[number];

const here = dirname(fileURLToPath(import.meta.url));
// In the image the bundle sits in dist/ next to drizzle/; in development main.ts is in src/.
const migrationsFolder = process.env.MIGRATIONS_DIR ?? join(here, '..', 'drizzle');

async function main() {
  const command = (process.argv[2] ?? 'all') as Command;
  if (!COMMANDS.includes(command)) {
    console.error(`Usage: inkadra <${COMMANDS.join('|')}>`);
    process.exit(2);
  }

  const config = loadConfig();
  /** The demo's caps on boards and their versions (decision 0084); none elsewhere. */
  const limits = config.DEMO_MODE ? DEMO_COLLAB_LIMITS : undefined;
  const log = pino({ level: config.LOG_LEVEL, base: { service: command } });
  log.info({ version: VERSION }, 'starting inkadra');

  // Host/container administrators only; deliberately not an HTTP endpoint.
  if (command === 'unlock-auth') {
    const address = process.argv[3]?.trim().toLowerCase();
    if (!address?.includes('@') || !config.REDIS_URL)
      throw new Error('Usage: inkadra unlock-auth <email> [source-ip]; REDIS_URL required');
    const security = authSecurity(config, log);
    try {
      await security.ready();
      await security.storage.delete(`account:${address}`);
      await security.storage.delete(`mail:${address}`);
      const source = process.argv[4];
      if (source) {
        await security.storage.delete(`login:${address}:${authSource(source)}`);
        await security.storage.delete(`mail:${address}:${authSource(source)}`);
      }
      log.info('Authentication account budgets cleared');
    } finally {
      security.close();
    }
    return;
  }

  // Requires access to the host and configured database; never exposed over HTTP.
  if (command === 'admin-2fa') {
    if (process.argv[3] !== 'off' || process.argv[4] !== undefined)
      throw new Error('Usage: inkadra admin-2fa off');
    const { db, sql } = createDatabase(config.DATABASE_URL);
    try {
      await disableAdminTwoFactor(db);
      log.info('Administrator two-step enrollment requirement disabled');
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }

  // Host/container administrators only: `backup create` or `backup restore <file>`.
  if (command === 'backup') {
    await backupCommand(config, log, process.argv.slice(3));
    return;
  }

  if (command === 'migrate' || command === 'web' || command === 'all') {
    await runMigrations(config.DATABASE_URL, migrationsFolder, {
      productionBoards: config.PRODUCTION_BOARD_MOVE,
      log,
    });
    log.info('database migrations applied');
    if (command === 'migrate') return;
  }

  const { db, sql } = createDatabase(config.DATABASE_URL);
  const mailer = createMailer(config, log);
  const auth = createAuth(config, db, { mailer, log });
  const storage = createStorage(config);
  const tmpDir = join(config.DATA_DIR, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  // Scratch folders of media jobs a crash left behind (not those of a job still running).
  const sweptJobs = await sweepJobDirs(tmpDir);
  if (sweptJobs > 0) log.info({ swept: sweptJobs }, 'removed stale media job folders');
  // The encoder of playable copies, where they are made: tried once, at start (#358).
  let encoder: VideoEncoder | undefined;
  if (command === 'worker' || command === 'all' || (command === 'web' && !config.REDIS_URL)) {
    if (config.VIDEO_PROXIES)
      encoder = await chooseVideoEncoder(
        db,
        { mode: config.VIDEO_PROXY_HWACCEL, vaapiDevice: config.VIDEO_PROXY_VAAPI_DEVICE },
        log,
      );
    else await forgetVideoEncoder(db);
  }
  const media = {
    db,
    storage,
    tmpDir,
    heic: config.HEIC_PREVIEWS,
    raw: config.RAW_PREVIEWS,
    pdf: config.PDF_PREVIEWS,
    ...(config.MAPS
      ? { maps: { tileUrl: config.MAP_TILE_URL, userAgent: mapUserAgent(config.PUBLIC_URL) } }
      : {}),
    proxies: {
      enabled: config.VIDEO_PROXIES,
      maxDurationS: config.VIDEO_PROXY_MAX_DURATION,
      maxSourceBytes: config.VIDEO_PROXY_MAX_SOURCE_SIZE,
      resolution: config.VIDEO_PROXY_RESOLUTION ?? 1080,
      quality: DEFAULT_VIDEO_QUALITY,
      bitrate: config.VIDEO_PROXY_BITRATE ?? null,
      rungs: ['480', '720', '1080'] as VideoRung[],
      playable: 'heavy' as const,
      threads: config.VIDEO_PROXY_THREADS,
      ...(encoder ? { encoder } : {}),
    },
    // Settings → Video (decision 0128), read by every job.
    videoEnv: config,
    // Advanced → "Rifai il test di prestazioni": detection and live benchmark again, saved for
    // the page and Diagnostics. The encoder of copies stays the one found at start.
    ...(encoder
      ? {
          benchmark: () =>
            chooseVideoEncoder(
              db,
              { mode: config.VIDEO_PROXY_HWACCEL, vaapiDevice: config.VIDEO_PROXY_VAAPI_DEVICE },
              log,
            ),
        }
      : {}),
  };
  const transfers = transferDeps(config);
  const closers: Array<() => Promise<unknown>> = [
    async () => auth.closeSecurity(),
    () => sql.end({ timeout: 5 }),
  ];

  // The Server page (#514): every role samples itself and tells the others it is alive.
  const monitorConnection = config.REDIS_URL ? monitorRedis(config.REDIS_URL, log) : undefined;
  const monitor: MonitorStore = monitorConnection ? redisStore(monitorConnection) : memoryStore();
  if (monitorConnection) closers.push(async () => monitorConnection.disconnect());
  const latency = command === 'web' || command === 'all' ? new LatencyRecorder() : undefined;

  if (command === 'worker' || command === 'all') {
    if (!config.REDIS_URL) throw new Error('REDIS_URL is required by the worker.');
    const workers = await startWorkers(config.REDIS_URL, log, {
      ...media,
      proxyConcurrency:
        config.VIDEO_PROXY_CONCURRENCY ?? (encoder && encoder.backend !== 'software' ? 2 : 1),
      mailer,
      publicUrl: config.PUBLIC_URL,
      instanceName: config.INSTANCE_NAME,
      transfers,
      monitor: { store: monitor, role: command },
    });
    closers.unshift(() => workers.close());
    log.info('worker started');
  }

  let collab: ReturnType<typeof createCollabServer> | undefined;
  if (command === 'collab' || command === 'all') {
    collab = createCollabServer({
      db,
      auth,
      log,
      publicUrl: config.PUBLIC_URL,
      trustProxy: config.TRUST_PROXY,
      ...(limits ? { limits } : {}),
    });
    const server = collab;
    closers.unshift(() => server.destroy());
    const backfill = startIndexBackfill(db, log);
    closers.unshift(async () => backfill.stop());
    if (command === 'collab') {
      // In split mode the web role sends its board edits (clips, versions) through the queue.
      if (config.REDIS_URL) {
        const boardWorker = startBoardWorker(
          config.REDIS_URL,
          directBoardWriter(server, log),
          log,
          {
            versions: directVersionWriter(server, db, log, limits),
            notices: directBoardNotifier(server),
            reader: directBoardReader(server, db),
          },
        );
        closers.unshift(() => boardWorker.close());
      } else log.warn('REDIS_URL is not set: clips from a separate web role cannot reach boards');
      await server.listen(config.COLLAB_PORT);
      log.info({ port: config.COLLAB_PORT }, 'collab listening');
    }
  }

  if (command === 'web' || command === 'all') {
    let pingQueue: (() => Promise<boolean>) | undefined;
    let jobs: Jobs;
    let queueHandles: ReturnType<typeof createQueues> | undefined;
    if (config.REDIS_URL) {
      const queues = createQueues(config.REDIS_URL);
      queueHandles = queues;
      jobs = queues.jobs;
      closers.unshift(() => queues.close());
      pingQueue = async () => {
        try {
          // The monitor connection gives up after a timeout; the queue one would wait.
          return (await monitorConnection?.ping()) === 'PONG';
        } catch {
          return false;
        }
      };
    } else {
      log.warn('REDIS_URL is not set: processing uploads inside the web process');
      jobs = inlineJobs(media, log, transfers, monitor);
      // Without a worker, ended access is swept here (decision 0041).
      const stopSweep = startInlineExpirySweep(db, log);
      closers.unshift(async () => stopSweep());
    }
    // Left behind by a clip that was being received when the server stopped.
    const swept = await sweepClipTemp(tmpDir);
    if (swept > 0) log.info({ swept }, 'removed stale clip folders');
    let boards: BoardWriter | undefined;
    let boardReader: BoardReader | undefined;
    let versions: VersionWriter | undefined;
    let notices: BoardNotifier | undefined;
    if (collab) {
      boards = directBoardWriter(collab, log);
      boardReader = directBoardReader(collab, db);
      versions = directVersionWriter(collab, db, log, limits);
      notices = directBoardNotifier(collab);
    } else if (config.REDIS_URL) {
      const queued = queuedBoardWriter(config.REDIS_URL);
      boards = queued.writer;
      boardReader = queued.reader;
      versions = queued.versions;
      closers.unshift(() => queued.close());
      const queuedNotices = queuedBoardNotifier(config.REDIS_URL, log);
      notices = queuedNotices.notifier;
      closers.unshift(() => queuedNotices.close());
    }
    // Live playback of video rungs runs where requests arrive (decision 0128).
    let live: LiveContext | undefined;
    if (config.VIDEO_PROXIES) {
      const { ffmpeg } = await mediaTools();
      const liveEncoder =
        encoder ??
        (ffmpeg
          ? (
              await detectVideoEncoder(ffmpeg, {
                mode: config.VIDEO_PROXY_HWACCEL,
                vaapiDevice: config.VIDEO_PROXY_VAAPI_DEVICE,
              }).catch(() => null)
            )?.encoder
          : undefined);
      // Live playback needs a hardware encoder (decision 0128): never libx264.
      const hardware = liveEncoder && liveEncoder.backend !== 'software' ? liveEncoder : undefined;
      if (hardware) {
        const sessions = new LiveSessions({
          storage,
          tmpDir,
          encoder: hardware,
          proxies: media.proxies,
          log,
        });
        await sessions.start();
        closers.unshift(() => sessions.close());
        live = {
          sessions,
          encoder: hardware,
          proxies: media.proxies,
          settings: cachedVideoSettings(db, config),
        };
      } else log.info('live video playback is off here: it needs GPU hardware encoding');
    }
    const webDist = config.WEB_DIST ?? join(here, '..', 'web');
    const app = await createApp({
      ...(live ? { live } : {}),
      config: { ...config, WEB_DIST: webDist },
      db,
      auth,
      log,
      storage,
      jobs,
      mailer,
      pingQueue,
      boards,
      boardReader,
      versions,
      notices,
      tmpDir,
      monitor: {
        store: monitor,
        latency,
        queues: queueHandles?.queues,
        redis: monitorConnection,
      },
    });
    if (config.DEMO_MODE) {
      // The only automatic deletion of Inkadra: sandboxes past their hour, now and every minute.
      const stopDemo = startSandboxSweep({ db, jobs, config, log });
      closers.unshift(async () => stopDemo());
      // Production refuses to start without them (loadConfig); development and tests say so.
      if (!config.TURNSTILE_SECRET)
        log.error(
          'DEMO_MODE without TURNSTILE_SITE_KEY and TURNSTILE_SECRET: anyone, bots included, can ' +
            'open sandboxes up to DEMO_MAX_SANDBOXES. Set both before the demo is public.',
        );
    }
    const health = setInterval(
      () =>
        void checkHealth({
          db,
          store: monitor,
          mailer,
          log,
          config,
          instanceName: config.INSTANCE_NAME,
          publicUrl: config.PUBLIC_URL,
        }).catch((err) => log.warn({ err }, 'server health check failed')),
      60_000,
    );
    health.unref();
    closers.unshift(async () => clearInterval(health));
    if (collab) {
      attachCollab(app.server, collab);
    }
    closers.unshift(() => app.close());
    await app.listen({ host: config.HOST, port: config.PORT });
  }

  const sampler = startSampler({
    role: command as 'web' | 'collab' | 'worker' | 'all',
    store: monitor,
    log,
    latency,
    ...(collab ? { presence: collab.presence } : {}),
  });
  closers.unshift(async () => sampler.stop());

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    for (const close of closers) {
      try {
        await close();
      } catch (err) {
        log.error({ err }, 'error during shutdown');
      }
    }
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

function transferDeps(config: Config) {
  return {
    dataDir: config.DATA_DIR,
    uploadMaxSize: config.UPLOAD_MAX_SIZE,
    importMaxSize: config.IMPORT_MAX_SIZE,
    storageEnv: {
      STORAGE_LIMIT: config.STORAGE_LIMIT,
      STORAGE_LIMIT_PER_USER: config.STORAGE_LIMIT_PER_USER,
    },
    migrationsFolder,
    bucket: config.STORAGE_DRIVER === 's3',
    databaseUrl: config.DATABASE_URL,
  };
}

async function backupCommand(config: Config, log: Logger, args: string[]) {
  const [action, file] = args;
  if (action === 'restore' && file && args.length === 2) {
    const tmpDir = join(config.DATA_DIR, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    const report = await restoreBackup({
      file,
      databaseUrl: config.DATABASE_URL,
      migrationsFolder,
      storage: createStorage(config),
      tmpDir,
      log,
    });
    log.info(report, 'backup restored');
    if (report.files.missing > 0)
      log.warn(
        { missing: report.files.missing, examples: report.files.examples },
        'some files listed by the backup are not in storage: restore the data volume or bucket too',
      );
    return;
  }
  if (action === 'create' && args.length === 1) {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    const { db, sql } = createDatabase(config.DATABASE_URL, 2);
    try {
      const row = await startBackup(db, 'manual', null);
      if (!row) throw new Error('A backup is already running.');
      const done = await runBackup(
        { db, storage: createStorage(config), log, ...transferDeps(config) },
        row.id,
      );
      if (done?.status !== 'ready') throw new Error('The backup failed, see the log above.');
      log.info({ file: join(backupsDir(config.DATA_DIR), done.fileName ?? '') }, 'backup written');
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }
  throw new Error('Usage: inkadra backup create | inkadra backup restore <file>');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
