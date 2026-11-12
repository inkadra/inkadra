// SPDX-License-Identifier: MPL-2.0

/**
 * The messages of a project's export and import that every client shows the same (decision
 * 0116): what an export holds, who may export, and why a transfer failed (`transfer.failure.*`,
 * by the failure code of a `ProjectTransfer`). English, the source; the keys are those of the web
 * catalogues (`transfer.*`), so a client loads this object as its English catalogue. The other
 * languages have the same keys, one file each (`@inkadra/shared/transfer-words/it`, `es`, `de`,
 * `fr`, `pt`), so a client imports only those it ships. The web's catalogues must say the same (a
 * web test compares them).
 */
export const TRANSFER_WORDS_EN = {
  transfer: {
    exportLead:
      'A zip with every board, file and comment, to keep or to import on another Inkadra server.',
    includedList:
      'Boards and sub-boards, original files, comments, reviews, shooting days, named versions',
    excludedList: 'Members, share links and guests, boards in the trash, automatic versions',
    notifyNote: 'You can close this window: a notification tells you when it is done.',
    exportForbidden: 'Only owners and editors of the project can export it.',
    startError: 'The export could not start. Try again.',
    failure: {
      too_large: 'The archive is larger than this server accepts.',
      invalid_archive: 'This file is not a valid Inkadra archive.',
      unsupported_version: 'The archive comes from a newer Inkadra. Update this server first.',
      too_new: 'The boards come from a newer Inkadra. Update this server first.',
      storage: 'The files could not be stored. Ask the administrator to check the free space.',
      gone: 'You can no longer edit this project, or it was deleted.',
      interrupted: 'The server stopped while working on it. Try again.',
      cancelled: 'Cancelled.',
      internal: 'Something went wrong. Try again.',
      storage_full:
        'The files of the archive do not fit in the space left. Free some space or ask an administrator.',
    },
  },
};

/** The shape of every language's words: the keys of `TRANSFER_WORDS_EN`, each a string. */
export type TransferWords = typeof TRANSFER_WORDS_EN;
