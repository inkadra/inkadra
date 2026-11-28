// SPDX-License-Identifier: MPL-2.0
import { z } from 'zod';
import { ElementId } from './elements.ts';

/**
 * A conditional restore (decision 0142): a client asks the collaboration server, on the board's
 * own connection, to put cards back only if none of them is on the board. The server checks and
 * writes in one step, after every update this connection sent before, and answers this connection
 * alone. Servers handle it only with the `conditional-restore` capability; an older server never
 * answers, so a client never sends it without the capability. These are stateless messages
 * (Hocuspocus `stateless`, JSON text), not board notices: `readBoardNotice` does not read them.
 */

/** At most this many cards in one request, as in one paste. */
export const RESTORE_CARDS_MAX = 500;
/** The longest request, in UTF-16 code units of its JSON text. */
export const RESTORE_CARDS_MAX_LENGTH = 1024 * 1024;

const Point = z.object({ x: z.number(), y: z.number() });

/**
 * The cards, as `copyElements` in canvas-core writes them. Only the outline is checked here: the
 * server reads the cards as a paste reads them (`restoreElements`), and refuses the request as a
 * whole if one of them does not validate.
 */
const RestoreClipboard = z.object({
  version: z.literal(1),
  elements: z.array(z.record(z.string(), z.unknown())),
  bodies: z.record(z.string(), z.string()),
  planBases: z.record(z.string(), z.unknown()).optional(),
  source: z
    .object({
      boardId: z.string(),
      schemaVersion: z.int().min(1),
      instance: z.string().optional(),
    })
    .optional(),
  cards: z.record(z.string(), z.string()).optional(),
});

export const RestoreCardsRequest = z.object({
  type: z.literal('restoreCards'),
  /** Chosen by the client, and sent again unchanged when it never got the answer. */
  requestId: z.uuid(),
  clipboard: RestoreClipboard,
  /** Where cards whose column or scene is not on the board go, on the canvas. */
  at: Point,
});
export type RestoreCardsRequest = z.infer<typeof RestoreCardsRequest>;

/**
 * Why nothing was written. `role`: the connection may only read; `schema`: its client is older
 * than the board allows to write (decision 0102); `frozen`: the board is over its caps or
 * read-only; `full`: the cards would take it past its caps; `moved`: a card's data moved to
 * another board (decision 0141); `invalid`: a malformed request or a card that does not
 * validate; `newer`: content of a newer schema than the server's; `tooLarge`: more cards or text
 * than one request takes; `busy`: try again later (too many requests, the server is handing the
 * board over, or an error).
 */
export const RestoreRefusal = z.enum([
  'role',
  'schema',
  'frozen',
  'full',
  'moved',
  'invalid',
  'newer',
  'tooLarge',
  'busy',
]);
export type RestoreRefusal = z.infer<typeof RestoreRefusal>;

const answer = { type: z.literal('restoreCardsResult'), requestId: z.uuid() };

export const RestoreCardsResult = z.discriminatedUnion('outcome', [
  z.object({
    ...answer,
    outcome: z.literal('restored'),
    /** The cards of the request that are not inside another card of it. */
    ids: z.array(ElementId),
    /** Cards whose column or scene is not on the board, put on the canvas at `at`. */
    outside: z.array(ElementId),
    /** Every card put back, each under its own id. */
    own: z.array(ElementId),
    /** The same request was answered before: nothing was written again. */
    repeat: z.literal(true).optional(),
  }),
  z.object({
    ...answer,
    outcome: z.literal('present'),
    /** Cards of the request already on the board: nothing was written. */
    present: z.array(ElementId),
  }),
  z.object({ ...answer, outcome: z.literal('refused'), reason: RestoreRefusal }),
]);
export type RestoreCardsResult = z.infer<typeof RestoreCardsResult>;

function json(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/** Parses an answer to a restore; null for anything else, as for an unknown stateless message. */
export function readRestoreCardsResult(payload: string): RestoreCardsResult | null {
  const parsed = RestoreCardsResult.safeParse(json(payload));
  return parsed.success ? parsed.data : null;
}

/**
 * Reads a request: null when the payload is not one (another stateless message), else the
 * request, or why it is refused with the `requestId` to answer (null when it cannot be read).
 */
export function readRestoreCardsRequest(
  payload: string,
):
  | { request: RestoreCardsRequest }
  | { refused: 'invalid' | 'tooLarge'; requestId: string | null }
  | null {
  // A cheap look first: every other stateless message goes through here.
  if (!payload.includes('"restoreCards"')) return null;
  const value = json(payload);
  if (typeof value !== 'object' || value === null) return null;
  const { type, requestId: id } = value as { type?: unknown; requestId?: unknown };
  if (type !== 'restoreCards') return null;
  const requestId = z.uuid().safeParse(id).success ? (id as string) : null;
  if (payload.length > RESTORE_CARDS_MAX_LENGTH) return { refused: 'tooLarge', requestId };
  // Cards by id: one the copying build did not understand is in both `elements` and `cards`.
  const clipboard = (value as { clipboard?: { elements?: unknown; cards?: unknown } }).clipboard;
  const ids = new Set<unknown>(
    Array.isArray(clipboard?.elements)
      ? clipboard.elements.map((e) => (typeof e === 'object' && e !== null ? e.id : e))
      : [],
  );
  if (typeof clipboard?.cards === 'object' && clipboard.cards !== null)
    for (const id of Object.keys(clipboard.cards)) ids.add(id);
  if (ids.size > RESTORE_CARDS_MAX) return { refused: 'tooLarge', requestId };
  const parsed = RestoreCardsRequest.safeParse(value);
  return parsed.success ? { request: parsed.data } : { refused: 'invalid', requestId };
}
