#!/usr/bin/env node
// Fails when a production dependency has a licence that is not compatible with
// distributing Inkadra under AGPL-3.0, or, for the MPL-2.0 components (packages/* and
// apps/clipper), with MPL-2.0 (docs/decisions/0008). Add exceptions only with a note in
// docs/decisions.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED = new Set([
  '0BSD',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'OFL-1.1',
  'Python-2.0',
  'Unlicense',
  'Zlib',
]);

/** What code an MPL-2.0 component imports may use: MPL-2.0 or more permissive (decision 0008). */
const MPL_ALLOWED = new Set([...ALLOWED].filter((l) => !/^(A|L)?GPL-/.test(l)));

/** The MPL-2.0 components, as pnpm filters. Their workspace dependencies are packages too. */
const MPL_COMPONENTS = ['./packages/*', './apps/clipper'];

/**
 * Packages whose licence field is missing or non-SPDX but were checked by hand: only the versions
 * reviewed, and only while pnpm still reports the licence string seen then. Another version or
 * another string needs a new review.
 */
const REVIEWED = new Map([
  // LGPL-3.0-only WebAssembly build of libheif, loaded unmodified (docs/decisions/0009).
  ['libheif-js', { versions: ['1.23.5'], seen: 'LGPL-3.0', license: 'LGPL-3.0-only' }],
  // Dependency of tus-js-client; MIT per its Readme, the package.json has no licence field.
  ['combine-errors', { versions: ['3.0.3'], seen: 'Unknown', license: 'MIT' }],
]);

/** Files of the MPL-2.0 components that must start with their SPDX line (decision 0008). */
const MPL_SOURCES =
  /^(packages\/[^/]+|apps\/clipper)\/.*\.(c|m)?(j|t)sx?$|^(packages\/[^/]+|apps\/clipper)\/.*\.css$/;

/** The header line itself, as a line comment or a block comment; nothing else on the line. */
const SPDX_LINES = new Set([
  '// SPDX-License-Identifier: MPL-2.0',
  '/* SPDX-License-Identifier: MPL-2.0 */',
]);

/** The tracked source files of the MPL-2.0 components whose first lines lack the SPDX line. */
export function missingSpdx(files, read) {
  return files.filter(
    (file) =>
      MPL_SOURCES.test(file) &&
      !read(file)
        .split('\n', 3)
        .some((line) => SPDX_LINES.has(line.trim())),
  );
}

/** The tracked files of the MPL-2.0 components, with -z so a non-ASCII path is not quoted. */
export function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z', 'packages', 'apps/clipper'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

/**
 * What an SPDX expression means with `allowed` licences: 'allowed', 'denied' (a licence id not
 * on the list, which an OR can route around) or 'review' (a WITH exception, UNLICENSED, a
 * LicenseRef, "SEE LICENSE IN …", anything unreadable). AND binds tighter than OR, parentheses
 * group, and a branch that needs review makes the whole expression need review, OR or not.
 * shortcut: no WITH exception is known yet; list the ones reviewed here when one shows up.
 */
export function verdict(expr, allowed) {
  const tokens = expr.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const next = () => tokens[at++];
  // Review wins over everything; then OR needs one allowed side, AND both.
  const join = (a, b, need) =>
    a === 'review' || b === 'review'
      ? 'review'
      : need === 'any'
        ? a === 'allowed' || b === 'allowed'
          ? 'allowed'
          : 'denied'
        : a === 'allowed' && b === 'allowed'
          ? 'allowed'
          : 'denied';
  const or = () => {
    let value = and();
    while (tokens[at] === 'OR') {
      next();
      value = join(value, and(), 'any');
    }
    return value;
  };
  const and = () => {
    let value = term();
    while (tokens[at] === 'AND') {
      next();
      value = join(value, term(), 'all');
    }
    return value;
  };
  const term = () => {
    const token = next();
    if (token === '(') {
      const value = or();
      if (next() !== ')') throw new Error('unbalanced');
      return value;
    }
    if (!token || ['AND', 'OR', 'WITH', ')'].includes(token)) throw new Error('unexpected');
    if (tokens[at] === 'WITH') {
      next();
      if (!next()) throw new Error('exception');
      return 'review';
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]*\+?$/.test(token)) throw new Error('not an id');
    if (token === 'UNLICENSED' || token === 'Unknown' || token.startsWith('LicenseRef-')) {
      return 'review';
    }
    return allowed.has(token) ? 'allowed' : 'denied';
  };
  try {
    const value = or();
    return at === tokens.length ? value : 'review';
  } catch {
    return 'review';
  }
}

const ok = (expr, allowed) => verdict(expr, allowed) === 'allowed';

/**
 * Returns how many packages `pnpm licenses list --json` gave and which ones need a review.
 * `mpl` checks the dependencies of an MPL-2.0 component: no AGPL, GPL or LGPL; a reviewed
 * package passes there only when its reviewed licence is allowed.
 */
export function check(byLicense, { mpl = false } = {}) {
  const allowed = mpl ? MPL_ALLOWED : ALLOWED;
  const problems = [];
  let count = 0;
  for (const [license, pkgs] of Object.entries(byLicense)) {
    for (const pkg of pkgs) {
      count += 1;
      const reviewed = REVIEWED.get(pkg.name);
      const asReviewed =
        reviewed &&
        reviewed.seen === license &&
        pkg.versions.every((v) => reviewed.versions.includes(v)) &&
        (!mpl || ok(reviewed.license, allowed));
      if (ok(license, allowed) || asReviewed) continue;
      problems.push(`${pkg.name}@${pkg.versions.join(',')}: ${license}`);
    }
  }
  return { count, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = (filters) =>
    JSON.parse(
      execFileSync('pnpm', ['licenses', 'list', ...filters, '--prod', '--json'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  // The root package has no dependencies of its own: without --recursive pnpm returns {} and
  // the check passed with 0 packages. It now lists every workspace package's dependencies.
  const runs = [
    ['Workspace', check(list(['--recursive']))],
    [
      'MPL-2.0 components',
      check(list(MPL_COMPONENTS.flatMap((f) => ['--filter', f])), { mpl: true }),
    ],
  ];
  let failed = false;
  const root = fileURLToPath(new URL('..', import.meta.url));
  const unmarked = missingSpdx(trackedFiles(root), (file) =>
    readFileSync(join(root, file), 'utf8'),
  );
  if (unmarked.length > 0) {
    console.error(
      `Files without "SPDX-License-Identifier: MPL-2.0" in their first lines (${unmarked.length}):\n  ${unmarked.join('\n  ')}`,
    );
    failed = true;
  }
  for (const [name, { count, problems }] of runs) {
    if (count === 0) {
      console.error(
        `${name}: pnpm licenses list returned no production packages: nothing was checked.`,
      );
      failed = true;
    } else if (problems.length > 0) {
      console.error(
        `${name}: licences to review (${problems.length}):\n  ${problems.join('\n  ')}`,
      );
      failed = true;
    } else {
      console.log(`${name}: ${count} production packages, all with allowed licences.`);
    }
  }
  if (failed) process.exit(1);
}
