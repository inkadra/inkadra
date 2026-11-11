// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { countByType, readElement, roots, validateBoardDoc } from './doc.ts';
import { generateReferenceBoard, REFERENCE_SIZES } from './reference-board.ts';

// Two boards with a real history: about 4 s on a CI runner, past the default 5 s when it is busy.
it('builds a valid board with the counts of its size, the same for the same seed', {
  timeout: 30_000,
}, () => {
  const spec = REFERENCE_SIZES.small;
  const { update, summary } = generateReferenceBoard('small', 7);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);

  expect(validateBoardDoc(doc)).toEqual([]);
  expect(roots(doc).elements.size).toBe(spec.elements);
  expect(countByType(doc)).toEqual(summary.elements.byType);
  expect(summary.updateBytes).toBe(update.byteLength);

  const elements = roots(doc).elements;
  const table = readElement(elements.get(summary.bench.tableId)!);
  expect(table?.type === 'table' && table.rows.length).toBe(spec.tableRows);
  const drawn = [...elements.values()]
    .map((map) => readElement(map)!)
    .filter((el) => (el.type === 'frame' || el.type === 'plan') && (el.strokes?.length ?? 0) > 0);
  expect(drawn).toHaveLength(spec.drawn);
  for (const el of drawn) {
    const strokes = (el as { strokes: unknown[] }).strokes.length;
    expect(strokes).toBeGreaterThanOrEqual(spec.strokes[0]);
    expect(strokes).toBeLessThanOrEqual(spec.strokes[1]);
  }
  const nodeNames = (node: Y.XmlFragment | Y.XmlElement): string[] =>
    node
      .toArray()
      .flatMap((child) =>
        child instanceof Y.XmlElement ? [child.nodeName, ...nodeNames(child)] : [],
      );
  const rich = [...elements.values()].filter((map) => {
    const body = map.get('body');
    const names = new Set(body instanceof Y.XmlFragment ? nodeNames(body) : []);
    return names.has('taskList') && names.has('mention') && names.has('noteImage');
  });
  expect(rich.length).toBeGreaterThanOrEqual(spec.richNotes);

  // History: many sessions, each with its own client id, edited the board.
  expect(summary.history.clientIds).toBeGreaterThan(spec.sessions / 2);
  expect(summary.history.operations).toBeGreaterThan(spec.moves + spec.deletions);
  expect(generateReferenceBoard('small', 7).update).toEqual(update);
});
