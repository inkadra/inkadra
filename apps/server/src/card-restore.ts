import { createHash } from 'node:crypto';
import type { Connection, Document } from '@hocuspocus/server';
import {
  type ClipboardData,
  RestoreRefusedError,
  type RestoreResult,
  restoreElements,
} from '@inkadra/canvas-core';
import {
  CONTAINER_TYPES,
  type RestoreCardsRequest,
  type RestoreCardsResult,
  type RestoreRefusal,
  readRestoreCardsRequest,
  roots,
} from '@inkadra/doc-schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import type { Actor } from './access.ts';
import { noteWriter, type PendingWriters } from './board-writers.ts';
import type { Database } from './db/client.ts';
import { elementMove } from './db/schema.ts';
import { AssignmentRefusedError, validateTaskUpdate } from './tasks.ts';
import { stillWritable } from './update-shape.ts';

/**
 * Conditional restores (decision 0142): a client asks, on a board's connection, to put cards
 * back only if none of them is on the board. Hocuspocus handles a connection's messages in order,
 * so every update the client sent before the request is on the board when it is read. The cards
 * are written in a scratch copy of the board under a client id of their own, and what that write
 * adds goes through the checks a client's update gets; then, with no await between the last
 * check and the write, it is applied as an edit of that connection. Within one collab process,
 * two requests, or a request and any update the process already has, never both put the same
 * card back.
 */

/** Requests one person may send for one board in a minute; more are answered `busy`. */
const REQUESTS_PER_MINUTE = 30;
/** How long, and for how many requests per board, a `restored` answer is kept for a resend. */
const ANSWER_KEEP_MS = 15 * 60_000;
const ANSWERS_PER_BOARD = 100;
/** A card key or a column set again during the checks makes the copy stale: built again this often at most. */
const ATTEMPTS = 3;
/** A restore still waiting on the database after this long is answered `busy` and never written. */
const RESTORE_TIMEOUT_MS = 10_000;

interface RestoreContext {
  actor: Actor;
  boardId: string;
}

export interface CardRestoreDeps {
  db: Database;
  log: Logger;
  /**
   * Why this connection may not write to the board now (role, schema, frozen, full, or busy when
   * the process is handing its boards over), or null. Read without an await.
   */
  refusal(connection: Connection, document: Document): RestoreRefusal | null;
  /** What the board's checks say of an update before it is applied (malformed, caps), or null. */
  admit(document: Document, update: Uint8Array): 'invalid' | 'full' | null;
  /** Who wrote under which client id (decision 0120). */
  writersOf(document: Y.Doc): PendingWriters;
  /** The server's own address, as a paste on its boards is given it (decision 0101). */
  instance?: string;
  now?: () => number;
  /** Tests shorten it. */
  timeoutMs?: number;
}

type Built =
  | { answer: RestoreCardsResult }
  | {
      result: RestoreResult;
      /** What the restore adds to the board: its own items, without the board's deletions. */
      update: Uint8Array;
      client: number;
      clock: number;
      /** The Yjs id of the item holding each card's key now, or null. */
      holders: Map<string, Y.ID | null>;
    };

/** The item that holds a key of `elements`, live or deleted: Yjs settles a new set against it. */
function holderOf(document: Y.Doc, id: string): Y.ID | null {
  return roots(document).elements._map.get(id)?.id ?? null;
}

const sameId = (a: Y.ID | null, b: Y.ID | null) =>
  a === b || (!!a && !!b && a.client === b.client && a.clock === b.clock);

/** Whether a card of the board is a live column or scene. */
function liveContainer(document: Y.Doc, id: string) {
  const map = roots(document).elements.get(id);
  return (CONTAINER_TYPES as readonly unknown[]).includes(map?.get('type'));
}

/** Whether any of the cards' data moved off the board (decision 0141). */
async function movedAny(db: Database, boardId: string, ids: string[]) {
  const [row] = await db
    .select({ id: elementMove.elementId })
    .from(elementMove)
    .where(and(eq(elementMove.boardId, boardId), inArray(elementMove.elementId, ids)))
    .limit(1);
  return !!row;
}

/** A request is the same one sent again only with the same copy and point. */
const fingerprint = (request: RestoreCardsRequest) =>
  createHash('sha256')
    .update(JSON.stringify([request.clipboard, request.at]))
    .digest('base64url');

export function createCardRestore(deps: CardRestoreDeps) {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? RESTORE_TIMEOUT_MS;
  /** One restore at a time per board, in the order the requests came. */
  const chains = new WeakMap<Y.Doc, Promise<void>>();
  const answers = new WeakMap<Y.Doc, Map<string, { answer: RestoreCardsResult; at: number }>>();
  /** Requests per person and board, whatever connection they come on. */
  const rates = new WeakMap<Y.Doc, Map<string, { since: number; count: number }>>();

  const refused = (requestId: string, reason: RestoreRefusal): RestoreCardsResult => ({
    type: 'restoreCardsResult',
    requestId,
    outcome: 'refused',
    reason,
  });

  function busy(document: Y.Doc, actorId: string) {
    const at = now();
    const byActor = rates.get(document) ?? new Map();
    rates.set(document, byActor);
    const rate = byActor.get(actorId);
    if (!rate || at - rate.since >= 60_000) {
      byActor.set(actorId, { since: at, count: 1 });
      return false;
    }
    rate.count += 1;
    return rate.count > REQUESTS_PER_MINUTE;
  }

  function remembered(document: Y.Doc, key: string) {
    const memory = answers.get(document);
    const known = memory?.get(key);
    if (!known) return null;
    if (now() - known.at < ANSWER_KEEP_MS) return known.answer;
    memory?.delete(key);
    return null;
  }

  function remember(document: Y.Doc, key: string, answer: RestoreCardsResult) {
    const memory = answers.get(document) ?? new Map();
    answers.set(document, memory);
    memory.set(key, { answer, at: now() });
    for (const oldest of memory.keys()) {
      if (memory.size <= ANSWERS_PER_BOARD) break;
      memory.delete(oldest);
    }
  }

  /** The restore written in a scratch copy of the board, without touching the board. */
  function build(document: Document, request: RestoreCardsRequest): Built {
    let scratch = new Y.Doc();
    // An id nobody wrote under on this board, the server included.
    while (
      scratch.clientID === document.clientID ||
      Y.getState(document.store, scratch.clientID) > 0
    ) {
      scratch.destroy();
      scratch = new Y.Doc();
    }
    try {
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(document));
      // Only what the restore writes: a diff of the whole copy would carry every deletion the
      // board ever had.
      const written: Uint8Array[] = [];
      scratch.on('update', (update: Uint8Array) => written.push(update));
      let result: RestoreResult;
      try {
        result = restoreElements(scratch, request.clipboard as ClipboardData, request.at, {
          instance: deps.instance,
        });
      } catch (err) {
        if (!(err instanceof RestoreRefusedError)) throw err;
        const { requestId } = request;
        return {
          answer:
            err.reason === 'present'
              ? { type: 'restoreCardsResult', requestId, outcome: 'present', present: err.present }
              : refused(requestId, err.reason),
        };
      }
      return {
        result,
        update: written.length === 1 ? (written[0] as Uint8Array) : Y.mergeUpdates(written),
        client: scratch.clientID,
        clock: Y.getState(scratch.store, scratch.clientID) - 1,
        holders: new Map(result.own.map((id) => [id, holderOf(document, id)])),
      };
    } finally {
      scratch.destroy();
    }
  }

  async function restore(
    connection: Connection,
    document: Document,
    request: RestoreCardsRequest,
    /** True once the request was answered `busy` for taking too long: it must not write. */
    late: () => boolean,
  ): Promise<RestoreCardsResult> {
    const context = connection.context as RestoreContext;
    const { requestId } = request;
    const key = `${context.actor.id}:${requestId}:${fingerprint(request)}`;
    const known = remembered(document, key);
    if (known) return { ...known, repeat: true } as RestoreCardsResult;
    /** Why the connection may not write now; read again after every await. */
    const why = () =>
      late() ||
      !stillWritable({
        readOnly: false,
        connected: document.hasConnection(connection),
        socketState: connection.webSocket.readyState,
        documentDestroyed: document.isDestroyed,
      })
        ? 'busy'
        : deps.refusal(connection, document);
    let checkedMoves = false;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const early = why();
      if (early) return refused(requestId, early);
      const built = build(document, request);
      if ('answer' in built) return built.answer;
      if (!checkedMoves) {
        // shortcut: a move of the cards' data that commits after this read is not seen. The web
        // app and the mobile app move data while its cards are still on the board (0141), when
        // this reads `present`; an API client that calls `POST /element-data/move` for cards
        // absent from the board during this window is not. Take the board row as `movedTo` does
        // if that ever matters.
        if (await movedAny(deps.db, context.boardId, built.result.own))
          return refused(requestId, 'moved');
        checkedMoves = true;
      }
      try {
        await validateTaskUpdate(
          deps.db,
          context.boardId,
          context.actor.id,
          document,
          built.update,
        );
      } catch (err) {
        if (err instanceof AssignmentRefusedError) return refused(requestId, 'role');
        throw err;
      }
      // From here to the write there is no await: no other update reaches the board in between.
      const refusal = why();
      if (refusal) return refused(requestId, refusal);
      const { elements } = roots(document);
      const present = built.result.own.filter((id) => elements.has(id));
      if (present.length)
        return { type: 'restoreCardsResult', requestId, outcome: 'present', present };
      // A key set and deleted again, or a column or scene the cards go into removed, during the
      // awaits: the copy would settle against a stale value, or hide the cards. Built again.
      if (
        built.result.own.some(
          (id) => !sameId(holderOf(document, id), built.holders.get(id) ?? null),
        ) ||
        built.result.parents.some((id) => !liveContainer(document, id))
      )
        continue;
      const admitted = deps.admit(document, built.update);
      if (admitted) return refused(requestId, admitted);
      // Decision 0120: the restore goes on the account of the person who asked.
      noteWriter(deps.writersOf(document), built.client, context.actor.id, built.clock);
      // As this connection's own edit: its onChange checks run, and every client gets it.
      Y.applyUpdate(document, built.update, { source: 'connection', connection });
      // The update goes out before the answer, which clients must still not rely on.
      document.flush();
      const { ids, outside, own } = built.result;
      const answer: RestoreCardsResult = {
        type: 'restoreCardsResult',
        requestId,
        outcome: 'restored',
        ids,
        outside,
        own,
      };
      remember(document, key, answer);
      return answer;
    }
    return refused(requestId, 'busy');
  }

  /**
   * Handles a stateless message from a client: null when it is not a restore. The promise never
   * rejects (Hocuspocus does not wait for stateless hooks): an error is logged and answered `busy`.
   */
  function handle(connection: Connection, document: Document, payload: string) {
    const read = readRestoreCardsRequest(payload);
    if (!read) return null;
    const context = connection.context as Partial<RestoreContext> | undefined;
    const boardId = context?.boardId;
    const send = (answer: RestoreCardsResult) => {
      try {
        connection.sendStateless(JSON.stringify(answer));
      } catch (err) {
        deps.log.warn({ err, boardId }, 'card restore answer not sent');
      }
    };
    if ('refused' in read) {
      if (read.requestId) send(refused(read.requestId, read.refused));
      return Promise.resolve();
    }
    const { requestId } = read.request;
    if (busy(document, context?.actor?.id ?? '')) {
      send(refused(requestId, 'busy'));
      return Promise.resolve();
    }
    const run = (chains.get(document) ?? Promise.resolve()).then(() => {
      // A request stuck on the database is answered `busy` and gives the board to the next one;
      // it checks `late` before writing, so it never writes after that answer.
      let expired = false;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<RestoreCardsResult>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          resolve(refused(requestId, 'busy'));
        }, timeoutMs);
      });
      const work = restore(connection, document, read.request, () => expired);
      // Its own failure after the timeout is logged, never left unhandled.
      work.catch((err: unknown) => {
        if (expired) deps.log.error({ err, boardId }, 'card restore failed after its timeout');
      });
      return Promise.race([work, timeout])
        .finally(() => clearTimeout(timer))
        .then(send, (err: unknown) => {
          deps.log.error({ err, boardId }, 'card restore failed');
          send(refused(requestId, 'busy'));
        });
    });
    chains.set(document, run);
    return run;
  }

  return { handle };
}
