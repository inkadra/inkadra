// SPDX-License-Identifier: MPL-2.0

/**
 * The asset id the server gives an upload created with `clientAssetId` (decision 0097):
 * a UUIDv5 (RFC 9562) whose namespace is the uploader's user id and whose name is the
 * lowercase `clientAssetId`, as UTF-8. A client computes it offline, before the upload, and
 * nobody else can produce it: the same `clientAssetId` from another account is another asset.
 */
export function clientAssetUploadId(userId: string, clientAssetId: string): string {
  return uuidV5(userId, clientAssetId.toLowerCase());
}

/** UUIDv5 of a name in a namespace UUID. */
export function uuidV5(namespace: string, name: string): string {
  const ns = namespace.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(ns)) throw new Error('The namespace must be a UUID.');
  const nameBytes = new TextEncoder().encode(name);
  const bytes = new Uint8Array(16 + nameBytes.length);
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(ns.slice(i * 2, i * 2 + 2), 16);
  bytes.set(nameBytes, 16);
  const hash = sha1(bytes).subarray(0, 16);
  hash[6] = ((hash[6] as number) & 0x0f) | 0x50;
  hash[8] = ((hash[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * SHA-1 (FIPS 180-4), synchronous so it also runs where Web Crypto is missing or async only
 * (React Native, pages served over plain HTTP). Only for UUIDv5, never for security.
 */
function sha1(message: Uint8Array): Uint8Array {
  const length = message.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = (w[i - 3] as number) ^ (w[i - 8] as number) ^ (w[i - 14] as number) ^ (w[i - 16] as number);
      w[i] = (x << 1) | (x >>> 31);
    }
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6];
      const t = (((a << 5) | (a >>> 27)) + f + e + k + (w[i] as number)) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) outView.setUint32(i * 4, h[i] as number);
  return out;
}
