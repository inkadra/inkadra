// The `dense` scenario of the load test: many editors with moving cursors on ONE heavy board,
// then a reconnect burst, as after a restart of the collaboration role. CLI only
// (scripts/loadtest/run.ts): Settings → Server keeps the presets of report.ts, which spread
// people over many light boards. See docs/self-hosting/capacity.md.
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { addStroke } from '@inkadra/canvas-core';
import { addElement, roots } from '@inkadra/doc-schema';
import { generateReferenceBoard } from '@inkadra/doc-schema/reference-board';
import * as Y from 'yjs';
import { type ClientTarget, collabClients } from './generator.ts';
import {
  evaluate,
  formatReport,
  type Limits,
  type Result,
  readServer,
  type Sample,
  type ServerReading,
  summarizeServer,
} from './report.ts';

export interface DenseLimits extends Limits {
  /** From the reconnect of every client until the last one is synced and its edits saved. */
  burstSyncMs: number;
  /**
   * Event loop delay p99 of the process answering /metrics, the worst 5 s window. A limit only
   * when that process also holds the boards (`all`); in split mode it is the web role's.
   */
  eventLoopP99Ms: number;
}

export interface DensePreset {
  editors: number;
  readers: number;
  durationS: number;
  /** The reference board (decision 0093) the board is seeded with. */
  board: 'small' | 'medium' | 'large';
  limits: DenseLimits;
}

/** How often each editor moves its cursor: the web app sends at most one every 50 ms. */
const CURSOR_MS: [number, number] = [50, 100];
/** One edit a second per editor, one in five a stroke drawn on a frame. */
const EDIT_MS = 1000;
const STROKE_SHARE = 0.2;
/** Frames this full get no more strokes (MAX_STROKES is 2000). */
const FULL_FRAME = 1500;

// Limits from two CI runs per mode (22 November 2026, docs/self-hosting/capacity.md), with the
// headroom of the presets: they catch a regression of several times, not a few percent. Worst
// seen there: edit p99 358 ms, board save p95 498 ms, 739 MiB, burst 817 ms, event loop 381 ms.
export const DENSE: DensePreset = {
  editors: 15,
  readers: 3,
  durationS: 180,
  board: 'medium',
  limits: {
    editP95Ms: 750,
    editP99Ms: 2000,
    deliveryP95Ms: 1500,
    storeP95Ms: 3000,
    poolWaitMaxMs: 2000,
    rssMiB: 2048,
    perBoardMiB: 8,
    // The medium reference board alone is about 7.5 MB encoded: twice that catches a document
    // that keeps growing. The 256 KiB of the presets is a mean over light boards.
    docPerBoardKiB: 16384,
    errors: 0,
    reconnects: 15,
    burstSyncMs: 15_000,
    eventLoopP99Ms: 1500,
  },
};

export interface DenseResult extends Omit<Result, 'preset'> {
  preset: 'dense';
  board: { elements: number; frames: number; strokes: number; bytes: number };
  /** Cursor moves the editors published. */
  cursors: number;
  strokes: number;
  burst: {
    clients: number;
    /** The server had closed the board before they came back; null without metrics. */
    unloaded: boolean | null;
    /** Null when not every client synced again. */
    syncMs: number | null;
    /** Every client and a fresh one hold the same document, with every offline edit. */
    converged: boolean;
    detail: string | null;
  } | null;
  /** Null without METRICS_TOKEN or from a server that does not report it. */
  eventLoopP99MaxMs: number | null;
  /** True when the process answering /metrics holds the boards too (`all`). */
  eventLoopShared: boolean;
}

export interface DenseOptions extends ClientTarget {
  preset: DensePreset;
  durationS: number;
  signal: AbortSignal;
  /** The samples of /metrics; null without a token. */
  metrics(): Promise<Sample[] | null>;
  log?(message: string): void;
  onProject?(projectId: string): Promise<void> | void;
}

const newId = () => `lt_${randomBytes(8).toString('hex')}`;
const LOOP_METRIC = 'inkadra_web_event_loop_delay_p99_seconds';

/**
 * Same document: the same state vector and the same delete set. Equal vectors alone miss a
 * deletion that reached one replica only (deletions add no clock). The delete set of a snapshot
 * is built from maximal runs of deleted items, so items split differently compare equal.
 */
export function sameDocument(a: Y.Doc, b: Y.Doc) {
  return Y.equalSnapshots(Y.snapshot(a), Y.snapshot(b));
}

export async function runDense(opts: DenseOptions) {
  const { preset } = opts;
  const log = opts.log ?? (() => {});
  const stop = new AbortController();
  const onStop = () => stop.abort();
  opts.signal.addEventListener('abort', onStop);
  if (opts.signal.aborted) stop.abort();
  const pause = (ms: number) => sleep(ms, undefined, { signal: stop.signal }).catch(() => {});
  const errors: string[] = [];
  const error = (what: string) => {
    if (!stop.signal.aborted) errors.push(what);
  };
  const { api, connect, open } = collabClients(opts, error, pause);

  const readings: ServerReading[] = [];
  let loopMax: number | null = null;
  let loopShared = false;
  async function scrape(keep: boolean) {
    try {
      const samples = await opts.metrics();
      if (!samples) return null;
      const reading = readServer(samples);
      if (keep) {
        readings.push(reading);
        const loop = samples.find((s) => s.name === LOOP_METRIC);
        if (loop) loopMax = Math.max(loopMax ?? 0, loop.value * 1000);
        loopShared ||= reading.shared;
      }
      return reading;
    } catch (err) {
      error(String(err));
      return null;
    }
  }

  const editMs: number[] = [];
  const deliveryMs: number[] = [];
  const sentAt = new Map<number, number>();
  let counter = 0;
  let edits = 0;
  let strokes = 0;
  let cursors = 0;
  let opens = 0;
  let reconnects = 0;
  let measuring = false;
  let projectId: string | undefined;
  const sockets: HocuspocusProviderWebsocket[] = [];
  const boards: Array<ReturnType<typeof open>> = [];
  /** Connections outside `sockets` and `boards` (the seeder), closed at the end whatever happens. */
  const others: Array<() => void> = [];
  let boardInfo: DenseResult['board'] = { elements: 0, frames: 0, strokes: 0, bytes: 0 };
  let burst: DenseResult['burst'] = null;
  let baseline: ServerReading | null = null;

  const watch = (async () => {
    while (!stop.signal.aborted) {
      await pause(5000);
      if (measuring) await scrape(true);
    }
  })();

  const socketOf = () => {
    const socket = connect();
    sockets.push(socket);
    socket.on('disconnect', () => {
      if (measuring && !stop.signal.aborted) reconnects += 1;
    });
    return socket;
  };
  const openBoard = async (boardId: string) => {
    const board = open(socketOf(), boardId, 120_000);
    boards.push(board);
    await board.synced;
    opens += 1;
    return board;
  };
  const acked = (board: ReturnType<typeof open>) =>
    board.provider.synced && board.provider.unsyncedChanges === 0;
  /** Waits until every board is synced and its edits saved; the time it took, or null. */
  const settle = async (list: Array<ReturnType<typeof open>>, timeoutMs: number) => {
    const started = performance.now();
    while (!list.every(acked)) {
      if (stop.signal.aborted || performance.now() - started > timeoutMs) return null;
      await pause(20);
    }
    return performance.now() - started;
  };

  const editors: Array<{ board: ReturnType<typeof open>; note: string; value: number }> = [];

  async function editor(index: number, frames: string[], end: number) {
    const board = await openBoard(boardIdOf());
    const note = newId();
    const me = { board, note, value: 0 };
    editors[index] = me;
    addElement(board.doc, {
      id: note,
      type: 'note',
      x: index * 300,
      y: -30_000,
      w: 240,
      z: 'a0',
      parent: null,
      createdBy: null,
      createdAt: Date.now(),
    });
    let started = 0;
    board.provider.on('unsyncedChanges', ({ number }: { number: number }) => {
      if (number === 0 && started && Date.now() < end) {
        editMs.push(performance.now() - started);
        started = 0;
      }
    });
    const cursor = { x: Math.random() * 4000, y: Math.random() * 3000 };
    let nextEdit = Date.now() + Math.random() * EDIT_MS;
    while (Date.now() < end && !stop.signal.aborted) {
      cursor.x += (Math.random() - 0.5) * 80;
      cursor.y += (Math.random() - 0.5) * 60;
      board.provider.awareness?.setLocalState({
        cursor: { ...cursor },
        selection: [note],
        editing: null,
      });
      cursors += 1;
      if (Date.now() >= nextEdit) {
        nextEdit += EDIT_MS * (0.8 + Math.random() * 0.4);
        if (board.provider.unsyncedChanges === 0) started = performance.now();
        const frame = frames[Math.floor(Math.random() * frames.length)];
        if (frame && Math.random() < STROKE_SHARE) {
          addStroke(board.doc, frame, strokeOf());
          strokes += 1;
        } else {
          me.value = ++counter;
          sentAt.set(me.value, performance.now());
          board.doc.transact(() => roots(board.doc).elements.get(note)?.set('x', me.value));
        }
        edits += 1;
      }
      await pause(CURSOR_MS[0] + Math.random() * (CURSOR_MS[1] - CURSOR_MS[0]));
    }
  }

  async function reader(end: number) {
    const board = await openBoard(boardIdOf());
    roots(board.doc).elements.observeDeep((events) => {
      for (const event of events)
        if (measuring && event instanceof Y.YMapEvent && event.keysChanged.has('x')) {
          const at = sentAt.get(event.target.get('x') as number);
          if (at !== undefined) deliveryMs.push(performance.now() - at);
        }
    });
    while (Date.now() < end && !stop.signal.aborted) await pause(250);
  }

  let rootBoard = '';
  const boardIdOf = () => rootBoard;

  try {
    baseline = await scrape(false);
    for (let i = 0; baseline && baseline.rssBytes === 0 && i < 15 && !stop.signal.aborted; i++) {
      await pause(2000);
      baseline = await scrape(false);
    }
    const name = `Load test ${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const project = (await (await api('POST', '/api/v1/projects', { name })).json()) as {
      id: string;
      rootBoardId: string;
    };
    projectId = project.id;
    rootBoard = project.rootBoardId;
    await opts.onProject?.(project.id);

    log(`Building the ${preset.board} reference board…`);
    const reference = generateReferenceBoard(preset.board, 1);
    log(
      `Seeding it (${Math.round(reference.update.length / 1024)} KiB, ${reference.summary.elements.total} cards) in "${name}"…`,
    );
    const seederSocket = connect();
    others.push(() => seederSocket.destroy());
    const seeder = open(seederSocket, rootBoard, 120_000);
    others.push(seeder.close);
    await seeder.synced;
    Y.applyUpdate(seeder.doc, reference.update);
    // The reference board names its own board id; this one is the board's (later, so it wins).
    seeder.doc.transact(() => roots(seeder.doc).meta.set('boardId', rootBoard));
    if ((await settle([seeder], 120_000)) === null) throw new Error('The seed was not saved');
    const frames: string[] = [];
    let frameStrokes = 0;
    for (const [id, card] of roots(seeder.doc).elements) {
      const list = card.get('strokes');
      if (card.get('type') !== 'frame' || !(list instanceof Y.Array) || !list.length) continue;
      frameStrokes += list.length;
      if (list.length < FULL_FRAME) frames.push(id);
    }
    boardInfo = {
      elements: roots(seeder.doc).elements.size,
      frames: frames.length,
      strokes: frameStrokes,
      bytes: Y.encodeStateAsUpdate(seeder.doc).length,
    };
    seeder.close();
    seederSocket.destroy();
    others.length = 0;

    if (!stop.signal.aborted) {
      log(
        `${preset.editors} editors and ${preset.readers} readers on one board for ${opts.durationS} s…`,
      );
      await scrape(false); // the event loop delay of the seeding is not the run's
      measuring = true;
      const end = Date.now() + opts.durationS * 1000;
      // People arrive within a few seconds, not in the same millisecond (that is the burst).
      await Promise.all([
        ...Array.from({ length: preset.editors }, (_, i) =>
          pause(i * 200).then(() => editor(i, frames, end)),
        ),
        ...Array.from({ length: preset.readers }, (_, i) =>
          pause(i * 200 + 100).then(() => reader(end)),
        ),
      ]).catch((err) => error(String(err)));
    }

    if (!stop.signal.aborted && editors.filter(Boolean).length === preset.editors) {
      log('Reconnect burst: every client drops, edits offline, and comes back at once…');
      await settle(boards, 30_000);
      measuring = false;
      for (const socket of sockets) socket.disconnect();
      for (const e of editors) {
        e.value = ++counter;
        e.board.doc.transact(() => roots(e.board.doc).elements.get(e.note)?.set('x', e.value));
      }
      // As after a restart: the server has unloaded the board and reads it back from the
      // database. Without metrics, a fixed wait.
      let unloaded: boolean | null = null;
      for (let i = 0; i < 30 && !stop.signal.aborted; i++) {
        await pause(1000);
        const reading = await scrape(false);
        unloaded = reading && reading.openBoards === 0;
        if (reading ? unloaded && i >= 5 : i >= 10) break;
      }
      measuring = true;
      const clients = sockets.length;
      for (const socket of sockets) socket.connect();
      const syncMs = await settle(boards, 120_000);
      let converged = false;
      let detail: string | null = syncMs === null ? 'not every client synced again' : null;
      if (syncMs !== null) {
        // Everyone's offline edit reaches everyone else; then a fresh client checks the server.
        const fresh = await openBoard(rootBoard).catch((err) => {
          detail = String(err);
          return null;
        });
        const deadline = performance.now() + 30_000;
        while (fresh && !stop.signal.aborted) {
          const lagging = boards.filter((b) => !sameDocument(b.doc, fresh.doc)).length;
          // Every offline edit on every replica, the fresh one included.
          const missing = boards.reduce(
            (n, b) =>
              n +
              editors.filter((e) => roots(b.doc).elements.get(e.note)?.get('x') !== e.value).length,
            0,
          );
          converged = lagging === 0 && missing === 0;
          if (converged || performance.now() > deadline) {
            if (!converged) detail = `${lagging} clients differ, ${missing} offline edits missing`;
            break;
          }
          await pause(250);
        }
      }
      burst = { clients, unloaded, syncMs, converged, detail };
      await scrape(true);
    }
  } catch (err) {
    error(String(err));
  } finally {
    measuring = false;
    for (const board of boards) board.close();
    for (const socket of sockets) socket.destroy();
    for (const close of others) close();
    // The last saves happen as the connections close (see runLoad).
    if (projectId) await sleep(3000);
    opts.signal.removeEventListener('abort', onStop);
    stop.abort();
    await watch;
  }
  const result: DenseResult = {
    preset: 'dense',
    url: new URL(opts.origin ?? opts.baseUrl).origin,
    durationS: opts.durationS,
    editors: preset.editors,
    readers: preset.readers,
    boards: 1,
    edits,
    editMs,
    deliveryMs,
    switches: opens,
    uploads: { ok: 0, failed: 0 },
    errors,
    reconnects,
    server: baseline ? summarizeServer(baseline, readings) : null,
    board: boardInfo,
    cursors,
    strokes,
    burst,
    eventLoopP99MaxMs: loopMax,
    eventLoopShared: loopShared,
  };
  return { result, projectId, stopped: opts.signal.aborted };
}

/** A stroke as a pencil draws it: 8 to 60 points in the frame's grid. */
function strokeOf() {
  const points: number[] = [];
  let x = Math.floor(Math.random() * 4096);
  let y = Math.floor(Math.random() * 4096);
  for (let i = 8 + Math.floor(Math.random() * 53); i > 0; i--) {
    x = Math.max(0, Math.min(4096, x + Math.round((Math.random() - 0.5) * 160)));
    y = Math.max(0, Math.min(4096, y + Math.round((Math.random() - 0.5) * 160)));
    points.push(x, y);
  }
  return { tool: 'pencil' as const, color: '#1F2328', width: 3, points };
}

/** What `evaluate` checks, plus the burst and the event loop. */
export function evaluateDense(r: DenseResult, limits: DenseLimits): string[] {
  const out = evaluate(r, limits);
  if (!r.burst) out.push('the reconnect burst did not run');
  else {
    if (r.burst.syncMs === null) out.push(`reconnect burst: ${r.burst.detail}`);
    else if (r.burst.syncMs > limits.burstSyncMs)
      out.push(`reconnect burst ${Math.round(r.burst.syncMs)} ms > ${limits.burstSyncMs} ms`);
    if (r.burst.syncMs !== null && !r.burst.converged)
      out.push(`reconnect burst did not converge: ${r.burst.detail}`);
  }
  if (
    r.eventLoopShared &&
    r.eventLoopP99MaxMs !== null &&
    r.eventLoopP99MaxMs > limits.eventLoopP99Ms
  )
    out.push(
      `event loop delay p99 ${Math.round(r.eventLoopP99MaxMs)} ms > ${limits.eventLoopP99Ms} ms`,
    );
  return out;
}

export function formatDense(r: DenseResult, limits: DenseLimits, failures: string[]): string {
  const base = formatReport(r, limits, failures).split('\n');
  // The verdict stays last.
  const verdict = base.splice(base.lastIndexOf(''));
  const ms = (v: number | null) => (v === null ? '–' : `${Math.round(v)} ms`);
  const b = r.burst;
  base.push(
    `Board                 ${r.board.elements} cards, ${r.board.frames} frames with ${r.board.strokes} strokes, ${Math.round(r.board.bytes / 1024)} KiB seeded`,
    `Presence              ${r.cursors} cursor moves, ${r.strokes} strokes drawn`,
    `Event loop p99        worst ${ms(r.eventLoopP99MaxMs)}   ${
      r.eventLoopShared
        ? `limit ${limits.eventLoopP99Ms} ms`
        : '(info) of the web role, not the boards'
    }`,
    b
      ? `Reconnect burst       ${b.clients} clients${b.unloaded ? ' (board reloaded)' : ''} synced in ${ms(b.syncMs)}, ${b.converged ? 'converged' : `NOT converged (${b.detail})`}   limit ${limits.burstSyncMs} ms`
      : 'Reconnect burst       did not run',
  );
  return [...base, ...verdict].join('\n');
}
