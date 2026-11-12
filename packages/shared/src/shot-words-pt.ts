// SPDX-License-Identifier: MPL-2.0
import type { ShotWords } from './shot-words.ts';

/**
 * The names of a frame's shot size, angle and movement in Portuguese: the keys of `SHOT_WORDS_EN`
 * (decision 0116), as the web's Portuguese catalogue says them (a web test compares them). Import it
 * from `@inkadra/shared/shot-words/pt`, so a client loads only the languages it ships.
 */
export const SHOT_WORDS_PT: ShotWords = {
  film: {
    shot: {
      ews: 'Grande plano geral',
      ws: 'Plano geral',
      fs: 'Plano inteiro',
      ms: 'Plano médio',
      mcu: 'Primeiro plano',
      cu: 'Close-up',
      ecu: 'Superclose',
      insert: 'Plano detalhe',
    },
    angle: {
      eye: 'Altura dos olhos',
      high: 'Plongée',
      low: 'Contra-plongée',
      overhead: 'Zenital',
      dutch: 'Holandês',
      pov: 'Subjetiva',
      ots: 'Sobre o ombro',
    },
    movement: {
      static: 'Fixo',
      pan: 'Panorâmica',
      tilt: 'Tilt',
      dolly: 'Dolly',
      truck: 'Travelling lateral',
      crane: 'Grua',
      handheld: 'Câmera na mão',
      steadicam: 'Steadicam',
      drone: 'Drone',
      zoom: 'Zoom',
    },
  },
};
