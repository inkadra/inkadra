// SPDX-License-Identifier: MPL-2.0
import type { ScheduleWords } from './schedule-words.ts';

/**
 * The schedule's empty states in German: the keys of `SCHEDULE_WORDS_EN`
 * (decision 0116), as the web's German catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/schedule-words/de`, so a client loads only the
 * languages it ships.
 */
export const SCHEDULE_WORDS_DE: ScheduleWords = {
  schedule: {
    empty: 'Noch keine Drehtage.',
    emptyTitle: 'Noch keine Drehtage',
    emptyBody: 'Add the first day, then drag shots onto it from the queue.',
    emptyReadOnly: 'Drehtage erscheinen hier, sobald das Team sie plant.',
    noBlocks: 'Noch keine Blöcke. Füge einen hinzu oder zieh einen Shot auf den Tag.',
    noMatches: 'No shots match these filters.',
    allScheduled: 'Jeder Shot ist einem Drehtag zugeordnet.',
  },
  callSheet: {
    noBlocks: 'Keine Blöcke geplant.',
  },
};
