// SPDX-License-Identifier: MPL-2.0

/**
 * The empty states of the shooting schedule that every client shows the same (decision 0116):
 * no shooting days yet (for someone who can plan them, and for someone who only reads them), no
 * blocks on a day, no shots left to plan or matching the filters, and the call sheet without
 * blocks. English, the source; the keys are those of the web catalogues (`schedule.*`,
 * `callSheet.*`), so a client loads this object as its English catalogue. The other languages
 * have the same keys, one file each (`@inkadra/shared/schedule-words/it`, `es`, `de`, `fr`,
 * `pt`), so a client imports only those it ships. The web's catalogues must say the same (a web
 * test compares them).
 */
export const SCHEDULE_WORDS_EN = {
  schedule: {
    empty: 'No shooting days yet.',
    emptyTitle: 'No shooting days yet',
    emptyBody: 'Add the first day, then drag shots onto it from the queue.',
    emptyReadOnly: 'Shooting days appear here once the team plans them.',
    noBlocks: 'No blocks yet. Add one, or drop a shot on the day.',
    noMatches: 'No shots match these filters.',
    allScheduled: 'Every shot is on a shooting day.',
  },
  callSheet: {
    noBlocks: 'No blocks scheduled.',
  },
};

/** The shape of every language's words: the keys of `SCHEDULE_WORDS_EN`, each a string. */
export type ScheduleWords = typeof SCHEDULE_WORDS_EN;
