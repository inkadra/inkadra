// SPDX-License-Identifier: MPL-2.0
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const Id = z.uuid().openapi({ example: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10' });

export const Timestamp = z.iso.datetime({ offset: true }).openapi({
  example: '2026-11-02T09:30:00.000Z',
});

/**
 * When a role given to someone with an account ends (decision 0041): a time in the future, at
 * most a year ahead. Null: no end. Owners never have one.
 */
export const AccessExpiry = Timestamp.nullable().openapi({
  description:
    'When the role ends, at most 366 days ahead; null for no end. Not for owners: a project ' +
    'always keeps one. Missing from servers before API 0.9.0.',
});

/** Fractional index used to order siblings without renumbering (see docs/decisions/0004). */
export const FractionalIndex = z
  .string()
  .min(1)
  .max(64)
  .openapi({ description: 'Fractional index, compared as a plain string.', example: 'a0' });

/**
 * The saved order of siblings (boards under a board, project groups): by `position`, then by
 * `id`. `position` is a fractional index, made so that plain code-unit comparison (`<` on
 * strings) orders it; never compare it with `localeCompare` or `Intl.Collator`, which put `a0`
 * before `Zz` and depend on the runtime's locale. Two siblings may share a position (two clients
 * inserting at the same place at once): the id breaks the tie, so every client lists them alike.
 */
export function comparePosition(
  a: { position: string; id: string },
  b: { position: string; id: string },
): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const Cursor = z.string().min(1).max(512);

export function page<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: Cursor.nullable(),
  });
}

export const PageQuery = z.object({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ErrorCode = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z
  .object({
    error: z.object({
      code: ErrorCode,
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('ApiError');
export type ApiError = z.infer<typeof ApiError>;

/**
 * `details` of a 500 when the server cannot tell whether a change it handed to the board was
 * made (decisions 0016 and 0017). A missing or unrecognized reason also leaves the outcome
 * unknown: legacy servers omit details even when the change may have been made. Clients
 * must reconcile state before retrying; failing to parse OutcomeUnknown is not proof of failure.
 */
export const OutcomeUnknown = z
  .object({
    reason: z.literal('outcome_unknown').openapi({
      description:
        'The board did not confirm the change in time: it may or may not be there. Check ' +
        'before trying again.',
    }),
  })
  .openapi('OutcomeUnknown');
export type OutcomeUnknown = z.infer<typeof OutcomeUnknown>;

/**
 * `details` of a 401 for a bearer token the server recognises by its exact hash (decision
 * 0099). Unknown tokens, and revocations older than 30 days, get a 401 without details.
 */
export const InvalidTokenReason = z
  .enum(['token_revoked', 'token_expired', 'account_deactivated'])
  .openapi({
    description:
      'Why the token stopped working: revoked (by its owner, a password change or reset), ' +
      'expired, or its account was deactivated. Sign in again; do not retry the request.',
  });
export type InvalidTokenReason = z.infer<typeof InvalidTokenReason>;
export const InvalidToken = z.object({ reason: InvalidTokenReason }).openapi('InvalidToken');
export type InvalidToken = z.infer<typeof InvalidToken>;

export { z };
