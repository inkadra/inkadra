// SPDX-License-Identifier: MPL-2.0
import type { TransferWords } from './transfer-words.ts';

/**
 * The project export and import messages in German: the keys of `TRANSFER_WORDS_EN`
 * (decision 0116), as the web's German catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/transfer-words/de`, so a client loads only the
 * languages it ships.
 */
export const TRANSFER_WORDS_DE: TransferWords = {
  transfer: {
    exportLead:
      'Ein Zip mit allen Boards, Dateien und Kommentaren, zum Aufbewahren oder zum Import auf einem anderen Inkadra-Server.',
    includedList:
      'Boards und Unterboards, Originaldateien, Kommentare, Reviews, Drehtage, benannte Versionen',
    excludedList:
      'Mitglieder, Freigabelinks und Gäste, Boards im Papierkorb, automatische Versionen',
    notifyNote:
      'Du kannst dieses Fenster schließen: Eine Benachrichtigung sagt dir, wenn es fertig ist.',
    exportForbidden: 'Nur Inhaber und Bearbeiter des Projekts können es exportieren.',
    startError: 'Der Export konnte nicht gestartet werden. Versuch es noch mal.',
    failure: {
      too_large: 'Das Archiv ist größer, als dieser Server erlaubt.',
      invalid_archive: 'Diese Datei ist kein gültiges Inkadra-Archiv.',
      unsupported_version:
        'Das Archiv stammt aus einem neueren Inkadra. Aktualisiere zuerst diesen Server.',
      too_new: 'Die Boards stammen aus einem neueren Inkadra. Aktualisiere zuerst diesen Server.',
      storage:
        'Die Dateien konnten nicht gespeichert werden. Bitte deinen Admin, den freien Speicher zu prüfen.',
      gone: 'Du kannst dieses Projekt nicht mehr bearbeiten oder es wurde gelöscht.',
      interrupted: 'Der Server hat während der Arbeit angehalten. Versuch es noch mal.',
      cancelled: 'Abgebrochen.',
      internal: 'Etwas ist schiefgelaufen. Versuch es noch mal.',
      storage_full:
        'Die Dateien des Archivs passen nicht in den restlichen Speicher. Gib Speicher frei oder frag eine Administratorin oder einen Administrator.',
    },
  },
};
