// SPDX-License-Identifier: MPL-2.0
import type { ShotWords } from './shot-words.ts';

/**
 * The names of a frame's shot size, angle and movement in German: the keys of `SHOT_WORDS_EN`
 * (decision 0116), as the web's German catalogue says them (a web test compares them). Import it
 * from `@inkadra/shared/shot-words/de`, so a client loads only the languages it ships.
 */
export const SHOT_WORDS_DE: ShotWords = {
  film: {
    shot: {
      ews: 'Supertotale',
      ws: 'Totale',
      fs: 'Halbtotale',
      ms: 'Halbnah',
      mcu: 'Nah',
      cu: 'Groß',
      ecu: 'Ganz groß',
      insert: 'Detail',
    },
    angle: {
      eye: 'Augenhöhe',
      high: 'Aufsicht',
      low: 'Untersicht',
      overhead: 'Top Shot',
      dutch: 'Dutch Angle',
      pov: 'POV',
      ots: 'Over-Shoulder',
    },
    movement: {
      static: 'Statisch',
      pan: 'Schwenk',
      tilt: 'Tilt',
      dolly: 'Dolly',
      truck: 'Seitliche Fahrt',
      crane: 'Kran',
      handheld: 'Handkamera',
      steadicam: 'Steadicam',
      drone: 'Drohne',
      zoom: 'Zoom',
    },
  },
};
