#!/usr/bin/env node
// Fails when a production dependency has a licence that is not compatible with
// distributing Inkadra under AGPL-3.0. Add exceptions only with a note in docs/decisions.
import { execFileSync } from 'node:child_process';

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
]);

/** Packages whose licence field is missing or non-SPDX but were checked by hand. */
const REVIEWED = new Map([]);

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(raw);

function ok(expr) {
  // Accept SPDX expressions where every alternative of an OR, or every part of an AND, is allowed.
  const clean = expr.replace(/[()]/g, '').trim();
  if (clean.includes(' OR ')) return clean.split(' OR ').some((p) => ok(p));
  if (clean.includes(' AND ')) return clean.split(' AND ').every((p) => ok(p));
  return ALLOWED.has(clean);
}

const problems = [];
let count = 0;
for (const [license, pkgs] of Object.entries(byLicense)) {
  for (const pkg of pkgs) {
    count += 1;
    if (ok(license) || REVIEWED.has(pkg.name)) continue;
    problems.push(`${pkg.name}@${pkg.versions.join(',')}: ${license}`);
  }
}

if (problems.length > 0) {
  console.error(`Licences to review (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`${count} production packages, all with allowed licences.`);
