import { perfUser, seedPerfBoard } from '../tests/perf/seed.ts';

/**
 * Creates the gate 0.2 load-test board (1000 elements, over 500 images) on any instance,
 * without timing anything:
 *
 *   PERF_BASE_URL=https://inkadra.example.org PERF_EMAIL=… PERF_PASSWORD=… \
 *     pnpm --filter @inkadra/e2e seed:perf
 *
 * The account signs in; it is created only on an instance that has no users yet. Behind a
 * reverse proxy, https:// in the URL makes the collaboration socket use wss://.
 */

const base = (process.env.PERF_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname);
const email = process.env.PERF_EMAIL ?? (local ? perfUser.email : undefined);
const password = process.env.PERF_PASSWORD ?? (local ? perfUser.password : undefined);
if (!email || !password) {
  console.error(`PERF_EMAIL and PERF_PASSWORD are required for ${base}.`);
  process.exit(1);
}

const seeded = await seedPerfBoard(base, {
  account: { name: process.env.PERF_NAME ?? perfUser.name, email, password },
  name: process.env.PERF_BOARD_NAME ?? 'Test di carico',
  total: Number(process.env.PERF_TOTAL ?? 1000),
});
console.log(
  JSON.stringify(
    {
      board: `${base}/p/${seeded.projectId}`,
      counts: seeded.counts,
      images: seeded.images,
    },
    null,
    2,
  ),
);
