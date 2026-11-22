// SPDX-License-Identifier: MPL-2.0

/**
 * The names that every client writes the same (decision 0116): the default values of a frame's
 * shot size, angle and movement and the default kinds of to-do lists (decision 0136), by id, as
 * `shotOptionLabel` asks for them. English, the source; the keys are those of the web catalogues
 * (`film.shot.*`, `film.angle.*`, `film.movement.*`, `board.todo.lists.*`), so a client loads this
 * object as its English catalogue. The other languages have the same keys, one file each
 * (`@inkadra/shared/shot-words/it`, `es`, `de`, `fr`, `pt`), so a client imports only those it
 * ships. The web's catalogues must say the same (a web test compares them).
 */

/**
 * How the shared functions ask for a word: i18next's `t` with a key of `SHOT_WORDS_EN` (the same
 * shape as canvas-core's `Words`).
 */
export type Words = (key: string, values?: Record<string, unknown>) => string;

export const SHOT_WORDS_EN = {
  film: {
    shot: {
      ews: 'Extreme wide',
      ws: 'Wide',
      fs: 'Full',
      ms: 'Medium',
      mcu: 'Medium close-up',
      cu: 'Close-up',
      ecu: 'Extreme close-up',
      insert: 'Insert',
    },
    angle: {
      eye: 'Eye level',
      high: 'High angle',
      low: 'Low angle',
      overhead: 'Overhead',
      dutch: 'Dutch',
      pov: 'POV',
      ots: 'Over the shoulder',
    },
    movement: {
      static: 'Static',
      pan: 'Pan',
      tilt: 'Tilt',
      dolly: 'Dolly',
      truck: 'Truck',
      crane: 'Crane',
      handheld: 'Handheld',
      steadicam: 'Steadicam',
      drone: 'Drone',
      zoom: 'Zoom',
    },
  },
  board: {
    todo: {
      lists: {
        wardrobe: 'Wardrobe',
        props: 'Props',
        equipment: 'Equipment',
      },
    },
  },
};

/** The shape of every language's words: the keys of `SHOT_WORDS_EN`, each a string. */
export type ShotWords = typeof SHOT_WORDS_EN;
