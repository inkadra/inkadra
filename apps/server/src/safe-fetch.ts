import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Fetching addresses given by users, without letting them reach the server's own network
 * (SSRF). Every hop, redirects included, must be http(s) on the default port and resolve only
 * to public addresses; the connection uses the address that was checked, so a second DNS
 * answer cannot swap it.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  // IPv4-compatible (::a.b.c.d) and the unspecified and loopback addresses.
  ['::', 96],
  ['::1', 128],
  ['100::', 64],
  // Teredo and 6to4 tunnel an IPv4 address that could be internal.
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** IPv4 carried inside an IPv6 address (mapped, compatible, NAT64), if any. */
function embeddedV4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1] ?? null;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1] ?? '0', 16);
  const lo = Number.parseInt(hex[2] ?? '0', 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) {
    if (blocked.check(address, 'ipv6')) return false;
    const v4 = embeddedV4(address);
    return v4 ? !blocked.check(v4, 'ipv4') : true;
  }
  return false;
}

export class FetchRefused extends Error {}

export interface SafeFetchOptions {
  /** Largest body accepted, or a limit per content type (a page needs far less than an image). */
  maxBytes: number | ((contentType: string) => number);
  /** Return a bounded prefix for selected content types instead of rejecting oversized bodies. */
  truncate?: boolean | ((contentType: string) => boolean);
  timeoutMs?: number;
  maxRedirects?: number;
  /** Accept only these content types (prefix match). */
  accept: string[];
  /** Tests only: extra addresses that may be reached, on any port. */
  allowAddresses?: string[];
}

export interface SafeResponse {
  url: string;
  contentType: string;
  body: Buffer;
  truncated?: boolean;
}

const allowed = (address: string, extra: string[]) =>
  extra.includes(address) || isPublicAddress(address);

function checkedLookup(extra: string[]): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = addresses as LookupAddress[];
      const bad = list.find((a) => !allowed(a.address, extra));
      const first = list[0];
      if (bad || !first) {
        return callback(new FetchRefused(`${hostname} is not a public address`), '', 0);
      }
      if ((options as { all?: boolean }).all) return callback(null, list as never);
      callback(null, first.address, first.family);
    });
  };
}

function checkUrl(raw: string, extra: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused('Not a valid address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new FetchRefused('Only http and https addresses can be fetched.');
  if (url.username || url.password)
    throw new FetchRefused('Addresses with credentials are refused.');
  if (url.port && extra.length === 0)
    throw new FetchRefused('Only the standard ports are allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !allowed(host, extra)) throw new FetchRefused('Not a public address.');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host))
    throw new FetchRefused('Not a public address.');
  return url;
}

function once(url: URL, opts: SafeFetchOptions, deadline: number) {
  return new Promise<{
    status: number;
    location?: string;
    contentType: string;
    body: Buffer;
    truncated?: boolean;
  }>((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: checkedLookup(opts.allowAddresses ?? []),
        headers: {
          'user-agent': 'InkadraLinkPreview/1.0 (+https://github.com/inkadra/inkadra)',
          accept: opts.accept.map((a) => `${a}*`).join(', '),
          'accept-encoding': 'identity',
        },
        timeout: Math.max(1, deadline - Date.now()),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({
            status,
            location: res.headers.location,
            contentType,
            body: Buffer.alloc(0),
          });
        }
        if (status !== 200) {
          res.resume();
          return reject(new FetchRefused(`The page answered ${status}.`));
        }
        if (!opts.accept.some((a) => contentType.startsWith(a))) {
          res.resume();
          return reject(new FetchRefused(`Unexpected content type ${contentType || 'none'}.`));
        }
        const maxBytes =
          typeof opts.maxBytes === 'function' ? opts.maxBytes(contentType) : opts.maxBytes;
        const truncate =
          typeof opts.truncate === 'function' ? opts.truncate(contentType) : opts.truncate;
        const length = Number(res.headers['content-length'] ?? 0);
        if (length > maxBytes && !truncate) {
          res.destroy();
          return reject(new FetchRefused('The response is too large.'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (size + chunk.length > maxBytes && truncate) {
            chunks.push(chunk.subarray(0, maxBytes - size));
            resolve({ status, contentType, body: Buffer.concat(chunks), truncated: true });
            res.destroy();
            return;
          }
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new FetchRefused('The response is too large.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks) }));
        // A connection cut mid-body: as unreadable as one that never answered.
        res.on('error', (err) => reject(new FetchRefused(`Could not fetch: ${err.message}`)));
      },
    );
    const tooLong = () => req.destroy(new FetchRefused('The page took too long to answer.'));
    req.on('timeout', tooLong);
    // The socket timeout above only covers silence; this one covers slow trickles too.
    const timer = setTimeout(tooLong, Math.max(1, deadline - Date.now()));
    req.on('close', () => clearTimeout(timer));
    req.on('error', (err) =>
      reject(
        err instanceof FetchRefused ? err : new FetchRefused(`Could not fetch: ${err.message}`),
      ),
    );
    req.end();
  });
}

export async function safeFetch(raw: string, opts: SafeFetchOptions): Promise<SafeResponse> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5000);
  const maxRedirects = opts.maxRedirects ?? 3;
  let url = checkUrl(raw, opts.allowAddresses ?? []);
  for (let hop = 0; ; hop++) {
    const res = await once(url, opts, deadline);
    if (res.status < 300 || res.status >= 400)
      return {
        url: url.toString(),
        contentType: res.contentType,
        body: res.body,
        truncated: res.truncated ?? false,
      };
    if (hop >= maxRedirects) throw new FetchRefused('Too many redirects.');
    if (!res.location) throw new FetchRefused('Redirect without a location.');
    url = checkUrl(new URL(res.location, url).toString(), opts.allowAddresses ?? []);
  }
}
