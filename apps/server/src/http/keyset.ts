import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { HttpError } from './errors.ts';

/**
 * Opaque keyset cursors on `(created_at, id)` for the lists of decision 0013. The time is kept
 * as Postgres prints it, with microseconds: a JavaScript Date would round it to milliseconds
 * and skip or repeat rows created within the same millisecond.
 */
export interface Keyset {
  at: string;
  id: string;
}

const AT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject malformed calendar dates before PostgreSQL tries to cast untrusted cursor data. */
function validTimestamp(value: string): boolean {
  if (!AT.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year === 0 || day < 1 || day > (days[month - 1] ?? 0)) return false;
  // Postgres uses a space and may print a whole-hour offset (`+00`).
  const normalized = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  return Number.isFinite(Date.parse(normalized)) && Number(value.slice(11, 13)) < 24;
}

export function encodeCursor(k: Keyset): string {
  return Buffer.from(JSON.stringify([k.at, k.id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Keyset | null {
  if (cursor === undefined) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string' &&
      validTimestamp(value[0]) &&
      UUID.test(value[1])
    )
      return { at: value[0], id: value[1] };
  } catch {}
  throw new HttpError('bad_request', 'Invalid cursor.');
}

/** The creation time as text with microseconds, to build the next cursor from. */
export const atText = (column: PgColumn) => sql<string>`${column}::text`;

/** Rows after the cursor in the order `(created_at, id)` desc, or asc with `asc`. */
export function afterCursor(
  createdAt: PgColumn,
  id: PgColumn,
  cursor: Keyset,
  order: 'asc' | 'desc' = 'desc',
): SQL {
  return order === 'desc'
    ? sql`(${createdAt}, ${id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
    : sql`(${createdAt}, ${id}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
}

/** Splits `limit + 1` rows into the page and its next cursor. */
export function pageOf<T extends { at: string; id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    rows: items,
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.at, id: last.id }) : null,
  };
}
