// SPDX-License-Identifier: MPL-2.0
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/**
 * Every date of the interface goes through `DateField` (packages/ui/src/date-field.tsx), which
 * opens Inkadra's calendar: a native date input or the browser's picker would bring back the
 * unstyled popup. Tests may still look for the field's own input.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const own = join(root, 'packages/ui/src/date-field.tsx');
const native = /type=\{?["']date["']|type:\s*["']date["']|datetime-local|showPicker/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it('tells native date inputs from the rest', () => {
  for (const text of ['<input type="date" />', "type='date'", 'type={"date"}', "{ type: 'date' }"])
    expect(native.test(text)).toBe(true);
  expect(native.test('<input type="datetime-local" />')).toBe(true);
  expect(native.test('input.showPicker()')).toBe(true);
  expect(native.test('<input type="time" />')).toBe(false);
  expect(native.test('<DateField label="Due" />')).toBe(false);
});

it('uses DateField for every date', () => {
  const dirs = [
    'apps/web/src',
    ...readdirSync(join(root, 'packages')).map((name) => `packages/${name}/src`),
  ];
  const found = dirs
    .flatMap((dir) => {
      try {
        return files(join(root, dir));
      } catch {
        return [];
      }
    })
    .filter((file) => file !== own && native.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(root.length));
  expect(
    found,
    'use DateField from @inkadra/ui (packages/ui/src/date-field.tsx), never a native date input or picker',
  ).toEqual([]);
});
