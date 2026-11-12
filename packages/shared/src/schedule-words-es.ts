// SPDX-License-Identifier: MPL-2.0
import type { ScheduleWords } from './schedule-words.ts';

/**
 * The schedule's empty states in Spanish: the keys of `SCHEDULE_WORDS_EN`
 * (decision 0116), as the web's Spanish catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/schedule-words/es`, so a client loads only the
 * languages it ships.
 */
export const SCHEDULE_WORDS_ES: ScheduleWords = {
  schedule: {
    empty: 'Sin jornadas de rodaje.',
    emptyTitle: 'Sin jornadas de rodaje',
    emptyBody: 'Añade la primera jornada y arrastra a ella los planos por planificar.',
    emptyReadOnly: 'Las jornadas de rodaje aparecen aquí cuando el equipo las planifica.',
    noBlocks: 'Aún no hay bloques. Añade uno o suelta un plano en la jornada.',
    noMatches: 'Ningún plano coincide con estos filtros.',
    allScheduled: 'Todos los planos están en una jornada de rodaje.',
  },
  callSheet: {
    noBlocks: 'Sin bloques programados.',
  },
};
