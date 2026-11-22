import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { check, missingSpdx, trackedFiles, verdict } from './check-licenses.mjs';

test('counts every package and flags only licences outside the allow-list', () => {
  const pkg = (name, version = '1.0.0') => ({ name, versions: [version] });
  const result = check({
    MIT: [pkg('a'), pkg('b')],
    '(MIT OR GPL-3.0)': [pkg('c')],
    '(MIT AND GPL-3.0)': [pkg('d')],
    Unknown: [pkg('combine-errors', '3.0.3'), pkg('e')],
  });
  assert.equal(result.count, 6);
  assert.deepEqual(result.problems, ['d@1.0.0: (MIT AND GPL-3.0)', 'e@1.0.0: Unknown']);
  assert.deepEqual(check({}), { count: 0, problems: [] });
});

test('SPDX expressions: AND before OR, parentheses group, review beats any OR', () => {
  const allowed = new Set(['MIT', 'Apache-2.0', 'Zlib', 'LGPL-3.0-only']);
  const mit = new Set(['MIT', 'Apache-2.0', 'Zlib']);
  const cases = [
    ['MIT', mit, 'allowed'],
    ['MIT OR Apache-2.0', mit, 'allowed'],
    ['(MIT AND Zlib)', mit, 'allowed'],
    ['(MIT OR GPL-3.0-only)', mit, 'allowed'],
    ['GPL-3.0-only OR MIT AND Zlib', mit, 'allowed'],
    ['MIT AND (GPL-3.0-only OR Zlib)', mit, 'allowed'],
    ['MIT AND GPL-3.0-only OR Zlib', mit, 'allowed'],
    // The OR inside the parentheses does not excuse the LGPL the AND requires.
    ['(MIT OR GPL-3.0-only) AND LGPL-3.0-only', mit, 'denied'],
    ['(MIT OR GPL-3.0-only) AND LGPL-3.0-only', allowed, 'allowed'],
    ['MIT AND GPL-3.0-only', mit, 'denied'],
    ['GPL-3.0-only', mit, 'denied'],
    // A branch that needs a review is not routed around by an allowed one.
    ['MIT OR Apache-2.0 WITH LLVM-exception', mit, 'review'],
    ['MIT OR UNLICENSED', mit, 'review'],
    ['MIT OR LicenseRef-Custom', mit, 'review'],
    ['SEE LICENSE IN LICENSE.md', mit, 'review'],
    ['Unknown', mit, 'review'],
    // An id this check does not know is not a licence an OR may skip.
    ['MIT OR NotAnSpdxId', mit, 'review'],
    ['NotAnSpdxId', mit, 'review'],
    ['(MIT OR Apache-2.0 WITH LLVM-exception)', mit, 'review'],
    ['(MIT OR UNLICENSED)', mit, 'review'],
    ['(Apache-2.0 WITH LLVM-exception) AND MIT', mit, 'review'],
    ['MIT OR (GPL-3.0-only AND UNLICENSED)', mit, 'review'],
  ];
  for (const [expr, list, expected] of cases) assert.equal(verdict(expr, list), expected, expr);
  for (const odd of ['(MIT', 'MIT)', 'MIT OR', 'AND MIT', '', 'MIT OR (Apache-2.0']) {
    assert.equal(verdict(odd, allowed), 'review', odd);
  }
});

test('a hand review holds only for the versions and licence string it saw', () => {
  const pkg = (name, version) => ({ name, versions: [version] });
  assert.deepEqual(check({ Unknown: [pkg('combine-errors', '3.0.3')] }).problems, []);
  assert.deepEqual(check({ Unknown: [pkg('combine-errors', '3.0.4')] }).problems, [
    'combine-errors@3.0.4: Unknown',
  ]);
  assert.deepEqual(check({ 'GPL-3.0-only': [pkg('combine-errors', '3.0.3')] }).problems, [
    'combine-errors@3.0.3: GPL-3.0-only',
  ]);
  assert.deepEqual(check({ 'LGPL-3.0': [pkg('libheif-js', '1.23.5')] }).problems, []);
});

test('the MPL-2.0 components may not depend on AGPL, GPL or LGPL code, even reviewed', () => {
  const pkg = (name, version = '1.0.0') => ({ name, versions: [version] });
  const byLicense = {
    MIT: [pkg('a')],
    'AGPL-3.0-only': [pkg('b')],
    'LGPL-3.0-or-later': [pkg('c')],
    '(MIT OR LGPL-3.0)': [pkg('d')],
    'LGPL-3.0': [pkg('libheif-js', '1.23.5')],
    Unknown: [pkg('combine-errors', '3.0.3')],
  };
  assert.deepEqual(check(byLicense).problems, []);
  assert.deepEqual(check(byLicense, { mpl: true }).problems, [
    'b@1.0.0: AGPL-3.0-only',
    'c@1.0.0: LGPL-3.0-or-later',
    'libheif-js@1.23.5: LGPL-3.0',
  ]);
});

test('every source file of an MPL-2.0 component starts with its exact SPDX line', () => {
  const files = {
    'packages/ui/src/a.ts': '// SPDX-License-Identifier: MPL-2.0\nexport {};',
    'packages/ui/src/b.ts': 'export {};\n',
    'packages/ui/src/c.css': '/* SPDX-License-Identifier: MPL-2.0 */\n',
    'packages/ui/src/d.tsx': '#!/usr/bin/env node\n// SPDX-License-Identifier: MPL-2.0\n',
    'packages/ui/src/g.ts': '// SPDX-License-Identifier: MPL-2.0 AND GPL-3.0-only\n',
    'packages/ui/src/h.ts': '// not SPDX-License-Identifier: MPL-2.0\n',
    'packages/ui/src/ü é.ts': '// SPDX-License-Identifier: MPL-2.0\n',
    'packages/ui/package.json': '{}',
    'apps/clipper/src/e.mjs': 'export {};\n',
    'apps/web/src/f.ts': 'export {};\n',
  };
  assert.deepEqual(
    missingSpdx(Object.keys(files), (f) => files[f]),
    [
      'packages/ui/src/b.ts',
      'packages/ui/src/g.ts',
      'packages/ui/src/h.ts',
      'apps/clipper/src/e.mjs',
    ],
  );
});

test('lists tracked paths with non-ASCII characters as they are', () => {
  const root = mkdtempSync(join(tmpdir(), 'spdx-'));
  try {
    mkdirSync(join(root, 'packages/ui/src'), { recursive: true });
    writeFileSync(join(root, 'packages/ui/src/città.ts'), 'export {};\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    assert.deepEqual(trackedFiles(root), ['packages/ui/src/città.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
