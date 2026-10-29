import { describe, expect, it } from 'vitest';
import { adminEnrollmentRequired, enforceAdminTwoFactor } from './admin-two-factor.ts';
import type { Database } from './db/client.ts';

function database(role: string, enabled: boolean, policy?: boolean) {
  let reads = 0;
  return {
    select: () => ({
      from: () => ({
        where: async () =>
          ++reads === 1
            ? [{ role, twoFactorEnabled: enabled }]
            : [{ value: { requireAdminTwoFactor: policy } }],
      }),
    }),
  } as unknown as Database;
}

describe('administrator enrollment policy', () => {
  it('blocks administrators without a second factor', async () => {
    expect(await adminEnrollmentRequired(database('admin', false, true), 'id')).toBe(true);
    await expect(enforceAdminTwoFactor(database('admin', false, true), 'id')).rejects.toMatchObject(
      {
        code: 'forbidden',
        details: { reason: 'admin_two_factor_required' },
      },
    );
  });
  it.each([
    ['admin', true, true],
    ['member', false, true],
    ['admin', false, false],
    ['admin', false, undefined],
  ] as const)('allows role %s with factor %s and policy %s', async (role, enabled, policy) => {
    expect(await adminEnrollmentRequired(database(role, enabled, policy), 'id')).toBe(false);
  });
});
