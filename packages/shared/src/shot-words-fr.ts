// SPDX-License-Identifier: MPL-2.0
import type { ShotWords } from './shot-words.ts';

/**
 * The names of a frame's shot size, angle and movement in French: the keys of `SHOT_WORDS_EN`
 * (decision 0116), as the web's French catalogue says them (a web test compares them). Import it
 * from `@inkadra/shared/shot-words/fr`, so a client loads only the languages it ships.
 */
export const SHOT_WORDS_FR: ShotWords = {
  film: {
    shot: {
      ews: 'Plan général',
      ws: 'Plan d’ensemble',
      fs: 'Plan en pied',
      ms: 'Plan taille',
      mcu: 'Plan poitrine',
      cu: 'Gros plan',
      ecu: 'Très gros plan',
      insert: 'Insert',
    },
    angle: {
      eye: 'À hauteur d’yeux',
      high: 'Plongée',
      low: 'Contre-plongée',
      overhead: 'Zénithal',
      dutch: 'Débullé',
      pov: 'Subjectif',
      ots: 'Par-dessus l’épaule',
    },
    movement: {
      static: 'Fixe',
      pan: 'Panoramique',
      tilt: 'Tilt',
      dolly: 'Travelling',
      truck: 'Travelling latéral',
      crane: 'Grue',
      handheld: 'À l’épaule',
      steadicam: 'Steadicam',
      drone: 'Drone',
      zoom: 'Zoom',
    },
  },
};
