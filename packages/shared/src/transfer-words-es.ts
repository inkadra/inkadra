// SPDX-License-Identifier: MPL-2.0
import type { TransferWords } from './transfer-words.ts';

/**
 * The project export and import messages in Spanish: the keys of `TRANSFER_WORDS_EN`
 * (decision 0116), as the web's Spanish catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/transfer-words/es`, so a client loads only the
 * languages it ships.
 */
export const TRANSFER_WORDS_ES: TransferWords = {
  transfer: {
    exportLead:
      'Un zip con todos los tableros, archivos y comentarios, para conservarlo o importarlo en otro servidor de Inkadra.',
    includedList:
      'Tableros y subtableros, archivos originales, comentarios, revisiones, jornadas de rodaje, versiones con nombre',
    excludedList:
      'Miembros, enlaces compartidos e invitados, tableros en la papelera, versiones automáticas',
    notifyNote: 'Puedes cerrar esta ventana: una notificación te avisará cuando termine.',
    exportForbidden: 'Solo los propietarios y editores del proyecto pueden exportarlo.',
    startError: 'No se pudo iniciar la exportación. Inténtalo de nuevo.',
    failure: {
      too_large: 'El archivo es más grande de lo que acepta este servidor.',
      invalid_archive: 'Este archivo no es un archivo válido de Inkadra.',
      unsupported_version:
        'El archivo procede de un Inkadra más reciente. Actualiza primero este servidor.',
      too_new: 'Los tableros proceden de un Inkadra más reciente. Actualiza primero este servidor.',
      storage:
        'No se pudieron guardar los archivos. Pide al administrador que revise el espacio libre.',
      gone: 'Ya no puedes editar este proyecto, o se eliminó.',
      interrupted: 'El servidor se detuvo durante el trabajo. Inténtalo de nuevo.',
      cancelled: 'Cancelado.',
      internal: 'Algo salió mal. Inténtalo de nuevo.',
      storage_full:
        'Los archivos del archivo no caben en el espacio que queda. Libera espacio o pide ayuda a un administrador.',
    },
  },
};
