// SPDX-License-Identifier: MPL-2.0
import type { TransferWords } from './transfer-words.ts';

/**
 * The project export and import messages in French: the keys of `TRANSFER_WORDS_EN`
 * (decision 0116), as the web's French catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/transfer-words/fr`, so a client loads only the
 * languages it ships.
 */
export const TRANSFER_WORDS_FR: TransferWords = {
  transfer: {
    exportLead:
      'Un zip avec tous les tableaux, fichiers et commentaires, à conserver ou à importer sur un autre serveur Inkadra.',
    includedList:
      'Tableaux et sous-tableaux, fichiers originaux, commentaires, révisions, journées de tournage, versions nommées',
    excludedList:
      'Membres, liens de partage et invités, tableaux dans la corbeille, versions automatiques',
    notifyNote: 'Vous pouvez fermer cette fenêtre : une notification vous préviendra à la fin.',
    exportForbidden: 'Seuls les propriétaires et les éditeurs du projet peuvent l’exporter.',
    startError: 'Impossible de lancer l’export. Réessayez.',
    failure: {
      too_large: 'L’archive dépasse ce que ce serveur accepte.',
      invalid_archive: 'Ce fichier n’est pas une archive Inkadra valide.',
      unsupported_version:
        'L’archive provient d’un Inkadra plus récent. Mettez d’abord ce serveur à jour.',
      too_new:
        'Les tableaux proviennent d’un Inkadra plus récent. Mettez d’abord ce serveur à jour.',
      storage:
        'Impossible d’enregistrer les fichiers. Demandez à l’administrateur de vérifier l’espace libre.',
      gone: 'Vous ne pouvez plus modifier ce projet, ou il a été supprimé.',
      interrupted: 'Le serveur s’est arrêté pendant l’opération. Réessayez.',
      cancelled: 'Annulé.',
      internal: 'Une erreur s’est produite. Réessayez.',
      storage_full:
        'Les fichiers de l’archive ne tiennent pas dans l’espace restant. Libérez de l’espace ou demandez à un administrateur.',
    },
  },
};
