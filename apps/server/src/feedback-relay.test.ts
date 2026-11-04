import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import {
  relayChallenge,
  relayClean,
  relayFileName,
  relayMetadata,
  sendRelay,
} from './feedback-relay.ts';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function fake(status = 201, receipt = JSON.stringify({ number: 7 }), wait = 0) {
  const bodies: string[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    bodies.push(body);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/challenge')
      res.end(JSON.stringify({ ticket: 'ticket', seed: 'seed', bits: 0, nbf: Date.now() + wait }));
    else {
      res.statusCode = status;
      res.end(receipt);
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies };
}
it('solves the relay challenge, redacts logs and sends only selected report fields', async () => {
  const { base, bodies } = await fake();
  const ticket = await relayChallenge(base, '0123456789abcdef');
  const meta = relayMetadata(
    {
      requestId: '00000000-0000-4000-8000-000000000000',
      type: 'question',
      area: 'board',
      title: 'Help',
      description: 'Details',
      guestName: 'Private name',
      attachments: [],
      diagnostics: {
        console: 'password: hidden-value\nCould not reach private.example:3000',
        page: 'https://private.example/a',
      },
    },
    'https://private.example',
  );
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

it('never retries a successful write with a malformed receipt blindly', async () => {
  const { base } = await fake(201, 'invalid JSON');
  await expect(sendRelay(base, new FormData())).rejects.toMatchObject({ uncertain: true });
});

it('retries a relay failure explicitly confirmed before any issue write', async () => {
  const { base } = await fake(503, JSON.stringify({ error: 'daily limit', uncertain: false }));
  await expect(sendRelay(base, new FormData())).rejects.toMatchObject({
    status: 503,
    permanent: false,
    uncertain: false,
  });
});

it('removes the instance host name from text and the device name from files', () => {
  expect(relayClean('log from soyo.example.org', 'https://soyo.example.org')).toBe(
    'log from [instance]',
  );
  expect(relayFileName({ kind: 'file', name: 'Mario Rossi contract.PDF' }, 2)).toBe('file-3.PDF');
  expect(relayFileName({ kind: 'video', name: 'no-extension' }, 0)).toBe('video-1');
  expect(relayFileName({ kind: 'file', name: 'a.Mario Rossi' }, 0)).toBe('file-1');
});

it('leaves a long relay wait in the queue instead of holding the report', async () => {
  const { base } = await fake(201, '{}', 15 * 60000);
  await expect(relayChallenge(base, '0123456789abcdef')).rejects.toMatchObject({
    status: 429,
    uncertain: false,
    permanent: false,
  });
});
