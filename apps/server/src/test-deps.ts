import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { Database } from './db/client.ts';
import { inlineJobs } from './queues.ts';
import { localStorage } from './storage.ts';

/** Storage in a fresh temporary directory and jobs run in-process, for tests. */
export function testDeps(db: Database, log: Logger) {
  const root = mkdtempSync(join(tmpdir(), 'inkadra-test-'));
  const storage = localStorage(join(root, 'files'));
  const jobs = inlineJobs({ db, storage, tmpDir: join(root, 'tmp'), heic: true }, log);
  return { root, storage, jobs };
}
