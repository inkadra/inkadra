// Every temporary file of a server test run lands in one folder of its own, removed at the end:
// leftovers of runs filled a shared /tmp once and every command failed (EDQUOT).
// globalSetup points TMPDIR at the run's folder, the setup file at a subfolder for each test
// file, and the teardown fails the run when a test file left something behind, naming it.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const RUN_DIR = 'INKADRA_TEST_RUN_TMPDIR';
// Stands for `/` in the name of a test file's folder. Not `%2F`: a test that hands a path to
// librsvg as a URL would see it decoded (process.test.ts).
const SEP = '--';

function pointTmpAt(dir: string) {
  for (const name of ['TMPDIR', 'TEMP', 'TMP']) process.env[name] = dir;
}

/** globalSetup: the run's folder, and the teardown that checks and removes it. */
export default function runTmpDir() {
  const run = mkdtempSync(join(tmpdir(), `inkadra-vitest-${process.pid}-`));
  const previous = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env[RUN_DIR] = run;
  pointTmpAt(run);
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const left = leftovers(run);
    rmSync(run, { recursive: true, force: true });
    if (left.length)
      throw new Error(
        `Tests left temporary files behind: make them with tempDir() from test-tmpdir.ts, or ` +
          `remove them in afterEach/afterAll (rmSync(dir, { recursive: true, force: true })); ` +
          `work still writing after the last hook is waited for with settleBeforeRemoving():\n` +
          left.join('\n'),
      );
  };
}

/** What the test files left in the run's folder, one line per test file. */
export function leftovers(run: string): string[] {
  return readdirSync(run).flatMap((entry) => {
    if (!entry.startsWith('file-')) return [`(outside a test file) ${entry}`];
    // The deepest paths name what wrote them (files/variants/… is a media job, say), up to 5.
    const left = readdirSync(join(run, entry), { recursive: true }).map(String);
    const deepest = left.filter((p) => !left.some((q) => q.startsWith(p + sep)));
    return left.length
      ? [`${entry.slice(5).replaceAll(SEP, '/')}: ${deepest.slice(0, 5).join(', ')}`]
      : [];
  });
}

/** Setup file: this test file's own subfolder, so a leftover names the file that made it. */
export function fileTmpDir(testPath: string | undefined) {
  const run = process.env[RUN_DIR];
  if (!run || !testPath) return;
  const dir = join(run, `file-${relative(process.cwd(), testPath).replaceAll(sep, SEP)}`);
  mkdirSync(dir, { recursive: true });
  pointTmpAt(dir);
}

const made: string[] = [];
const pending: { work: () => Promise<unknown>; label: string }[] = [];
// Well under the hook timeout, so the folders still go and the error says what hung.
const SETTLE_MS = 10_000;

/** A fresh temporary folder, removed after the test file's last hook (see test-setup.ts). */
export function tempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/**
 * Background work that may still write into a `tempDir` folder after the test file's hooks (the
 * in-process jobs of testDeps): waited for before the folders go, or a late write makes one again.
 */
export function settleBeforeRemoving(work: () => Promise<unknown>, label: string) {
  pending.push({ work, label });
}

/**
 * Removes the folders `tempDir` made for this test file once their background work is done, or
 * after SETTLE_MS; the folders go whatever happened, then a failure or a hang is reported.
 */
export async function removeTempDirs() {
  const works = pending.splice(0);
  const dirs = made.splice(0);
  const waiting = new Set(works.map((w) => w.label));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = Promise.allSettled(
      works.map(({ work, label }) =>
        Promise.resolve()
          .then(work)
          .finally(() => waiting.delete(label)),
      ),
    );
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), SETTLE_MS);
      timer.unref?.();
    });
    const result = await Promise.race([settled, timeout]);
    if (result === 'timeout')
      throw new Error(
        `Work registered with settleBeforeRemoving() did not finish in ${SETTLE_MS / 1000} s: ` +
          [...waiting].join(', '),
      );
    const errors = result.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, 'Work registered with settleBeforeRemoving() failed');
  } finally {
    clearTimeout(timer);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
}
