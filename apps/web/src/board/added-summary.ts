import type { TFunction } from 'i18next';

/** Kinds a summary names on their own; anything else counts as an item. */
const KINDS = ['board', 'scene', 'frame', 'image', 'file', 'link', 'color', 'note', 'column'];

/**
 * The text of the toast after adding many cards at once (#310), such as "Added 5 boards and
 * 12 frames": a count per kind, in order of first appearance, and the verb agreeing with them.
 */
export function addedSummary(
  t: TFunction,
  language: string,
  types: readonly string[],
  verb: 'added' | 'pasted' = 'added',
): string {
  const counts = new Map<string, number>();
  for (const type of types) {
    const kind = KINDS.includes(type) ? type : 'item';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [...counts].map(([kind, count]) => t(`board.added.kinds.${kind}`, { count }));
  const list = new Intl.ListFormat(language, { type: 'conjunction' }).format(parts);
  // The verb agrees in gender where the language has it: feminine when every kind is.
  const feminine = t('board.added.feminine').split(' ');
  const female = [...counts.keys()].every((kind) => feminine.includes(kind));
  return t(`board.added.${verb}${female ? 'F' : ''}`, { count: types.length, list });
}
