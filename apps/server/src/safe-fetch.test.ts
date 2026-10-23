import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchRefused, isPublicAddress, safeFetch } from './safe-fetch.ts';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe('safeFetch', () => {
  const html = { accept: ['text/html'], maxBytes: 1024 };
  let port = 0;
  const server = createServer((req, res) => {
    if (req.url === '/to-private') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
    } else if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('x'.repeat(5000));
    } else if (req.url === '/slow') {
      res.writeHead(200, { 'content-type': 'text/html' });
      const timer = setInterval(() => res.write('.'), 50);
      res.on('close', () => clearInterval(timer));
    } else if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    } else {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<title>ok</title>');
    }
  });
  beforeAll(
    () =>
      new Promise<void>((r) =>
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          r();
        }),
      ),
  );
  afterAll(() => server.close());

  it('refuses loopback and private hosts, by address or by name', async () => {
    for (const url of [
      `http://127.0.0.1:${port}/`,
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://localhost/',
      'http://10.0.0.1/',
      'file:///etc/passwd',
      'http://user:pass@example.com/',
    ])
      await expect(safeFetch(url, html)).rejects.toBeInstanceOf(FetchRefused);
  });

  it('refuses a redirect to a private address', async () => {
    // The test server itself is allowed; where it redirects to is not.
    await expect(
      safeFetch(`http://127.0.0.1:${port}/to-private`, { ...html, allowAddresses: ['127.0.0.1'] }),
    ).rejects.toThrow(/public address/);
  });

  it('enforces size, time and type limits', async () => {
    const local = { ...html, allowAddresses: ['127.0.0.1'] };
    expect((await safeFetch(`http://127.0.0.1:${port}/`, local)).body.toString()).toBe(
      '<title>ok</title>',
    );
    await expect(safeFetch(`http://127.0.0.1:${port}/big`, local)).rejects.toThrow(/too large/);
    await expect(
      safeFetch(`http://127.0.0.1:${port}/slow`, { ...local, maxBytes: 1e6, timeoutMs: 300 }),
    ).rejects.toThrow(/too long/);
    await expect(safeFetch(`http://127.0.0.1:${port}/json`, local)).rejects.toThrow(/content type/);
  });
});
