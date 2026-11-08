// SPDX-License-Identifier: AGPL-3.0-only
// The demo instance of the end-to-end tests (decision 0084): the built server with DEMO_MODE on,
// in a database and a Valkey database of its own next to those of the main e2e server, so the
// two never share accounts or job queues. Started by playwright.config.ts.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// The server's own client, which e2e does not depend on.
const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const { default: postgres } = await import(pathToFileURL(require.resolve('postgres')).href);

const main = new URL(process.env.E2E_MAIN_DATABASE_URL);
const demo = new URL(main);
demo.pathname = `${main.pathname}_demo`;
const sql = postgres(main.toString(), { max: 1, onnotice: () => {} });
const name = demo.pathname.slice(1).replace(/[^a-z0-9_]/gi, '_');
await sql.unsafe(`drop database if exists "${name}" with (force)`);
await sql.unsafe(`create database "${name}"`);
await sql.end({ timeout: 1 });

const redis = new URL(process.env.E2E_MAIN_REDIS_URL);
redis.pathname = `/${(Number(redis.pathname.slice(1)) || 0) + 1}`;
process.env.DATABASE_URL = demo.toString();
process.env.REDIS_URL = redis.toString();
process.argv[2] = 'all';
await import('../../apps/server/dist/main.js');
