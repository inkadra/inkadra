// SPDX-License-Identifier: MPL-2.0
// Boards written by released builds (#849), frozen by scripts/release-fixture.ts run on each tag:
// every card type of that release, every field filled. Today's build must migrate them, validate
// them, treat every card as its own and read every field as the release wrote it.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  migrateBoardDoc,
  readElement,
  roots,
  validateBoardDoc,
} from './doc.ts';
import { checkCard } from './strict.ts';

const dir = new URL('./fixtures/', import.meta.url);
const tags = readdirSync(dir)
  .filter((file) => file.endsWith('.ybin'))
  .map((file) => file.slice('board-'.length, -'.ybin'.length));

/** The cards as the release read them, with the changes later migrations make on purpose. */
function migrated(elements: Record<string, Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(elements).map(([id, card]) => {
      if (card.type !== 'plan' || !Array.isArray(card.icons)) return [id, card];
      // 25 → 26: the note of an icon with blocking moves to stepNote.
      const icons = card.icons.map((icon: Record<string, unknown>) => {
        if (!Array.isArray(icon.steps) || icon.steps.length === 0 || icon.note === undefined)
          return icon;
        const { note, ...rest } = icon;
        return { ...rest, stepNote: note };
      });
      return [id, { ...card, icons }];
    }),
  );
}

it('has the fixtures of the releases', () => {
  expect(tags).toEqual(expect.arrayContaining(['v0.7.0', 'v0.8.0', 'v0.9.0']));
});

describe.each(tags)('a board written by %s', (tag) => {
  it('migrates, validates and keeps every card and field', () => {
    const frozen = JSON.parse(readFileSync(new URL(`board-${tag}.json`, dir), 'utf8'));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, readFileSync(new URL(`board-${tag}.ybin`, dir)));
    expect(getSchemaVersion(doc)).toBe(frozen.schemaVersion);
    migrateBoardDoc(doc, '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
    expect(getSchemaVersion(doc)).toBe(CURRENT_SCHEMA_VERSION);
    expect(validateBoardDoc(doc)).toEqual([]);
    const cards = [...roots(doc).elements.entries()] as Array<[string, Y.Map<unknown>]>;
    for (const [id, map] of cards) expect(checkCard(map), id).toEqual({ status: 'known' });
    expect(Object.fromEntries(cards.map(([id, map]) => [id, readElement(map)]))).toEqual(
      migrated(frozen.elements),
    );
  });
});
