// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { api, seedSampleProject } from './sample-project.ts';

/**
 * Rebuilds the demo's sample project (decision 0084), apps/server/demo/last-train.inkadra:
 * "Last Train" of the screenshots, exported as an archive that every demo sandbox imports.
 * Run it against an empty instance that is not in demo mode, after a change to the archive
 * format or to the sample:
 *
 *   SHOTS_BASE_URL=http://localhost:3100 pnpm --filter @inkadra/e2e exec tsx scripts/demo-seed.ts
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const out =
  process.env.DEMO_SEED_OUT ??
  fileURLToPath(new URL('../../apps/server/demo/last-train.inkadra', import.meta.url));

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  const { cookie, project } = await seedSampleProject(browser, base);
  const started = await api<{ id: string }>(base, cookie, `/projects/${project.id}/exports`, {});
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
} finally {
  await browser.close();
}
