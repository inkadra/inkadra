// Load test of an Inkadra instance (#902). Run it against a test copy, never production:
//   pnpm loadtest --preset medium --url https://inkadra-test.example.com --yes-i-know
// See docs/self-hosting/capacity.md.
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { addElement, boardDocName, CURRENT_SCHEMA_VERSION, roots } from '@inkadra/doc-schema';
import WebSocket from 'ws';
import * as Y from 'yjs';
import {
  evaluate,
  formatReport,
  PRESETS,
  type PresetName,
  parseMetrics,
  type Result,
  readServer,
  type ServerReading,
  summarizeServer,
} from './report.ts';

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
const collabUrl = new URL('/collab', args['collab-url'] ?? origin);
collabUrl.protocol =
  collabUrl.protocol === 'https:' || collabUrl.protocol === 'wss:' ? 'wss:' : 'ws:';
collabUrl.search = `schemaVersion=${CURRENT_SCHEMA_VERSION}`;
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
const pause = (ms: number) => sleep(ms, undefined, { signal: stop.signal }).catch(() => {});

const errors: string[] = [];
const error = (what: string) => {
  if (!stop.signal.aborted) errors.push(what);
};
let cookie = '';

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(new URL(path, origin), {
    method,
    headers: {
      origin,
      cookie,
      ...(body === undefined || body instanceof Uint8Array
        ? {}
        : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
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

/** One Hocuspocus connection, the way the web app makes it. */
function connect() {
  const sent = cookie;
  class CookieSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { cookie: sent }, origin });
    }
  }
  return new HocuspocusProviderWebsocket({ url: collabUrl.href, WebSocketPolyfill: CookieSocket });
}

function open(socket: HocuspocusProviderWebsocket, boardId: string) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: boardDocName(boardId),
    document: doc,
  });
  provider.on('authenticationFailed', ({ reason }: { reason: string }) =>
    error(`board ${boardId}: ${reason}`),
  );
  provider.on('stateless', ({ payload }: { payload: string }) => {
    if (payload.includes('writeRefused')) error(`board ${boardId}: ${payload}`);
  });
  const synced = new Promise<void>((done) => provider.on('synced', () => done()));
  provider.attach();
  return {
    doc,
    provider,
    synced: Promise.race([
      synced,
      pause(20_000).then(() => Promise.reject(new Error(`board ${boardId} did not sync`))),
    ]),
    close() {
      provider.destroy();
      doc.destroy();
    },
  };
}

const note = (id: string, x: number, y: number) => ({
  id,
  type: 'note' as const,
  x,
  y,
  w: 240,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: Date.now(),
});
const newId = () => `lt_${randomBytes(8).toString('hex')}`;

/** A 1×1 PNG, uploaded through tus as the web app does. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
async function upload(projectId: string) {
  const meta = { projectId, filename: `loadtest-${newId()}.png`, filetype: 'image/png' };
  const res = await api('POST', '/api/v1/uploads', undefined, {
    'tus-resumable': '1.0.0',
    'upload-length': String(PNG.length),
    'upload-metadata': Object.entries(meta)
      .map(([k, v]) => `${k} ${Buffer.from(v).toString('base64')}`)
      .join(','),
  });
  const location = res.headers.get('location') ?? '';
  await api('PATCH', new URL(location, origin).pathname, new Uint8Array(PNG), {
    'tus-resumable': '1.0.0',
    'upload-offset': '0',
    'content-type': 'application/offset+octet-stream',
  });
}

async function scrape(): Promise<ServerReading | null> {
  if (!metricsToken) return null;
  try {
    const res = await fetch(new URL('/metrics', origin), {
      headers: { authorization: `Bearer ${metricsToken}` },
    });
    if (!res.ok) throw new Error(`/metrics: ${res.status}`);
    return readServer(parseMetrics(await res.text()));
  } catch (err) {
    error(String(err));
    return null;
  }
}

/** Sent edits by the value they wrote, for readers to time their delivery. */
const sentAt = new Map<number, number>();
let counter = 0;
const editMs: number[] = [];
const deliveryMs: number[] = [];
let edits = 0;
let switches = 0;
let reconnects = 0;
const uploads = { ok: 0, failed: 0 };
let projectId: string | undefined;
const sockets: HocuspocusProviderWebsocket[] = [];
const closers = new Set<() => void>();

/** Each editor works on one board, edits every second and moves on every 20–40 s. */
const current: string[] = [];

async function editor(index: number, boards: string[], end: number) {
  const socket = connect();
  sockets.push(socket);
  socket.on('disconnect', () => {
    if (!stop.signal.aborted && Date.now() < end) reconnects += 1;
  });
  while (Date.now() < end && !stop.signal.aborted) {
    const boardId = boards[Math.floor(Math.random() * boards.length)]!;
    current[index] = boardId;
    const board = open(socket, boardId);
    closers.add(board.close);
    try {
      await board.synced;
      switches += 1;
      const mine = newId();
      addElement(board.doc, note(mine, index * 300, 0));
      let started = 0;
      board.provider.on('unsyncedChanges', ({ number }: { number: number }) => {
        if (number === 0 && started) {
          editMs.push(performance.now() - started);
          started = 0;
        }
      });
      const leaveAt = Math.min(end, Date.now() + 20_000 + Math.random() * 20_000);
      while (Date.now() < leaveAt && !stop.signal.aborted) {
        const value = ++counter;
        // Timed only when nothing else is waiting for its acknowledgement.
        if (board.provider.unsyncedChanges === 0) started = performance.now();
        sentAt.set(value, performance.now());
        board.doc.transact(() => roots(board.doc).elements.get(mine)?.set('x', value));
        edits += 1;
        board.provider.awareness?.setLocalState({
          cursor: { x: Math.random() * 2000, y: Math.random() * 1200 },
          selection: [mine],
          editing: null,
        });
        if (projectId && Math.random() < 1 / 60)
          await upload(projectId).then(
            () => {
              uploads.ok += 1;
            },
            (err) => {
              uploads.failed += 1;
              error(`upload: ${err}`);
            },
          );
        await pause(800 + Math.random() * 400);
      }
    } catch (err) {
      error(String(err));
      await pause(1000);
    } finally {
      board.close();
      closers.delete(board.close);
    }
  }
}

/** Readers follow an editor and time how long its edits take to reach them. */
async function reader(index: number, editors: number, end: number) {
  const socket = connect();
  sockets.push(socket);
  socket.on('disconnect', () => {
    if (!stop.signal.aborted && Date.now() < end) reconnects += 1;
  });
  while (Date.now() < end && !stop.signal.aborted) {
    const boardId = current[index % editors];
    if (!boardId) {
      await pause(500);
      continue;
    }
    const board = open(socket, boardId);
    closers.add(board.close);
    try {
      await board.synced;
      roots(board.doc).elements.observeDeep((events) => {
        for (const event of events)
          if (event instanceof Y.YMapEvent && event.keysChanged.has('x')) {
            const at = sentAt.get(event.target.get('x') as number);
            if (at !== undefined) deliveryMs.push(performance.now() - at);
          }
      });
      while (current[index % editors] === boardId && Date.now() < end && !stop.signal.aborted)
        await pause(250);
    } catch (err) {
      error(String(err));
      await pause(1000);
    } finally {
      board.close();
      closers.delete(board.close);
    }
  }
}

async function cleanup() {
  for (const close of closers) close();
  for (const socket of sockets) socket.destroy();
  if (!cookie) return;
  // The last boards are saved as their connections close: deleting the project under those
  // saves only makes them fail. Not cut short by Ctrl-C.
  if (projectId) await sleep(3000);
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
}

async function main(): Promise<number> {
  let baseline: ServerReading | null = null;
  const readings: ServerReading[] = [];
  try {
    await signIn();
    baseline = await scrape();
    // A collab role started a moment ago may not have sent its first heartbeat: wait for it,
    // or memory per board would count the whole process.
    for (let i = 0; baseline && baseline.rssBytes === 0 && i < 15; i++) {
      await pause(2000);
      baseline = await scrape();
    }
    const project = (await (
      await api('POST', '/api/v1/projects', { name: `Load test ${run}` })
    ).json()) as { id: string; rootBoardId: string };
    projectId = project.id;
    const boards: string[] = [project.rootBoardId];
    console.log(`Seeding ${preset.boards} boards in the project "Load test ${run}"…`);
    // Boards with a few notes each, so that opening one loads a real document.
    const seed = async () => {
      while (boards.length < preset.boards && !stop.signal.aborted) {
        const n = boards.length;
        boards.push('');
        const created = (await (
          await api('POST', `/api/v1/projects/${projectId}/boards`, {
            parentBoardId: project.rootBoardId,
            title: `Board ${n}`,
          })
        ).json()) as { id: string };
        boards[n] = created.id;
      }
    };
    await Promise.all(Array.from({ length: 8 }, seed));
    const socket = connect();
    sockets.push(socket);
    const fill = async (list: string[]) => {
      for (const boardId of list) {
        if (stop.signal.aborted) return;
        const board = open(socket, boardId);
        await board.synced;
        board.doc.transact(() => {
          for (let i = 0; i < 20; i++)
            addElement(board.doc, note(newId(), (i % 5) * 260, Math.floor(i / 5) * 200));
        });
        while (board.provider.unsyncedChanges > 0 && !stop.signal.aborted) await pause(20);
        board.close();
      }
    };
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => fill(boards.filter((_, j) => j % 8 === i))),
    );
    socket.destroy();
    if (stop.signal.aborted) return 130;

    console.log(`Running for ${durationS} s…`);
    const end = Date.now() + durationS * 1000;
    const poll = (async () => {
      while (Date.now() < end && !stop.signal.aborted) {
        await pause(5000);
        const reading = await scrape();
        if (reading) readings.push(reading);
      }
    })();
    await Promise.all([
      ...Array.from({ length: preset.editors }, (_, i) => editor(i, boards, end)),
      ...Array.from({ length: preset.readers }, (_, i) => reader(i, preset.editors, end)),
      poll,
    ]);
    if (stop.signal.aborted) return 130;
  } catch (err) {
    error(String(err));
  } finally {
    await cleanup();
  }
  const result: Result = {
    preset: presetName,
    url: origin,
    durationS,
    editors: preset.editors,
    readers: preset.readers,
    boards: preset.boards,
    edits,
    editMs,
    deliveryMs,
    switches,
    uploads,
    errors,
    reconnects,
    server: baseline ? summarizeServer(baseline, readings) : null,
  };
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
