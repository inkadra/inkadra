// SPDX-License-Identifier: MPL-2.0
import type { ScheduleWords } from './schedule-words.ts';

/**
 * The schedule's empty states in French: the keys of `SCHEDULE_WORDS_EN`
 * (decision 0116), as the web's French catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/schedule-words/fr`, so a client loads only the
 * languages it ships.
 */
export const SCHEDULE_WORDS_FR: ScheduleWords = {
  schedule: {
    empty: 'Aucune journée de tournage.',
    emptyTitle: 'Aucune journée de tournage',
    emptyBody: 'Add the first day, then drag shots onto it from the queue.',
    emptyReadOnly: 'Les journées de tournage apparaissent ici quand l’équipe les planifie.',
    noBlocks: 'Aucun bloc pour l’instant. Ajoutez-en un ou déposez un plan sur la journée.',
    noMatches: 'No shots match these filters.',
    allScheduled: 'Tous les plans sont dans une journée de tournage.',
  },
  callSheet: {
    noBlocks: 'Aucun bloc prévu.',
  },
};
