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
 *
 * Archives carry no crew (decision 0091): next to each archive goes `<name>.crew.json`, the
 * sample's Troupe and day calls by name, which the demo writes into each sandbox (decision 0132).
 */

const base = (process.env.SHOTS_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const only = process.argv[2];
const outOf = (name: string, ext = 'inkadra') =>
  fileURLToPath(new URL(`../../apps/server/demo/${name}.${ext}`, import.meta.url));

const read = async <T>(cookie: string, path: string): Promise<T> => {
  const res = await fetch(`${base}/api/v1${path}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return (await res.json()) as T;
};

interface CrewRow {
  id: string;
  name: string;
  role: string;
  department: string;
  phone: string;
  email: string;
  pickup: string;
  notes: string;
  onSetContact: boolean;
  character: { boardId: string; elementId: string } | null;
}

/** The Troupe and the day calls of a project, by board title and name, without accounts. */
async function writeCrew(cookie: string, projectId: string, out: string) {
  const boards = await read<{ items: Array<{ id: string; title: string; kind: string }> }>(
    cookie,
    `/projects/${projectId}/boards`,
  );
  const title = new Map(boards.items.map((b) => [b.id, b.title]));
  const production = boards.items.find((b) => b.kind === 'production');
  const { items: rows } = await read<{ items: CrewRow[] }>(cookie, `/projects/${projectId}/crew`);
  const days = production
    ? (
        await read<{
          items: Array<{
            date: string;
            callTime: string;
            calls?: Array<{
              crewMemberId: string;
              call: string | null;
              pickup: string | null;
              absent?: boolean;
            }>;
          }>;
        }>(cookie, `/boards/${production.id}/schedule`)
      ).items
    : [];
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  const crew = {
    crew: rows.map((r) => ({
      name: r.name,
      role: r.role,
      department: r.department,
      phone: r.phone,
      email: r.email,
      pickup: r.pickup,
      notes: r.notes,
      onSetContact: r.onSetContact,
      character: r.character
        ? { board: title.get(r.character.boardId) as string, elementId: r.character.elementId }
        : null,
    })),
    calls: days.flatMap((d) =>
      (d.calls ?? []).map((c) => ({
        date: d.date,
        dayCall: d.callTime,
        name: nameOf.get(c.crewMemberId) as string,
        call: c.call,
        pickup: c.pickup,
        ...(c.absent === undefined ? {} : { absent: c.absent }),
      })),
    ),
  };
  writeFileSync(out, `${JSON.stringify(crew, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

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
    await writeCrew(cookie, project.id, outOf('last-train', 'crew.json'));
  }
  if (!only || only === 'low-tide') {
    const { cookie, project } = await seedLowTide(browser, base);
    await exportTo(cookie, project.id, outOf('low-tide'));
    await writeCrew(cookie, project.id, outOf('low-tide', 'crew.json'));
  }
} finally {
  await browser.close();
}
