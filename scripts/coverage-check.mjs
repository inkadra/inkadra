// Coverage floors (#852): each workspace's line and branch coverage, from the json-summary
// report of `vitest run --coverage`, must stay at or above its floor in coverage-floors.json.
// Usage: node scripts/coverage-check.mjs <workspace dir>...
// The floors are the level measured in CI minus two points: raise them when coverage grows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One line per workspace that fell under its floor, or has no floor or no report. */
export function check(floors, summaries) {
  const problems = [];
  for (const [dir, summary] of Object.entries(summaries)) {
    const floor = floors[dir];
    if (!floor) problems.push(`${dir}: no floor in scripts/coverage-floors.json`);
    else if (!summary) problems.push(`${dir}: no coverage report`);
    else
      for (const metric of ['lines', 'branches']) {
        const pct = summary.total[metric].pct;
        if (pct < floor[metric]) problems.push(`${dir}: ${metric} ${pct}% < floor ${floor[metric]}%`);
      }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const floors = JSON.parse(readFileSync(new URL('./coverage-floors.json', import.meta.url), 'utf8'));
  const summaries = {};
  for (const dir of process.argv.slice(2)) {
    try {
      summaries[dir] = JSON.parse(readFileSync(join(dir, 'coverage', 'coverage-summary.json'), 'utf8'));
      const { lines, branches } = summaries[dir].total;
      console.log(`${dir}: lines ${lines.pct}%, branches ${branches.pct}%`);
    } catch {
      summaries[dir] = null;
    }
  }
  const problems = check(floors, summaries);
  for (const p of problems) console.error(p);
  process.exit(problems.length > 0 ? 1 : 0);
}
