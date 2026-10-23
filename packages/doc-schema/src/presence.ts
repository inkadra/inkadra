// SPDX-License-Identifier: MPL-2.0
import { z } from 'zod';
import { ElementId } from './elements.ts';

/**
 * Presence on a board: the Yjs awareness state each client publishes over the collab
 * WebSocket. It is not stored. Clients set `cursor`, `selection` and `editing`; the server
 * writes `user` and `readOnly` from the signed-in account on every update, so nobody can
 * appear as someone else, and drops states that do not match this schema.
 */

export const PresenceUser = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});
export type PresenceUser = z.infer<typeof PresenceUser>;

export const PresenceState = z.object({
  user: PresenceUser,
  readOnly: z.boolean(),
  cursor: z
    .object({ x: z.number().finite(), y: z.number().finite() })
    .nullable()
    .describe('Pointer in board coordinates; null when it is off the canvas.'),
  selection: z.array(ElementId).max(500),
  editing: ElementId.nullable().describe('Element whose text is being edited.'),
});
export type PresenceState = z.infer<typeof PresenceState>;

/** What a client publishes; the server adds the rest. */
export const LocalPresence = PresenceState.omit({ user: true, readOnly: true });
export type LocalPresence = z.infer<typeof LocalPresence>;

/** Parses a peer's awareness state; null for anything malformed or from an older client. */
export function readPresence(state: unknown): PresenceState | null {
  const parsed = PresenceState.safeParse(state);
  return parsed.success ? parsed.data : null;
}

/**
 * Stable colour index (0 to `count` - 1) for a person's cursor and avatar, the same on every
 * client.
 */
export function presenceColor(userId: string, count: number): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return h % count;
}
