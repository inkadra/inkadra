// Load test of an Inkadra instance (#902). Run it against a test copy, never production:
//   pnpm loadtest --preset medium --url https://inkadra-test.example.com --yes-i-know
// See docs/self-hosting/capacity.md. The load itself is src/loadtest/generator.ts, which the
// worker job of Settings → Server (#908) runs too.
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runLoad } from '../../src/loadtest/generator.ts';
import {
  evaluate,
  formatReport,
  PRESETS,
  type PresetName,
  parseMetrics,
  readServer,
} from '../../src/loadtest/report.ts';

const { values: args } = parseArgs({
  options: {
    preset: { type: 'string', default: 'medium' },
    url: { type: 'string' },
    'collab-url': { type: 'string' },
    duration: { type: 'string' },
    out: { type: 'string' },
    'yes-i-know': { type: 'boolean', default: false },
  },
});

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};
const presetName = args.preset as PresetName;
const preset =
  PRESETS[presetName] ?? fail(`Unknown preset ${args.preset}: small, medium or large.`);
const base = new URL(args.url ?? fail('Give the instance with --url https://…'));
const origin = base.origin;
const durationS = args.duration ? Number(args.duration) : preset.durationS;
if (!Number.isFinite(durationS) || durationS < 10) fail('--duration is in seconds, at least 10.');
const metricsToken = process.env.METRICS_TOKEN || undefined;

console.log(
  [
    `This load test connects ${preset.editors} editors and ${preset.readers} readers to ${origin} for ${durationS} s,`,
    `creates an account, a project with ${preset.boards} boards and small uploads, and deletes them at the end.`,
    'Run it against a test copy of your instance, never production: everyone on it will feel the load.',
  ].join('\n'),
);
if (!args['yes-i-know'] && process.env.INKADRA_LOADTEST_CONFIRM !== 'yes')
  fail('Refusing to start: add --yes-i-know (or INKADRA_LOADTEST_CONFIRM=yes) to confirm.');

// Ctrl-C stops the run; the cleanup below still runs. A second Ctrl-C quits at once.
const stop = new AbortController();
process.on('SIGINT', () => {
  if (stop.signal.aborted) process.exit(130);
  console.log('\nStopping: cleaning up first (Ctrl-C again to quit without cleaning up).');
  stop.abort();
});
process.on('SIGTERM', () => stop.abort());

let cookie = '';
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(new URL(path, origin), {
    method,
    // No content type without a body: the server refuses an empty JSON body (DELETE).
    headers: { origin, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

const run = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const own = !process.env.INKADRA_LOADTEST_EMAIL;
const email = process.env.INKADRA_LOADTEST_EMAIL ?? `loadtest-${run}@example.invalid`;
const password = process.env.INKADRA_LOADTEST_PASSWORD ?? randomBytes(18).toString('base64url');

async function signIn() {
  const res = own
    ? await api('POST', '/api/auth/sign-up/email', { name: `Load test ${run}`, email, password })
    : await api('POST', '/api/auth/sign-in/email', { email, password });
  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function scrape() {
  if (!metricsToken) return null;
  const res = await fetch(new URL('/metrics', origin), {
    headers: { authorization: `Bearer ${metricsToken}` },
  });
  if (!res.ok) throw new Error(`/metrics: ${res.status}`);
  return readServer(parseMetrics(await res.text()));
}

async function main(): Promise<number> {
  try {
    await signIn();
  } catch (err) {
    console.error(String(err));
    return 2;
  }
  let projectId: string | undefined;
  const outcome = await runLoad({
    baseUrl: origin,
    ...(args['collab-url'] ? { collabUrl: args['collab-url'] } : {}),
    auth: { cookie },
    presetName,
    preset,
    durationS,
    signal: stop.signal,
    scrape,
    log: (line) => console.log(line),
    onProject: (id) => {
      projectId = id;
    },
  }).finally(async () => {
    // Deleting the project deletes its boards and files; the account goes after it.
    if (projectId)
      await api('DELETE', `/api/v1/projects/${projectId}`).catch((err) =>
        console.error(`Could not delete the project ${projectId}: ${err}`),
      );
    if (own)
      await api('DELETE', '/api/v1/me', { password }).catch((err) =>
        // The first account of an empty instance is its administrator, and the last one stays.
        console.error(`Could not delete the account ${email}: ${err}`),
      );
  });
  if (outcome.stopped) return 130;
  const { result } = outcome;
  const failures = evaluate(result, preset.limits);
  const report = formatReport(result, preset.limits, failures);
  console.log(`\n${report}`);
  if (args.out) {
    const out = resolve(process.env.INIT_CWD ?? process.cwd(), args.out);
    const { editMs: _e, deliveryMs: _d, ...rest } = result;
    await writeFile(`${out}.txt`, `${report}\n`);
    await writeFile(
      `${out}.json`,
      `${JSON.stringify({ ...rest, limits: preset.limits, failures }, null, 2)}\n`,
    );
  }
  return failures.length ? 1 : 0;
}

process.exit(await main());
