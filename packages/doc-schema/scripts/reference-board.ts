// SPDX-License-Identifier: MPL-2.0
// Writes a reference board: pnpm --filter @inkadra/doc-schema reference-board --size medium
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  generateReferenceBoard,
  REFERENCE_SIZES,
  type ReferenceBoardSize,
} from '../src/reference-board.ts';

const { values } = parseArgs({
  options: {
    size: { type: 'string', default: 'medium' },
    seed: { type: 'string', default: '1' },
    out: { type: 'string', default: 'reference-boards' },
  },
});
const size = values.size as ReferenceBoardSize;
const seed = Number(values.seed);
if (!(size in REFERENCE_SIZES)) throw new Error('--size is small, medium or large.');
if (!Number.isSafeInteger(seed)) throw new Error('--seed is an integer.');

const started = performance.now();
const { update, summary } = generateReferenceBoard(size, seed);
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const name = join(out, `reference-board-${size}-${seed}`);
writeFileSync(`${name}.ybin`, update);
writeFileSync(`${name}.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `${name}.ybin: ${summary.elements.total} elements, ${summary.updateBytes} bytes, ` +
    `${summary.history.operations} operations by ${summary.history.clientIds} client ids ` +
    `in ${Math.round(performance.now() - started)} ms`,
);
