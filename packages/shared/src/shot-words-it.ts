// SPDX-License-Identifier: MPL-2.0
import type { ShotWords } from './shot-words.ts';

/**
 * The names of a frame's shot size, angle and movement in Italian: the keys of `SHOT_WORDS_EN`
 * (decision 0116), as the web's Italian catalogue says them (a web test compares them). Import it
 * from `@inkadra/shared/shot-words/it`, so a client loads only the languages it ships.
 */
export const SHOT_WORDS_IT: ShotWords = {
  film: {
    shot: {
      ews: 'Campo lunghissimo',
      ws: 'Campo lungo',
      fs: 'Figura intera',
      ms: 'Mezza figura',
      mcu: 'Mezzo primo piano',
      cu: 'Primo piano',
      ecu: 'Primissimo piano',
      insert: 'Dettaglio',
    },
    angle: {
      eye: 'Altezza occhi',
      high: 'Dall’alto',
      low: 'Dal basso',
      overhead: 'Zenitale',
      dutch: 'Inclinata',
      pov: 'Soggettiva',
      ots: 'Di spalla',
    },
    movement: {
      static: 'Fissa',
      pan: 'Panoramica',
      tilt: 'Tilt',
      dolly: 'Carrello',
      truck: 'Carrello laterale',
      crane: 'Gru',
      handheld: 'A mano',
      steadicam: 'Steadicam',
      drone: 'Drone',
      zoom: 'Zoom',
    },
  },
};
