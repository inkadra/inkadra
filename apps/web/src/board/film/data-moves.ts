// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether the server moves what it keeps about cards along with them (capability
 * `element-data-move`, decision 0141): then commented scenes move too. Its own module, so the
 * session sets it without loading the board editor.
 */
let dataMoves = false;
export function setElementDataMove(available: boolean) {
  dataMoves = available;
}
export const elementDataMoves = () => dataMoves;

/**
 * A gate for one scene move, its planning or its Undo at a time (decision 0141): `claim` is
 * synchronous, so two clicks in the same tick cannot both pass.
 */
export function oneAtATime() {
  let busy = false;
  return {
    claim: () => {
      if (busy) return false;
      busy = true;
      return true;
    },
    release: () => {
      busy = false;
    },
    get busy() {
      return busy;
    },
  };
}
