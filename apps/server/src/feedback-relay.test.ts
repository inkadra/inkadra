import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { relayChallenge, relayMetadata, sendRelay } from './feedback-relay.ts';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function fake(status = 201) {
  const bodies: string[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    bodies.push(body);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/challenge')
      res.end(JSON.stringify({ ticket: 'ticket', seed: 'seed', bits: 0, nbf: Date.now() }));
    else {
      res.statusCode = status;
      res.end(JSON.stringify({ number: 7 }));
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies };
}
it('solves the relay challenge, redacts logs and sends only selected report fields', async () => {
  const { base, bodies } = await fake();
  const ticket = await relayChallenge(base, '0123456789abcdef');
  const meta = relayMetadata({
    requestId: '00000000-0000-4000-8000-000000000000',
    type: 'question',
    area: 'board',
    title: 'Help',
    description: 'Details',
    guestName: 'Private name',
    attachments: [],
    diagnostics: { console: 'password: hidden-value', page: 'https://private.example/a' },
  });
  expect(JSON.stringify(meta)).not.toContain('Private name');
  expect(meta.logExcerpt).not.toContain('hidden-value');
  expect(JSON.stringify(meta)).not.toContain('private.example');
  const form = new FormData();
  form.set('report', JSON.stringify({ ...meta, ...ticket }));
  expect(await sendRelay(base, form)).toBe(7);
  expect(bodies).toHaveLength(2);
});
it('marks ambiguous relay writes uncertain and permanent refusals refused', async () => {
  for (const [status, permanent, uncertain] of [
    [502, false, true],
    [413, true, false],
    [429, false, false],
  ] as const) {
    const { base } = await fake(status);
    await expect(sendRelay(base, new FormData())).rejects.toMatchObject({
      status,
      permanent,
      uncertain,
    });
  }
});
