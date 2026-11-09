// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { seedLowTide } from './low-tide.ts';
import { api, seedSampleProject } from './sample-project.ts';

/**
 * Rebuilds the demo's sample projects (decision 0084), the archives in apps/server/demo/ that
 * every demo sandbox imports: "Last Train" of the screenshots (last-train.inkadra) and the photo
 * shoot "Low Tide" (low-tide.inkadra). Run it against an empty instance that is not in demo
 * mode, after a change to the archive format or to a sample; name one project to rebuild only
 * that one:
 *
 *   SHOTS_BASE_URL=http://localhost:3100 pnpm --filter @inkadra/e2e exec tsx scripts/demo-seed.ts [last-train|low-tide]
 *
 * The demo keeps the shooting days as far from today as they were from the day of the export,
 * so run it in the daytime: the export date is in UTC, the seed's dates in local time.
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const only = process.argv[2];
const outOf = (name: string) =>
  fileURLToPath(new URL(`../../apps/server/demo/${name}.inkadra`, import.meta.url));

async function exportTo(cookie: string, projectId: string, out: string) {
  const started = await api<{ id: string }>(base, cookie, `/projects/${projectId}/exports`, {});
  for (let i = 0; ; i++) {
    const res = await fetch(`${base}/api/v1/transfers/${started.id}`, { headers: { cookie } });
    const transfer = (await res.json()) as { status: string };
    if (transfer.status === 'ready') break;
    if (transfer.status === 'failed' || i > 120) throw new Error(`Export ${transfer.status}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const file = await fetch(`${base}/api/v1/transfers/${started.id}/download`, {
    headers: { cookie },
  });
  if (!file.ok) throw new Error(`Download failed: ${file.status}`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(await file.arrayBuffer()));
  console.log(`wrote ${out}`);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  if (!only || only === 'last-train') {
    const { cookie, project } = await seedSampleProject(browser, base);
    await exportTo(cookie, project.id, outOf('last-train'));
  }
  if (!only || only === 'low-tide') {
    const { cookie, project } = await seedLowTide(browser, base);
    await exportTo(cookie, project.id, outOf('low-tide'));
  }
} finally {
  await browser.close();
}
