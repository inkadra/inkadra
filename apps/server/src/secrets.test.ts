import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';
import { readableTwoFactor } from './auth-two-factor.ts';
import { sealer } from './secrets.ts';

const old = 'old-secret-old-secret-old-secret-0123';
const current = 'new-secret-new-secret-new-secret-0123';

describe('secret rotation', () => {
  it.each(['invitation', 'share-link', 'token-proof-key'])(
    'reads old %s values but writes only with the current key',
    (purpose) => {
      const before = sealer(old, purpose);
      const after = sealer(current, purpose, old);
      expect(after.open(before.seal('value'))).toBe('value');
      const fresh = after.seal('new value');
      expect(sealer(current, purpose).open(fresh)).toBe('new value');
      expect(before.open(fresh)).toBeNull();
      expect(sealer(current, purpose).open(before.seal('value'))).toBeNull();
      expect(after.open(sealer(old, 'another purpose').seal('value'))).toBeNull();
      expect(after.open('tampered')).toBeNull();
    },
  );

  it('keeps old and current upstream two-factor secrets and recovery codes readable', async () => {
    for (const key of [old, current]) {
      const row = {
        secret: await symmetricEncrypt({ key, data: 'totp-secret' }),
        backupCodes: await symmetricEncrypt({ key, data: '["recovery-code"]' }),
      };
      const result = await readableTwoFactor(row, current, old);
      expect(await symmetricDecrypt({ key: current, data: result.secret })).toBe('totp-secret');
      expect(await symmetricDecrypt({ key: current, data: result.backupCodes })).toBe(
        '["recovery-code"]',
      );
    }
    expect(await readableTwoFactor({ secret: 'invalid' }, current, old)).toEqual({
      secret: 'invalid',
    });
    expect(await readableTwoFactor(null, current, old)).toBeNull();
  });
});
