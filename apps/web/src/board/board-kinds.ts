// SPDX-License-Identifier: AGPL-3.0-only
import { type ModuleId, moduleOf } from '@inkadra/shared';

/**
 * The kinds of board a person creates, in the order the Canvas menu, an empty board's starting
 * points and New board list them (decision 0121).
 */
export const NEW_BOARDS = ['board', 'moodboard', 'storyboard', 'production'] as const;
export type NewBoardKind = (typeof NEW_BOARDS)[number];

export interface BoardKindChoice<K extends NewBoardKind = NewBoardKind> {
  kind: K;
  /** The module the kind belongs to; none for a plain board, which is always on. */
  owner: ModuleId | null;
  /** Its module is off: the kind stays, dimmed, with Turn on (decision 0121). */
  off: boolean;
  /** The project's one Production board already exists: the entry opens it (decision 0123). */
  present: boolean;
}

/**
 * Every kind with its state for this person. The kinds follow the modules that are on, never
 * the project type, which people rename and archive in Settings → Classifications.
 */
export function boardKindChoices<K extends NewBoardKind = NewBoardKind>(
  offers: (part: 'kinds', name: string) => boolean,
  hasProduction: boolean,
  kinds: readonly K[] = NEW_BOARDS as readonly NewBoardKind[] as readonly K[],
): BoardKindChoice<K>[] {
  return kinds.map((kind) => {
    const off = !offers('kinds', kind);
    return {
      kind,
      owner: moduleOf('kinds', kind),
      off,
      present: kind === 'production' && !off && hasProduction,
    };
  });
}
