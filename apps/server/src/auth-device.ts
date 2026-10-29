import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const DEVICE_COOKIE = '__Host-inkadra.known-device';
export const DEVICE_AGE = 90 * 24 * 60 * 60;

/** Separate key/domain from session signing; this cookie never authenticates a session. */
export function knownDevices(secret: string) {
  const key = createHmac('sha256', secret).update('inkadra:known-device:v1').digest();
  const sign = (value: string) => createHmac('sha256', key).update(value).digest('base64url');
  return {
    issue(user: { id: string; email: string }) {
      const value = Buffer.from(JSON.stringify({
        userId: user.id, email: user.email.trim().toLowerCase(),
        device: randomUUID(), expires: Date.now() + DEVICE_AGE * 1000,
      })).toString('base64url');
      return `${value}.${sign(value)}`;
    },
    verify(cookie: string | undefined, email: string): string | null {
      if (!cookie || cookie.length > 2048) return null;
      const [value, signature, extra] = cookie.split('.');
      if (!value || !signature || extra) return null;
      const expected = Buffer.from(sign(value));
      const actual = Buffer.from(signature);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      try {
        const data = JSON.parse(Buffer.from(value, 'base64url').toString());
        return typeof data.userId === 'string' && typeof data.device === 'string' &&
          data.email === email && data.expires > Date.now()
          ? `${data.userId}:${data.device}` : null;
      } catch { return null; }
    },
  };
}
