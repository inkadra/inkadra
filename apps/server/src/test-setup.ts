// Every Fastify instance a test builds checks its answers against the API contract
// (test-response-contract.ts); the test that made a request fails on a mismatch.
import { afterAll, afterEach, beforeEach, expect, vi } from 'vitest';
import {
  checkResponses,
  currentOwner,
  setOwner,
  settled,
  takeMismatches,
} from './test-response-contract.ts';
import { fileTmpDir, removeTempDirs } from './test-tmpdir.ts';

fileTmpDir(expect.getState().testPath);
// Registered before the hooks below, so it runs after every other afterAll of the file.
afterAll(removeTempDirs);

vi.mock('fastify', async (original) => {
  const fastify = await original<typeof import('fastify')>();
  const checked = ((options?: object) => {
    const app = fastify.default(options);
    checkResponses(app as never);
    return app;
  }) as unknown as typeof fastify.default;
  return { ...fastify, default: checked, fastify: checked };
});

function fail(found: string[], who: string) {
  if (found.length)
    throw new Error(`Answers that do not match the API contract (${who}):\n${found.join('\n')}`);
}
let attempts = 0;
beforeEach(({ task }) => {
  attempts += 1;
  setOwner({ id: `${task.id}#${attempts}`, label: `"${task.name}" (attempt ${attempts})` });
});
afterEach(() => {
  const owner = currentOwner();
  setOwner(null);
  fail(takeMismatches(owner), 'this test');
});
// Registered first, so it runs after every other afterAll of the file.
afterAll(async () => {
  await settled();
  fail(takeMismatches(), 'suite hooks, or answers that arrived after their test');
});
