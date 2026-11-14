#!/usr/bin/env node
// Container health check for every role of the image (Dockerfile HEALTHCHECK).
// The role is the last argument of the main process: `tini -- node /app/dist/main.js <role>`.
import { readFileSync, statSync } from 'node:fs';

const ROLES = ['all', 'web', 'collab', 'worker', 'migrate'];
/** Written every 10 s by the worker (main.ts, WORKER_HEARTBEAT). */
const WORKER_HEARTBEAT = '/tmp/inkadra-worker-heartbeat';
const WORKER_STALE_MS = 60_000;

function role() {
  try {
    const args = readFileSync('/proc/1/cmdline', 'utf8').split('\0').filter(Boolean);
    const last = args.at(-1);
    return ROLES.includes(last) ? last : 'all';
  } catch {
    return 'all';
  }
}

async function check(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
}

const current = role();
try {
  // Liveness only (#816): a database or Valkey outage must not mark the container unhealthy.
  // /readyz says whether it can serve requests.
  if (current === 'all' || current === 'web') {
    await check(`http://127.0.0.1:${process.env.PORT || 3000}/livez`);
  } else if (current === 'collab') {
    await check(`http://127.0.0.1:${process.env.COLLAB_PORT || 3001}/`);
  } else if (current === 'worker') {
    // No port: its heartbeat file says the event loop still turns.
    const age = Date.now() - statSync(WORKER_HEARTBEAT).mtimeMs;
    if (age > WORKER_STALE_MS) throw new Error(`worker heartbeat ${Math.round(age / 1000)} s old`);
  }
  // `migrate` exits when done: the process being alive is enough.
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
