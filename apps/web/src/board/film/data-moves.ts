// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useSyncExternalStore } from 'react';

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

/** A board's gate: whether a scene move, its planning or its Undo runs, and who listens. */
interface Gate {
  busy: boolean;
  listeners: Set<() => void>;
}
const gates = new Map<string, Gate>();
const gateOf = (boardId: string) => {
  let gate = gates.get(boardId);
  if (!gate) {
    gate = { busy: false, listeners: new Set() };
    gates.set(boardId, gate);
  }
  return gate;
};
const changed = (gate: Gate) => {
  for (const listener of gate.listeners) listener();
};

/**
 * One scene move, its planning or its Undo at a time on a board (decision 0141), for the whole
 * page: a canvas unmounted by a view switch and mounted again finds the same gate, and the ⋯ menu
 * hears when it opens. `claim` is synchronous, so two clicks in the same tick cannot both pass.
 */
export function sceneMoveGate(boardId: string) {
  const gate = gateOf(boardId);
  return {
    claim: () => {
      if (gate.busy) return false;
      gate.busy = true;
      changed(gate);
      return true;
    },
    release: () => {
      if (!gate.busy) return;
      gate.busy = false;
      changed(gate);
    },
    get busy() {
      return gate.busy;
    },
    subscribe: (listener: () => void) => {
      gate.listeners.add(listener);
      return () => {
        gate.listeners.delete(listener);
      };
    },
  };
}

/** Whether a scene move runs on this board now, kept current. */
export function useSceneMoveBusy(boardId: string): boolean {
  const gate = useMemo(() => sceneMoveGate(boardId), [boardId]);
  return useSyncExternalStore(gate.subscribe, () => gate.busy);
}
