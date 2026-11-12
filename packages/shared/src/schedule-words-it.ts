// SPDX-License-Identifier: MPL-2.0
import type { ScheduleWords } from './schedule-words.ts';

/**
 * The schedule's empty states in Italian: the keys of `SCHEDULE_WORDS_EN`
 * (decision 0116), as the web's Italian catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/schedule-words/it`, so a client loads only the
 * languages it ships.
 */
export const SCHEDULE_WORDS_IT: ScheduleWords = {
  schedule: {
    empty: 'Nessun giorno di riprese.',
    emptyTitle: 'Nessun giorno di riprese',
    emptyBody: 'Aggiungi il primo giorno, poi trascinaci le inquadrature dalla coda.',
    emptyReadOnly: 'I giorni di riprese compaiono qui quando il team li pianifica.',
    noBlocks: 'Ancora nessun blocco. Aggiungine uno o trascina un’inquadratura sul giorno.',
    noMatches: 'Nessuna inquadratura con questi filtri.',
    allScheduled: 'Tutte le inquadrature sono in un giorno di riprese.',
  },
  callSheet: {
    noBlocks: 'Nessun blocco in programma.',
  },
};
