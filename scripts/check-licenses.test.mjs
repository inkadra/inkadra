import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check, missingSpdx } from './check-licenses.mjs';

test('counts every package and flags only licences outside the allow-list', () => {
  const pkg = (name) => ({ name, versions: ['1.0.0'] });
  const result = check({
    MIT: [pkg('a'), pkg('b')],
    '(MIT OR GPL-3.0)': [pkg('c')],
    '(MIT AND GPL-3.0)': [pkg('d')],
    Unknown: [pkg('combine-errors'), pkg('e')],
  });
  assert.equal(result.count, 6);
  assert.deepEqual(result.problems, ['d@1.0.0: (MIT AND GPL-3.0)', 'e@1.0.0: Unknown']);
  assert.deepEqual(check({}), { count: 0, problems: [] });
});

test('the MPL-2.0 components may not depend on AGPL, GPL or LGPL code, even reviewed', () => {
  const pkg = (name) => ({ name, versions: ['1.0.0'] });
  const byLicense = {
    MIT: [pkg('a')],
    'AGPL-3.0-only': [pkg('b')],
    'LGPL-3.0-or-later': [pkg('c')],
    '(MIT OR LGPL-3.0)': [pkg('d')],
    Unknown: [pkg('libheif-js'), pkg('combine-errors')],
  };
  assert.deepEqual(check(byLicense).problems, []);
  assert.deepEqual(check(byLicense, { mpl: true }).problems, [
    'b@1.0.0: AGPL-3.0-only',
    'c@1.0.0: LGPL-3.0-or-later',
    'libheif-js@1.0.0: Unknown',
  ]);
});

test('every source file of an MPL-2.0 component starts with its SPDX line', () => {
  const files = {
    'packages/ui/src/a.ts': '// SPDX-License-Identifier: MPL-2.0\nexport {};',
    'packages/ui/src/b.ts': 'export {};\n',
    'packages/ui/src/c.css': '/* SPDX-License-Identifier: MPL-2.0 */\n',
    'packages/ui/src/d.tsx': '#!/usr/bin/env node\n// SPDX-License-Identifier: MPL-2.0\n',
    'packages/ui/package.json': '{}',
    'apps/clipper/src/e.mjs': 'export {};\n',
    'apps/web/src/f.ts': 'export {};\n',
  };
  assert.deepEqual(
    missingSpdx(Object.keys(files), (f) => files[f]),
    ['packages/ui/src/b.ts', 'apps/clipper/src/e.mjs'],
  );
});
