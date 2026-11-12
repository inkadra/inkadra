// SPDX-License-Identifier: MPL-2.0
import type { TransferWords } from './transfer-words.ts';

/**
 * The project export and import messages in Portuguese: the keys of `TRANSFER_WORDS_EN`
 * (decision 0116), as the web's Portuguese catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/transfer-words/pt`, so a client loads only the
 * languages it ships.
 */
export const TRANSFER_WORDS_PT: TransferWords = {
  transfer: {
    exportLead:
      'Um zip com todos os quadros, arquivos e comentários, para guardar ou importar em outro servidor Inkadra.',
    includedList:
      'Quadros e subquadros, arquivos originais, comentários, revisões, diárias, versões com nome',
    excludedList:
      'Membros, links de compartilhamento e convidados, quadros na lixeira, versões automáticas',
    notifyNote: 'Você pode fechar esta janela: uma notificação avisará quando terminar.',
    exportForbidden: 'Só proprietários e editores do projeto podem exportá-lo.',
    startError: 'Não foi possível iniciar a exportação. Tente novamente.',
    failure: {
      too_large: 'O pacote é maior do que este servidor aceita.',
      invalid_archive: 'Este arquivo não é um pacote válido do Inkadra.',
      unsupported_version:
        'O pacote vem de um Inkadra mais recente. Atualize este servidor primeiro.',
      too_new: 'Os quadros vêm de um Inkadra mais recente. Atualize este servidor primeiro.',
      storage:
        'Não foi possível armazenar os arquivos. Peça a um administrador para verificar o espaço livre.',
      gone: 'Você não pode mais editar este projeto, ou ele foi excluído.',
      interrupted: 'O servidor parou durante o trabalho. Tente novamente.',
      cancelled: 'Cancelado.',
      internal: 'Algo deu errado. Tente novamente.',
      storage_full:
        'Os arquivos do pacote não cabem no espaço restante. Libere espaço ou peça a um administrador.',
    },
  },
};
