// SPDX-License-Identifier: MPL-2.0
import { z } from './common.ts';

/**
 * Personal preferences of the signed-in person (#302, decision 0055): one JSON record per
 * account, so they follow the person to every device. They change how the apps show things to
 * that person only, never the boards or anyone else.
 */

export const DateFormat = z.enum(['auto', 'dmy', 'mdy', 'ymd']).openapi({
  description:
    '`auto`: the order and style of the browser language. `dmy`: 14/11/2026. `mdy`: ' +
    '11/14/2026. `ymd`: 2026-11-14.',
});
export type DateFormat = z.infer<typeof DateFormat>;

export const TimeFormat = z.enum(['auto', '24h', '12h']).openapi({
  description: '`auto`: as the browser language writes times.',
});
export type TimeFormat = z.infer<typeof TimeFormat>;

const fields = {
  dateFormat: DateFormat,
  timeFormat: TimeFormat,
  dotGrid: z.boolean().openapi({
    description: 'Boards show the dot grid unless this person turned it off on that board.',
  }),
  snapToGrid: z.boolean().openapi({ description: 'Boards open with snap to grid on.' }),
  doubleClickNote: z.boolean().openapi({
    description: 'A double click or double tap on empty canvas creates a note.',
  }),
  undoButtons: z.boolean().openapi({ description: 'Undo and redo buttons on the board.' }),
  toolbar: z
    .array(z.string().min(1).max(40))
    .max(40)
    .nullable()
    .openapi({
      description:
        'Tools in the bottom bar of the board, in order; null for the default bar. Open list: ' +
        'clients skip the tools they do not know, and hidden tools stay in the + menu.',
    }),
};

export const UserPreferences = z.object(fields).openapi('UserPreferences');
export type UserPreferences = z.infer<typeof UserPreferences>;

export const UpdateUserPreferences = z
  .object(fields)
  .partial()
  .openapi('UpdateUserPreferences', { description: 'Only the fields given change.' });
export type UpdateUserPreferences = z.infer<typeof UpdateUserPreferences>;

/** What a person who never changed anything gets. */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  dateFormat: 'auto',
  timeFormat: 'auto',
  dotGrid: true,
  snapToGrid: false,
  doubleClickNote: true,
  undoButtons: false,
  toolbar: null,
};

/**
 * The preferences in a stored record: every field that is still valid, the default for the
 * rest, so a record written by a newer or older server never fails to read.
 */
export function readUserPreferences(stored: unknown): UserPreferences {
  const record = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_USER_PREFERENCES };
  for (const [key, schema] of Object.entries(fields)) {
    const parsed = schema.safeParse(record[key]);
    if (parsed.success && record[key] !== undefined) out[key] = parsed.data;
  }
  return out as UserPreferences;
}
