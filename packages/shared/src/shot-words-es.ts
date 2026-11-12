// SPDX-License-Identifier: MPL-2.0
import type { ShotWords } from './shot-words.ts';

/**
 * The names of a frame's shot size, angle and movement in Spanish: the keys of `SHOT_WORDS_EN`
 * (decision 0116), as the web's Spanish catalogue says them (a web test compares them). Import it
 * from `@inkadra/shared/shot-words/es`, so a client loads only the languages it ships.
 */
export const SHOT_WORDS_ES: ShotWords = {
  film: {
    shot: {
      ews: 'Gran plano general',
      ws: 'Plano general',
      fs: 'Plano entero',
      ms: 'Plano medio',
      mcu: 'Plano medio corto',
      cu: 'Primer plano',
      ecu: 'Primerísimo primer plano',
      insert: 'Plano detalle',
    },
    angle: {
      eye: 'Altura de los ojos',
      high: 'Picado',
      low: 'Contrapicado',
      overhead: 'Cenital',
      dutch: 'Holandés',
      pov: 'Subjetivo',
      ots: 'Sobre el hombro',
    },
    movement: {
      static: 'Fijo',
      pan: 'Panorámica',
      tilt: 'Tilt',
      dolly: 'Travelling',
      truck: 'Travelling lateral',
      crane: 'Grúa',
      handheld: 'Cámara en mano',
      steadicam: 'Steadicam',
      drone: 'Dron',
      zoom: 'Zoom',
    },
  },
};
