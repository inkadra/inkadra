// SPDX-License-Identifier: MPL-2.0
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const Id = z.uuid().openapi({ example: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10' });

export const Timestamp = z.iso.datetime({ offset: true }).openapi({
  example: '2026-11-02T09:30:00.000Z',
});

/** Fractional index used to order siblings without renumbering (see docs/decisions/0004). */
export const FractionalIndex = z
  .string()
  .min(1)
  .max(64)
  .openapi({ description: 'Fractional index, compared as a plain string.', example: 'a0' });

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

export { z };
