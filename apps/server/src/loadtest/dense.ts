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
import type { BoardPreview } from '@inkadra/shared';
import * as Y from 'yjs';
import { projectBoard } from '../board-preview.ts';
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
  /** The same during the burst, when every client comes back at once. */
  burstEventLoopP99Ms: number;
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
/** How long the burst leaves the board alone: a store on the last close, then the unload. */
const UNLOAD_WAIT_MS = 15_000;
/** The offline markers sit above every other card (the reference board ends at -20,000). */
const MARKER_Y = -50_000;
/** Share of the expected edits (one a second per editor) that must come back timed. */
const MIN_SAMPLE_SHARE = 0.5;
/** Frames this full get no more strokes (MAX_STROKES is 2000). */
const FULL_FRAME = 1500;

// Limits from CI runs (22 November 2026, docs/self-hosting/capacity.md), with the headroom of
// the presets: they catch a regression of several times, not a few percent. Worst seen there:
// edit p99 555 ms, board save p95 1878 ms, 849 MiB, event loop 808 ms in the steady run; in the
// burst (15 card additions sent at once) 9.4 s to sync and 3.2 s of event loop.
export const DENSE: DensePreset = {
  editors: 15,
  readers: 3,
  durationS: 180,
  board: 'medium',
  limits: {
    editP95Ms: 750,
    editP99Ms: 2000,
    deliveryP95Ms: 1500,
    // Saves of the burst and of everyone leaving count too: up to 1.9 s on CI.
    storeP95Ms: 6000,
    poolWaitMaxMs: 2000,
    rssMiB: 2048,
    perBoardMiB: 8,
    // The medium reference board alone is about 7.5 MB encoded: twice that catches a document
    // that keeps growing. The 256 KiB of the presets is a mean over light boards.
    docPerBoardKiB: 16384,
    errors: 0,
    reconnects: 15,
    burstSyncMs: 30_000,
    eventLoopP99Ms: 3000,
    burstEventLoopP99Ms: 10_000,
  },
};

export interface DenseResult extends Omit<Result, 'preset'> {
  preset: 'dense';
  seed: number;
  board: { elements: number; frames: number; strokes: number; bytes: number };
  /** Cursor moves the editors published. */
  cursors: number;
  /** Edits of the run still not acknowledged 30 s after its end. */
  pendingEdits: number;
  strokes: number;
  burst: {
    clients: number;
    /** From the reconnect until every client synced and saved; null when one did not. */
    syncMs: number | null;
    /**
     * Every client and a fresh one hold the same document (state vector and delete set) with
     * every offline edit; the time a fresh client took to open and agree.
     */
    converged: boolean;
    convergeMs: number | null;
    detail: string | null;
    /** Null when the burst did not converge, so there was nothing to check. */
    persistence: Persistence | null;
  } | null;
  /**
   * The worst event loop delay p99 of a 5 s window of the process answering /metrics, in the
   * steady run and in the burst (reconnect to convergence); null without METRICS_TOKEN or from a
   * server that does not report it. The load clients run on the same machine as the server in
   * CI, so the number is of the server under this whole load, not of one cause.
   */
  eventLoop: { steadyMs: number | null; burstMs: number | null };
  /** True when the process answering /metrics holds the boards too (`all`). */
  eventLoopShared: boolean;
}

/**
 * After the burst everyone leaves. `stored`: the board's preview, which the server computes from
 * the document stored in the database and never from the open one, shows every offline marker
 * card (their count and their labels); `storeMs` is how long that took. `reopened`: a client
 * opening the board afterwards gets the same document with every offline edit. Whether the
 * server served that one from memory or from the database cannot be seen from outside.
 */
export interface Persistence {
  stored: boolean;
  storeMs: number | null;
  reopened: boolean;
  detail: string | null;
}

export interface DenseOptions extends ClientTarget {
  preset: DensePreset;
  /** Seeds the moves (timing jitter, cursors, frames, strokes); ids stay random. */
  seed: number;
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
  const loopMax: { steadyMs: number | null; burstMs: number | null } = {
    steadyMs: null,
    burstMs: null,
  };
  let phase: 'steadyMs' | 'burstMs' = 'steadyMs';
  let loopShared = false;
  async function scrape(keep: boolean) {
    try {
      const samples = await opts.metrics();
      if (!samples) return null;
      const reading = readServer(samples);
      if (keep) {
        readings.push(reading);
        const loop = samples.find((s) => s.name === LOOP_METRIC);
        if (loop) loopMax[phase] = Math.max(loopMax[phase] ?? 0, loop.value * 1000);
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

  interface Editor {
    board: ReturnType<typeof open>;
    note: string;
    value: number;
    /** Edits of the run still waiting for their acknowledgement. */
    pending(): number;
    /** The card it adds while offline in the burst. */
    marker: string;
  }
  const editors: Editor[] = [];
  let pendingEdits = 0;

  async function editor(index: number, frames: string[], end: number) {
    const board = await openBoard(boardIdOf());
    const note = newId();
    const me: Editor = { board, note, value: 0, pending: () => 0, marker: newId() };
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
    // Each edit timed to its own acknowledgement: the provider counts the updates it sent that
    // the server has not acknowledged yet, and the server acknowledges one connection's updates
    // in the order they came. `timed` marks the edits of the run, not the note's creation.
    const waiting: Array<{ at: number; timed: boolean }> = [];
    let timing = false;
    let last = board.provider.unsyncedChanges;
    board.provider.on('unsyncedChanges', ({ number }: { number: number }) => {
      const now = performance.now();
      for (let i = last; i < number; i++) waiting.push({ at: now, timed: timing });
      for (let i = number; i < last; i++) {
        const sent = waiting.shift();
        if (sent?.timed) editMs.push(now - sent.at);
      }
      last = number;
    });
    // A closed connection forgets what it waited for; the sync after it counts again from one.
    board.provider.on('close', () => {
      waiting.length = 0;
      last = 0;
    });
    me.pending = () => waiting.filter((w) => w.timed).length;
    // Its own stream of the run's seed: the same seed gives each editor the same moves.
    const random = seeded(opts.seed + index * 7919);
    const cursor = { x: random() * 4000, y: random() * 3000 };
    let nextEdit = Date.now() + random() * EDIT_MS;
    while (Date.now() < end && !stop.signal.aborted) {
      cursor.x += (random() - 0.5) * 80;
      cursor.y += (random() - 0.5) * 60;
      board.provider.awareness?.setLocalState({
        cursor: { ...cursor },
        selection: [note],
        editing: null,
      });
      cursors += 1;
      if (Date.now() >= nextEdit) {
        nextEdit += EDIT_MS * (0.8 + random() * 0.4);
        timing = true;
        const frame = frames[Math.floor(random() * frames.length)];
        if (frame && random() < STROKE_SHARE) {
          addStroke(board.doc, frame, strokeOf(random));
          strokes += 1;
        } else {
          me.value = ++counter;
          sentAt.set(me.value, performance.now());
          board.doc.transact(() => roots(board.doc).elements.get(note)?.set('x', me.value));
        }
        timing = false;
        edits += 1;
      }
      await pause(CURSOR_MS[0] + random() * (CURSOR_MS[1] - CURSOR_MS[0]));
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

  /** Offline edits of the burst this replica lacks: a note not moved, a marker missing. */
  const missingMarks = (doc: Y.Doc) =>
    editors.filter(
      (e) =>
        roots(doc).elements.get(e.note)?.get('x') !== e.value || !roots(doc).elements.has(e.marker),
    ).length;

  /** Everyone leaves; then the stored board and a client that opens it again are checked. */
  async function persisted(converged: Y.Doc): Promise<Persistence> {
    const expected = projectBoard(Y.encodeStateAsUpdate(converged)).preview;
    const want = JSON.stringify([expected.elementCount, expected.excerpts]);
    for (const socket of sockets) socket.disconnect();
    const started = performance.now();
    let storeMs: number | null = null;
    let seen = '';
    while (!stop.signal.aborted && performance.now() - started < 60_000) {
      try {
        const preview = (await (
          await api('GET', `/api/v1/boards/${rootBoard}/preview`)
        ).json()) as BoardPreview;
        seen = JSON.stringify([preview.elementCount, preview.excerpts]);
        if (seen === want) {
          storeMs = performance.now() - started;
          break;
        }
      } catch (err) {
        seen = String(err);
      }
      await pause(1000);
    }
    const stored = storeMs !== null;
    let reopened = false;
    let detail: string | null = stored ? null : `stored board shows ${seen}, expected ${want}`;
    await pause(UNLOAD_WAIT_MS);
    try {
      const again = await openBoard(rootBoard);
      reopened = sameDocument(again.doc, converged) && missingMarks(again.doc) === 0;
      if (!reopened) detail = `${detail ? `${detail}; ` : ''}a client opening it again differs`;
    } catch (err) {
      detail = `${detail ? `${detail}; ` : ''}${String(err)}`;
    }
    return { stored, storeMs, reopened, detail };
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
      pendingEdits = editors.reduce((n, e) => n + e.pending(), 0);
      measuring = false;
      for (const socket of sockets) socket.disconnect();
      // Offline, each editor moves its note and adds a marker card above everything else on the
      // board, where the stored preview lists the first texts.
      for (const [i, e] of editors.entries()) {
        e.value = ++counter;
        e.board.doc.transact(() => roots(e.board.doc).elements.get(e.note)?.set('x', e.value));
        addElement(e.board.doc, {
          id: e.marker,
          type: 'color',
          hex: '#1F2328',
          label: `offline ${i} ${opts.seed}`,
          x: i * 300,
          y: MARKER_Y - i,
          w: 160,
          z: 'a0',
          parent: null,
          createdBy: null,
          createdAt: Date.now(),
        });
      }
      // As after a restart, the server should close the board and read it back from the
      // database: it stores it when the last connection goes, then unloads it. Nothing outside
      // the server tells whether it did (`inkadra_collab_open_boards` counts boards with people
      // on them, not documents in memory), so the burst does not claim a reload: it waits the
      // time a store and unload take, and the persistence check below reads the database.
      await pause(UNLOAD_WAIT_MS);
      await scrape(false); // the window of the burst starts here
      phase = 'burstMs';
      measuring = true;
      const clients = sockets.length;
      for (const socket of sockets) socket.connect();
      const syncMs = await settle(boards, 120_000);
      let converged = false;
      let convergeMs: number | null = null;
      let detail: string | null = syncMs === null ? 'not every client synced again' : null;
      let fresh: ReturnType<typeof open> | null = null;
      if (syncMs !== null) {
        // Everyone's offline edits reach everyone else, and a fresh client agrees.
        const started = performance.now();
        fresh = await openBoard(rootBoard).catch((err) => {
          detail = String(err);
          return null;
        });
        const deadline = started + 30_000;
        while (fresh && !stop.signal.aborted) {
          const target = fresh.doc;
          const lagging = boards.filter((b) => !sameDocument(b.doc, target)).length;
          const missing = boards.reduce((n, b) => n + missingMarks(b.doc), 0);
          converged = lagging === 0 && missing === 0;
          if (converged) convergeMs = performance.now() - started;
          if (converged || performance.now() > deadline) {
            if (!converged) detail = `${lagging} clients differ, ${missing} offline edits missing`;
            break;
          }
          await pause(250);
        }
      }
      await scrape(true);
      // Leaving on purpose from here: not reconnects.
      measuring = false;
      const persistence = fresh && converged ? await persisted(fresh.doc) : null;
      burst = { clients, syncMs, convergeMs, converged, detail, persistence };
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
    seed: opts.seed,
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
    pendingEdits,
    strokes,
    burst,
    eventLoop: loopMax,
    eventLoopShared: loopShared,
  };
  return { result, projectId, stopped: opts.signal.aborted };
}

/** mulberry32: small, fast and good enough to pick moves; the same seed, the same moves. */
export function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** A stroke as a pencil draws it: 8 to 60 points in the frame's grid. */
function strokeOf(random: () => number) {
  const points: number[] = [];
  let x = Math.floor(random() * 4096);
  let y = Math.floor(random() * 4096);
  for (let i = 8 + Math.floor(random() * 53); i > 0; i--) {
    x = Math.max(0, Math.min(4096, x + Math.round((random() - 0.5) * 160)));
    y = Math.max(0, Math.min(4096, y + Math.round((random() - 0.5) * 160)));
    points.push(x, y);
  }
  return { tool: 'pencil' as const, color: '#1F2328', width: 3, points };
}

/** What `evaluate` checks, plus the burst and the event loop. */
export function evaluateDense(r: DenseResult, limits: DenseLimits): string[] {
  const out = evaluate(r, limits);
  // About one edit a second per editor: a run with far fewer samples says nothing.
  const minimum = Math.floor(r.editors * r.durationS * MIN_SAMPLE_SHARE);
  if (r.editMs.length < minimum)
    out.push(`only ${r.editMs.length} edit round trips measured, at least ${minimum} needed`);
  if (r.pendingEdits > 0)
    out.push(`${r.pendingEdits} edits not acknowledged 30 s after the end of the run`);
  if (!r.burst) out.push('the reconnect burst did not run');
  else {
    if (r.burst.syncMs === null) out.push(`reconnect burst: ${r.burst.detail}`);
    else if (r.burst.syncMs > limits.burstSyncMs)
      out.push(`reconnect burst ${Math.round(r.burst.syncMs)} ms > ${limits.burstSyncMs} ms`);
    if (r.burst.syncMs !== null && !r.burst.converged)
      out.push(`reconnect burst did not converge: ${r.burst.detail}`);
    const p = r.burst.persistence;
    if (r.burst.converged && !(p?.stored && p.reopened))
      out.push(`offline edits not persisted: ${p?.detail ?? 'not checked'}`);
  }
  if (r.eventLoopShared)
    for (const [what, value, limit] of [
      ['steady run', r.eventLoop.steadyMs, limits.eventLoopP99Ms],
      ['burst', r.eventLoop.burstMs, limits.burstEventLoopP99Ms],
    ] as const)
      if (value !== null && value > limit)
        out.push(`event loop delay p99 (${what}) ${Math.round(value)} ms > ${limit} ms`);
  return out;
}

export function formatDense(r: DenseResult, limits: DenseLimits, failures: string[]): string {
  // Opening the one board, not moving between boards as in the presets.
  const base = formatReport(r, limits, failures)
    .split('\n')
    .map((line) =>
      line.startsWith('Edits ')
        ? `Edits                 ${r.edits} (${r.strokes} of them strokes; ${r.switches} openings of the board)`
        : line,
    );
  // The verdict stays last.
  const verdict = base.splice(base.lastIndexOf(''));
  const ms = (v: number | null) => (v === null ? '–' : `${Math.round(v)} ms`);
  const b = r.burst;
  base.push(
    `Seed                  ${r.seed} (moves, cursors and strokes; ids are random)`,
    `Readers               ${r.readers} connections of the same account that only observe`,
    `Board                 ${r.board.elements} cards, ${r.board.frames} frames with ${r.board.strokes} strokes, ${Math.round(r.board.bytes / 1024)} KiB seeded`,
    `Presence              ${r.cursors} cursor moves, ${r.strokes} strokes drawn`,
    'Timing                edit round trip: each edit until the server acknowledged it;',
    '                      delivery: each value a reader received (one overwritten first is not)',
    `Unacknowledged edits  ${r.pendingEdits} 30 s after the end   limit 0`,
    `Event loop p99        worst steady ${ms(r.eventLoop.steadyMs)}, burst ${ms(r.eventLoop.burstMs)}   ${
      r.eventLoopShared
        ? `limit ${limits.eventLoopP99Ms} / ${limits.burstEventLoopP99Ms} ms`
        : '(info) of the web role, not the boards'
    }`,
    ...(b
      ? [
          `Reconnect burst       ${b.clients} clients synced in ${ms(b.syncMs)}   limit ${limits.burstSyncMs} ms`,
          `  converged           ${b.converged ? `yes, a fresh client agreed in ${ms(b.convergeMs)}` : `NO (${b.detail})`}`,
          `  stored              ${
            b.persistence
              ? `${b.persistence.stored ? `in the database after ${ms(b.persistence.storeMs)}` : 'NO'}, ${b.persistence.reopened ? 'reopened intact' : 'NOT reopened intact'}${b.persistence.detail ? ` (${b.persistence.detail})` : ''}`
              : 'not checked'
          }`,
          '  reload              not observable from outside the server: not claimed',
        ]
      : ['Reconnect burst       did not run']),
  );
  return [...base, ...verdict].join('\n');
}
