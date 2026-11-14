import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Random url-safe secret with a recognisable prefix (secret scanners match `ink_…`). */
export function newSecret(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** base64url(SHA-256(verifier)), the PKCE S256 transformation (RFC 7636). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * AES-256-GCM with a key derived from AUTH_SECRET for one purpose, for values the server must
 * read back (invitation links) but that should not sit in the database in clear.
 */
export function sealer(authSecret: string, purpose: string, previousSecret?: string) {
  const derive = (secret: string) =>
    Buffer.from(hkdfSync('sha256', secret, 'inkadra', purpose, 32));
  const key = derive(authSecret);
  const keys = [key, ...(previousSecret ? [derive(previousSecret)] : [])];
  return {
    seal(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
    },
    /** Null when the value was sealed with another secret or tampered with. */
    open(sealed: string): string | null {
      for (const key of keys) {
        try {
          const raw = Buffer.from(sealed, 'base64url');
          const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
          decipher.setAuthTag(raw.subarray(12, 28));
          return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString();
        } catch {
          // Try the previous key only for reads; writes always use the current key.
        }
      }
      return null;
    },
  };
}
