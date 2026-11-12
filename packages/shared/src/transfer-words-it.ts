// SPDX-License-Identifier: MPL-2.0
import type { TransferWords } from './transfer-words.ts';

/**
 * The project export and import messages in Italian: the keys of `TRANSFER_WORDS_EN`
 * (decision 0116), as the web's Italian catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/transfer-words/it`, so a client loads only the
 * languages it ships.
 */
export const TRANSFER_WORDS_IT: TransferWords = {
  transfer: {
    exportLead:
      'Uno zip con tutte le board, i file e i commenti, da conservare o da importare su un altro server Inkadra.',
    includedList:
      'Board e sotto-board, file originali, commenti, revisioni, giorni di ripresa, versioni con nome',
    excludedList: 'Membri, link di condivisione e ospiti, board nel cestino, versioni automatiche',
    notifyNote: 'Puoi chiudere questa finestra: una notifica ti avvisa quando ha finito.',
    exportForbidden: 'Solo proprietari ed editor del progetto possono esportarlo.',
    startError: "Non è stato possibile avviare l'esportazione. Riprova.",
    failure: {
      too_large: "L'archivio è più grande di quanto questo server accetti.",
      invalid_archive: 'Questo file non è un archivio Inkadra valido.',
      unsupported_version:
        "L'archivio viene da un Inkadra più recente. Aggiorna prima questo server.",
      too_new: 'Le board vengono da un Inkadra più recente. Aggiorna prima questo server.',
      storage:
        "Non è stato possibile salvare i file. Chiedi all'amministratore di controllare lo spazio libero.",
      gone: 'Non puoi più modificare questo progetto, oppure è stato eliminato.',
      interrupted: 'Il server si è fermato durante il lavoro. Riprova.',
      cancelled: 'Annullato.',
      internal: 'Qualcosa è andato storto. Riprova.',
      storage_full:
        'I file dell’archivio non ci stanno nello spazio che resta. Libera spazio o chiedi a un amministratore.',
    },
  },
};
