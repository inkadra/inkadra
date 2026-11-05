import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import {
  relayChallenge,
  relayClean,
  relayFileName,
  relayImage,
  relayMetadata,
  relayVideo,
  sendRelay,
} from './feedback-relay.ts';
import { mediaTools } from './media/tools.ts';

const TICKET = { installId: '0123456789abcdef', ticket: 'ticket', powNonce: '0' };

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
  form.set('report', JSON.stringify(meta));
  expect(await sendRelay(base, form, ticket)).toBe(7);
  expect(bodies).toHaveLength(2);
});
it('marks ambiguous relay writes uncertain and permanent refusals refused', async () => {
  for (const [status, permanent, uncertain] of [
    [502, false, true],
    [413, true, false],
    [429, false, false],
  ] as const) {
    const { base } = await fake(status, JSON.stringify({ error: 'x' }));
    await expect(sendRelay(base, new FormData(), TICKET)).rejects.toMatchObject({
      status,
      permanent,
      uncertain,
    });
  }
});

it('never retries a successful write with a malformed receipt blindly', async () => {
  const { base } = await fake(201, 'invalid JSON');
  await expect(sendRelay(base, new FormData(), TICKET)).rejects.toMatchObject({ uncertain: true });
});

it('retries a relay failure explicitly confirmed before any issue write', async () => {
  const { base } = await fake(503, JSON.stringify({ error: 'daily limit', uncertain: false }));
  await expect(sendRelay(base, new FormData(), TICKET)).rejects.toMatchObject({
    status: 503,
    permanent: false,
    uncertain: false,
  });
});

it('removes the instance host name from text and the device name from files', () => {
  expect(relayClean('log from boards.example.org', 'https://boards.example.org')).toBe(
    'log from [instance]',
  );
  for (const internal of ['192.168.1.20:3000', 'db.lan', 'nas.tail1234.ts.net', hostname()])
    expect(relayClean(`failed ${internal} now`, 'https://a.example')).not.toContain(
      internal.split(':')[0],
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
    waiting: true,
    retryAfterMs: expect.any(Number),
  });
});

async function answering(status: number, body: string, headers: Record<string, string> = {}) {
  const server = createServer((_req, res) => {
    res.statusCode = status;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    res.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

it('a host that is not published yet, or a proxy page, stops no report for good', async () => {
  for (const status of [404, 401, 413, 522]) {
    const base = await answering(status, '<html>not the relay</html>');
    await expect(relayChallenge(base, '0123456789abcdef')).rejects.toMatchObject({
      permanent: false,
    });
  }
  // The relay's own answer about this report does.
  const base = await answering(413, JSON.stringify({ error: 'too large' }));
  await expect(sendRelay(base, new FormData(), TICKET)).rejects.toMatchObject({ permanent: true });
});

it('follows the wait the relay asks for', async () => {
  const base = await answering(429, JSON.stringify({ error: 'network limit' }), {
    'retry-after': '120',
  });
  await expect(relayChallenge(base, '0123456789abcdef')).rejects.toMatchObject({
    retryAfterMs: 120000,
    waiting: false,
  });
});

it('the relay URL must be https, except on this machine', () => {
  const env = {
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgres://unused',
    AUTH_SECRET: 'feedback-test-secret-feedback-test-secret-338',
  };
  const relay = (FEEDBACK_RELAY_URL?: string) =>
    loadConfig({ ...env, ...(FEEDBACK_RELAY_URL === undefined ? {} : { FEEDBACK_RELAY_URL }) })
      .FEEDBACK_RELAY_URL;
  expect(relay()).toMatch(/^https:/);
  expect(relay('')).toBe('');
  expect(relay('https://relay.example/')).toBe('https://relay.example');
  expect(relay('http://127.0.0.1:9')).toBe('http://127.0.0.1:9');
  expect(() => relay('http://relay.example')).toThrow();
});

it('takes GPS off every image that leaves as it came', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-image-'));
  try {
    const plain = { create: { width: 8, height: 8, channels: 3, background: 'red' } } as const;
    // sharp reads by content, so a JPEG shows what the conversion keeps of its metadata.
    const photo = join(dir, 'a.jpg');
    await sharp(plain)
      .withExif({ IFD0: { Copyright: 'WHERE-IT-WAS-TAKEN' } })
      .jpeg()
      .toFile(photo);
    expect((await readFile(photo)).includes('WHERE-IT-WAS-TAKEN')).toBe(true);
    const clean = await relayImage(photo, 'image/tiff', 1000);
    expect(clean?.mime).toBe('image/webp');
    expect(clean?.data.includes('WHERE-IT-WAS-TAKEN')).toBe(false);

    const tiff = join(dir, 'a.tiff');
    await sharp(plain).tiff().toFile(tiff);
    expect((await relayImage(tiff, 'image/tiff', 1000))?.mime).toBe('image/webp');

    const heic = join(import.meta.dirname, 'media/fixtures/gradient.heic');
    const fromHeic = await relayImage(heic, 'image/heic', 40_000_000);
    expect(fromHeic?.mime).toBe('image/webp');
    expect((await sharp(fromHeic?.data).metadata()).format).toBe('webp');

    const gif = join(dir, 'a.gif');
    await sharp(plain).gif().toFile(gif);
    expect((await relayImage(gif, 'image/gif', 1000))?.mime).toBe('image/gif');
    expect(await relayImage(gif, 'image/png', 1000)).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('takes the location off a video, or says it can not', async () => {
  const { ffmpeg } = await mediaTools();
  const dir = await mkdtemp(join(tmpdir(), 'relay-video-'));
  try {
    const file = join(dir, 'a.mov');
    if (!ffmpeg) {
      expect(await relayVideo(file, 'video/quicktime')).toBeNull();
      return;
    }
    await promisify(execFile)(ffmpeg, [
      '-f',
      'lavfi',
      '-i',
      'testsrc=d=0.2:s=64x64',
      '-c:v',
      'mpeg4',
      '-metadata',
      'location=+45.0712+007.6900/',
      '-y',
      file,
    ]);
    expect((await readFile(file)).includes('+45.0712')).toBe(true);
    const clean = await relayVideo(file, 'video/quicktime');
    expect(clean?.length).toBeGreaterThan(0);
    expect(clean?.includes('+45.0712')).toBe(false);
    expect(await relayVideo(file, 'video/x-msvideo')).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
