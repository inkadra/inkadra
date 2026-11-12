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
  releaseNews: z
    .boolean()
    .openapi({ description: 'Opt in to one email after an instance update. Off by default.' }),
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
  keepAroundContent: z.boolean().openapi({
    description:
      'Boards pan only around their content plus a margin, an area that grows with it (#324).',
  }),
  planFavorites: z
    .array(z.string().min(1).max(40))
    .max(60)
    .openapi({
      description:
        'Set plan icons starred by this person, in order (#335). Open list: clients skip kinds ' +
        'they do not know.',
    }),
  planRecents: z
    .array(z.string().min(1).max(40))
    .max(8)
    .openapi({ description: 'The last set plan icons this person placed, newest first.' }),
  planSnap: z.boolean().openapi({
    description: 'The set plan editor snaps to the grid (G); on by default (decision 0119).',
  }),
  planAttach: z.boolean().openapi({
    description:
      'Set plan icons dropped on a base attach to it (the Snap toggle of the phone); on by default.',
  }),
  planGhosts: z.boolean().openapi({
    description: 'The set plan editor shows the earlier positions of what moves, veiled.',
  }),
  planHidden: z
    .array(z.string().min(1).max(40))
    .max(10)
    .openapi({
      description:
        'Layers and groups of a set plan this person hides for themselves while editing, on every ' +
        'plan (decision 0119). Open list: clients skip names they do not know.',
    }),
  planShelf: z.string().min(1).max(40).openapi({
    description: 'The set plan library category this person looked at last.',
  }),
  shotGroupBy: z.enum(['scene', 'location', 'status', 'setup', 'none']).openapi({
    description:
      'How this person groups shots, in the shot list and in the schedule (decision 0115). The ' +
      'schedule groups by setup when it is `setup` and by scene otherwise.',
  }),
  toolbar: z
    .array(z.string().min(1).max(40))
    .max(40)
    .nullable()
    .openapi({
      description:
        'Tools in the bottom bar of the board, in order; null for the default bar. Open list: ' +
        'clients skip the tools they do not know, and hidden tools stay in the + menu.',
    }),
  tutorialsSeen: z
    .array(z.string().min(1).max(40))
    .max(100)
    .openapi({
      description:
        'Tutorials this person finished or skipped, so each is offered once (#502). Open list: ' +
        'clients ignore ids they do not know.',
    }),
  tutorialHints: z.boolean().openapi({
    description: "Offer a feature's tutorial the first time this person opens it (#502).",
  }),
  serverView: z.enum(['simple', 'advanced']).openapi({
    description: 'How an administrator last looked at the Server settings page (#514).',
  }),
  updateSeen: z
    .string()
    .max(64)
    .nullable()
    .openapi({
      description:
        'Administrators: the release whose update pop-up this person already saw, so it shows ' +
        'once per version (#515).',
    }),
  updateSkipped: z.string().max(64).nullable().openapi({
    description:
      'Administrators: the release this person chose to skip; the settings stop pointing at it.',
  }),
};

export const UserPreferences = z.object(fields).openapi('UserPreferences');
export type UserPreferences = z.infer<typeof UserPreferences>;

export const UpdateUserPreferences = z
  .object(fields)
  .partial()
  .openapi('UpdateUserPreferences', { description: 'Only the fields given change.' });
export type UpdateUserPreferences = z.infer<typeof UpdateUserPreferences>;

/** Lists of ids (set plan icons, tutorials) and their limits, read entry by entry. */
const ID_LISTS = { planFavorites: 60, planRecents: 8, planHidden: 10, tutorialsSeen: 100 } as const;

/** What a person who never changed anything gets. */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  releaseNews: false,
  dateFormat: 'auto',
  timeFormat: 'auto',
  dotGrid: true,
  snapToGrid: false,
  doubleClickNote: true,
  undoButtons: false,
  keepAroundContent: true,
  planFavorites: [],
  planRecents: [],
  planSnap: true,
  planAttach: true,
  planGhosts: true,
  planHidden: [],
  planShelf: 'lights',
  shotGroupBy: 'scene',
  toolbar: null,
  tutorialsSeen: [],
  tutorialHints: true,
  serverView: 'simple',
  updateSeen: null,
  updateSkipped: null,
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
    else if (key in ID_LISTS && Array.isArray(record[key]))
      // One bad entry does not cost the person the whole list: keep the valid ones.
      out[key] = [
        ...new Set(
          (record[key] as unknown[]).filter(
            (v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40,
          ),
        ),
      ].slice(0, ID_LISTS[key as keyof typeof ID_LISTS]);
  }
  return out as UserPreferences;
}
