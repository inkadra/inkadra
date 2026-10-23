#!/usr/bin/env node
// Container health check for every role of the image (Dockerfile HEALTHCHECK).
// The role is the last argument of the main process: `tini -- node /app/dist/main.js <role>`.
import { readFileSync } from 'node:fs';

const ROLES = ['all', 'web', 'collab', 'worker', 'migrate'];

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
  if (current === 'all' || current === 'web') {
    await check(`http://127.0.0.1:${process.env.PORT || 3000}/api/v1/health`);
  } else if (current === 'collab') {
    await check(`http://127.0.0.1:${process.env.COLLAB_PORT || 3001}/`);
  }
  // `worker` has no port and `migrate` exits when done: the process being alive is enough.
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
