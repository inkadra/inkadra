#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino, { type Logger } from 'pino';
import { startInlineExpirySweep } from './access-expiry.ts';
import { disableAdminTwoFactor } from './admin-two-factor.ts';
import { createAuth } from './auth.ts';
import { authSecurity, authSource } from './auth-security.ts';
import { backupsDir, restoreBackup, runBackup, startBackup } from './backup.ts';
import { type BoardReader, directBoardReader } from './board-content.ts';
import { type BoardNotifier, directBoardNotifier } from './board-notices.ts';
import { type BoardWriter, directBoardWriter } from './board-writer.ts';
import { attachCollab, createCollabServer } from './collab.ts';
import { type Config, loadConfig, VERSION } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { createApp } from './http/app.ts';
import { sweepClipTemp } from './http/clip-routes.ts';
import type { Jobs } from './jobs.ts';
import { createMailer } from './mailer.ts';
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
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    log.info('database migrations applied');
    if (command === 'migrate') return;
  }

  const { db, sql } = createDatabase(config.DATABASE_URL);
  const mailer = createMailer(config, log);
  const auth = createAuth(config, db, { mailer, log });
  const storage = createStorage(config);
  const tmpDir = join(config.DATA_DIR, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const media = {
    db,
    storage,
    tmpDir,
    heic: config.HEIC_PREVIEWS,
    raw: config.RAW_PREVIEWS,
    pdf: config.PDF_PREVIEWS,
    proxies: {
      enabled: config.VIDEO_PROXIES,
      maxDurationS: config.VIDEO_PROXY_MAX_DURATION,
      maxSourceBytes: config.VIDEO_PROXY_MAX_SOURCE_SIZE,
      resolution: config.VIDEO_PROXY_RESOLUTION,
      bitrate: config.VIDEO_PROXY_BITRATE,
    },
  };
  const transfers = transferDeps(config);
  const closers: Array<() => Promise<unknown>> = [
    async () => auth.closeSecurity(),
    () => sql.end({ timeout: 5 }),
  ];

  if (command === 'worker' || command === 'all') {
    if (!config.REDIS_URL) throw new Error('REDIS_URL is required by the worker.');
    const workers = await startWorkers(config.REDIS_URL, log, {
      ...media,
      proxyConcurrency: config.VIDEO_PROXY_CONCURRENCY,
      mailer,
      publicUrl: config.PUBLIC_URL,
      instanceName: config.INSTANCE_NAME,
      transfers,
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
            versions: directVersionWriter(server, db, log),
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
    if (config.REDIS_URL) {
      const queues = createQueues(config.REDIS_URL);
      jobs = queues.jobs;
      closers.unshift(() => queues.close());
      pingQueue = async () => {
        try {
          return (await queues.connection.ping()) === 'PONG';
        } catch {
          return false;
        }
      };
    } else {
      log.warn('REDIS_URL is not set: processing uploads inside the web process');
      jobs = inlineJobs(media, log, transfers);
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
      versions = directVersionWriter(collab, db, log);
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
    const webDist = config.WEB_DIST ?? join(here, '..', 'web');
    const app = await createApp({
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
    });
    if (collab) {
      attachCollab(app.server, collab);
    }
    closers.unshift(() => app.close());
    await app.listen({ host: config.HOST, port: config.PORT });
  }

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
