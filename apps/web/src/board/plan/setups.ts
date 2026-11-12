// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What changed on a setup, the setups of each shot and the shots grouped by setup live in
 * canvas-core (decision 0116): the shot list and the schedule group the same on every client.
 */
export {
  dayBySetup,
  groupBySetup,
  type SetupChange,
  type ShotSetup,
  setupChanges,
  shotSetups,
} from '@inkadra/canvas-core';
