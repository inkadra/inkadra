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

export { z };
