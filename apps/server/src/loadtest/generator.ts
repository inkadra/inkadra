// The load of the load test (#902), shared by the CLI (scripts/loadtest/run.ts) and the worker
// job of Settings → Server (#908): it seeds a project of boards, then drives editors and readers
// over Hocuspocus for the preset's duration. Signing in and deleting the data is the caller's.
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { addElement, boardDocName, CURRENT_SCHEMA_VERSION, roots } from '@inkadra/doc-schema';
import type { LoadTestProgress } from '@inkadra/shared';
import WebSocket from 'ws';
import * as Y from 'yjs';
import {
  type Preset,
  type PresetName,
  percentile,
  type Result,
  type ServerReading,
  summarizeServer,
} from './report.ts';

export interface LoadOptions {
  /** Where the requests go, e.g. `http://127.0.0.1:3000`. */
  baseUrl: string;
  /** The collaboration server, when it is not `baseUrl` (split mode). */
  collabUrl?: string;
  /** The `Origin` the requests carry: the instance's public origin. Defaults to `baseUrl`'s. */
  origin?: string;
  /** The session cookie of the web app, or a personal token (`ink_…`). */
  auth: { cookie: string } | { token: string };
  presetName: PresetName;
  preset: Preset;
  durationS: number;
  /** Stops the run early; the providers are closed all the same. */
  signal: AbortSignal;
  /** A reading of the board roles (from /metrics or the monitor store); null when unknown. */
  scrape(): Promise<ServerReading | null>;
  log?(message: string): void;
  /** The test project, as soon as it exists: the caller deletes it. */
  onProject?(projectId: string): Promise<void> | void;
  /** Every 2 s: the live numbers. */
  onProgress?(progress: LoadTestProgress): Promise<void> | void;
  /**
   * Checked with each server reading (every 5 s, while seeding and running): a reason ends the
   * run at once (Settings → Server stops when real people feel it).
   */
  guard?(progress: LoadTestProgress): Promise<string | null> | string | null;
}

export interface LoadOutcome {
  result: Result;
  projectId: string | undefined;
  /** Stopped through `signal`. */
  stopped: boolean;
  /** The guard's reason, when it ended the run. */
  aborted: string | null;
}

/** A 1×1 PNG, uploaded through tus as the web app does. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Edit round trips of the last this many ms count for the live p95 and the guard. */
const RECENT_MS = 30_000;

export async function runLoad(opts: LoadOptions): Promise<LoadOutcome> {
  const { preset } = opts;
  const origin = opts.origin ?? new URL(opts.baseUrl).origin;
  const collabUrl = new URL('/collab', opts.collabUrl ?? opts.baseUrl);
  collabUrl.protocol =
    collabUrl.protocol === 'https:' || collabUrl.protocol === 'wss:' ? 'wss:' : 'ws:';
  collabUrl.search = `schemaVersion=${CURRENT_SCHEMA_VERSION}`;
  const log = opts.log ?? (() => {});
  // The caller's signal, or the guard: either ends every loop below.
  const stop = new AbortController();
  let aborted: string | null = null;
  const onStop = () => stop.abort();
  opts.signal.addEventListener('abort', onStop);
  if (opts.signal.aborted) stop.abort();
  const pause = (ms: number) => sleep(ms, undefined, { signal: stop.signal }).catch(() => {});

  const errors: string[] = [];
  const error = (what: string) => {
    if (!stop.signal.aborted) errors.push(what);
  };
  const authHeaders: Record<string, string> =
    'cookie' in opts.auth
      ? { cookie: opts.auth.cookie }
      : { authorization: `Bearer ${opts.auth.token}` };

  async function api(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await fetch(new URL(path, opts.baseUrl), {
      method,
      headers: {
        origin,
        ...authHeaders,
        ...(body === undefined || body instanceof Uint8Array
          ? {}
          : { 'content-type': 'application/json' }),
        ...headers,
      },
      body:
        body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  /** One Hocuspocus connection, the way the web app makes it. */
  function connect() {
    const headers = 'cookie' in opts.auth ? { cookie: opts.auth.cookie } : {};
    class HeaderSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers, origin });
        // Closing a socket still connecting (a stop during seeding) emits `error`: without a
        // listener it would throw out of the process. Failures reach the provider as closes.
        this.on('error', () => {});
      }
    }
    return new HocuspocusProviderWebsocket({
      url: collabUrl.href,
      WebSocketPolyfill: HeaderSocket,
    });
  }

  function open(socket: HocuspocusProviderWebsocket, boardId: string) {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: boardDocName(boardId),
      document: doc,
      ...('token' in opts.auth ? { token: opts.auth.token } : {}),
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
    await api('PATCH', new URL(location, opts.baseUrl).pathname, new Uint8Array(PNG), {
      'tus-resumable': '1.0.0',
      'upload-offset': '0',
      'content-type': 'application/offset+octet-stream',
    });
  }

  async function scrape() {
    try {
      return await opts.scrape();
    } catch (err) {
      error(String(err));
      return null;
    }
  }

  /** Sent edits by the value they wrote, for readers to time their delivery. */
  const sentAt = new Map<number, number>();
  let counter = 0;
  const editMs: number[] = [];
  const editAt: number[] = [];
  const deliveryMs: number[] = [];
  const deliveryAt: number[] = [];
  let edits = 0;
  let switches = 0;
  let reconnects = 0;
  const uploads = { ok: 0, failed: 0 };
  let projectId: string | undefined;
  const sockets: HocuspocusProviderWebsocket[] = [];
  const closers = new Set<() => void>();
  const boards: string[] = [];
  // Widened: the loops below see it change.
  let phase = 'seeding' as LoadTestProgress['phase'];
  let runStart = 0;
  let lastReading: ServerReading | null = null;
  let baseline: ServerReading | null = null;
  const readings: ServerReading[] = [];

  const recent = (values: number[], at: number[]) => {
    const since = performance.now() - RECENT_MS;
    let i = at.length;
    while (i > 0 && at[i - 1]! >= since) i -= 1;
    return values.slice(i);
  };
  const progress = (): LoadTestProgress => ({
    phase,
    seeded: boards.filter(Boolean).length,
    boards: preset.boards,
    elapsedS: runStart ? Math.min(opts.durationS, (Date.now() - runStart) / 1000) : 0,
    durationS: opts.durationS,
    edits,
    editP95Ms: percentile(recent(editMs, editAt), 95),
    deliveryP95Ms: percentile(recent(deliveryMs, deliveryAt), 95),
    errors: errors.length,
    reconnects,
    storeP95Ms: lastReading?.storeP95Ms ?? null,
    apiP95Ms: null,
  });
  const ticker = (async () => {
    while (!stop.signal.aborted && phase !== 'cleaning') {
      await pause(2000);
      await Promise.resolve(opts.onProgress?.(progress())).catch((err) => log(String(err)));
    }
  })();
  /** Every 5 s from the start: a server reading (kept for the report while running), then the
   * guard, so a large seeding is stopped as well. Without a guard nothing reads during seeding. */
  const watch = (async () => {
    while (!stop.signal.aborted && phase !== 'cleaning') {
      await pause(5000);
      // Read again: the phase moves on during the pause.
      const now = phase as LoadTestProgress['phase'];
      if (stop.signal.aborted || now === 'cleaning') return;
      const running = now === 'running';
      if (!running && !opts.guard) continue;
      const reading = await scrape();
      if (reading) {
        if (running) readings.push(reading);
        lastReading = reading;
      }
      const reason = await opts.guard?.(progress());
      if (reason && !stop.signal.aborted) {
        aborted = reason;
        stop.abort();
      }
    }
  })();

  /** Each editor works on one board, edits every second and moves on every 20–40 s. */
  const current: string[] = [];

  async function editor(index: number, end: number) {
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
            editAt.push(performance.now());
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
              if (at !== undefined) {
                deliveryMs.push(performance.now() - at);
                deliveryAt.push(performance.now());
              }
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

  try {
    baseline = await scrape();
    // A collab role started a moment ago may not have sent its first heartbeat: wait for it,
    // or memory per board would count the whole process.
    for (let i = 0; baseline && baseline.rssBytes === 0 && i < 15 && !stop.signal.aborted; i++) {
      await pause(2000);
      baseline = await scrape();
    }
    const name = `Load test ${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const project = (await (await api('POST', '/api/v1/projects', { name })).json()) as {
      id: string;
      rootBoardId: string;
    };
    projectId = project.id;
    await opts.onProject?.(project.id);
    boards.push(project.rootBoardId);
    log(`Seeding ${preset.boards} boards in the project "${name}"…`);
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
        closers.add(board.close);
        try {
          await board.synced;
          board.doc.transact(() => {
            for (let i = 0; i < 20; i++)
              addElement(board.doc, note(newId(), (i % 5) * 260, Math.floor(i / 5) * 200));
          });
          while (board.provider.unsyncedChanges > 0 && !stop.signal.aborted) await pause(20);
        } finally {
          board.close();
          closers.delete(board.close);
        }
      }
    };
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => fill(boards.filter((_, j) => j % 8 === i))),
    );
    socket.destroy();

    if (!stop.signal.aborted) {
      log(`Running for ${opts.durationS} s…`);
      phase = 'running';
      runStart = Date.now();
      const end = runStart + opts.durationS * 1000;
      await Promise.all([
        ...Array.from({ length: preset.editors }, (_, i) => editor(i, end)),
        ...Array.from({ length: preset.readers }, (_, i) => reader(i, preset.editors, end)),
      ]);
    }
  } catch (err) {
    error(String(err));
  } finally {
    phase = 'cleaning';
    for (const close of closers) close();
    for (const socket of sockets) socket.destroy();
    await Promise.resolve(opts.onProgress?.(progress())).catch(() => {});
    // The last boards are saved as their connections close: deleting the project under those
    // saves only makes them fail. Not cut short by a stop.
    if (projectId) await sleep(3000);
    opts.signal.removeEventListener('abort', onStop);
    stop.abort();
    await Promise.all([ticker, watch]);
  }
  const result: Result = {
    preset: opts.presetName,
    url: new URL(origin).origin,
    durationS: opts.durationS,
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
  return { result, projectId, stopped: opts.signal.aborted, aborted };
}
