// Every Fastify instance a test builds checks its answers against the API contract
// (test-response-contract.ts); the test that made a request fails on a mismatch.
import { afterAll, afterEach, vi } from 'vitest';
import { checkResponses, takeMismatches } from './test-response-contract.ts';

vi.mock('fastify', async (original) => {
  const fastify = await original<typeof import('fastify')>();
  const checked = ((options?: object) => {
    const app = fastify.default(options);
    checkResponses(app as never);
    return app;
  }) as unknown as typeof fastify.default;
  return { ...fastify, default: checked, fastify: checked };
});

function failOnMismatch() {
  const found = takeMismatches();
  if (found.length)
    throw new Error(`Answers that do not match the API contract:\n${found.join('\n')}`);
}
afterEach(failOnMismatch);
afterAll(failOnMismatch);
