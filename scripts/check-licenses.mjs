#!/usr/bin/env node
// Fails when a production dependency has a licence that is not compatible with
// distributing Inkadra under AGPL-3.0, or, for the MPL-2.0 components (packages/* and
// apps/clipper), with MPL-2.0 (docs/decisions/0008). Add exceptions only with a note in
// docs/decisions.
import { execFileSync } from 'node:child_process';
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

/** Packages whose licence field is missing or non-SPDX but were checked by hand. */
const REVIEWED = new Map([
  // LGPL-3.0-only WebAssembly build of libheif, loaded unmodified (docs/decisions/0009).
  ['libheif-js', 'LGPL-3.0'],
  // Dependency of tus-js-client; MIT per its Readme, the package.json has no licence field.
  ['combine-errors', 'MIT'],
]);

function ok(expr, allowed) {
  // Accept SPDX expressions where every alternative of an OR, or every part of an AND, is allowed.
  const clean = expr.replace(/[()]/g, '').trim();
  if (clean.includes(' OR ')) return clean.split(' OR ').some((p) => ok(p, allowed));
  if (clean.includes(' AND ')) return clean.split(' AND ').every((p) => ok(p, allowed));
  return allowed.has(clean);
}

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
      if (ok(license, allowed) || (reviewed && (!mpl || ok(reviewed, allowed)))) continue;
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
