// SPDX-License-Identifier: MPL-2.0
import type { ScheduleWords } from './schedule-words.ts';

/**
 * The schedule's empty states in Portuguese: the keys of `SCHEDULE_WORDS_EN`
 * (decision 0116), as the web's Portuguese catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/schedule-words/pt`, so a client loads only the
 * languages it ships.
 */
export const SCHEDULE_WORDS_PT: ScheduleWords = {
  schedule: {
    empty: 'Nenhuma diária ainda.',
    emptyTitle: 'Nenhuma diária ainda',
    emptyBody: 'Adicione a primeira diária e arraste para ela os planos não agendados.',
    emptyReadOnly: 'As diárias aparecem aqui quando a equipe as planejar.',
    noBlocks: 'Nenhum bloco ainda. Adicione um ou solte um plano na diária.',
    noMatches: 'Nenhum plano corresponde a estes filtros.',
    allScheduled: 'Todos os planos estão em uma diária.',
  },
  callSheet: {
    noBlocks: 'Nenhum bloco programado.',
  },
};
