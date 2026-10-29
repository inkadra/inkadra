import { describe, expect, it, vi } from 'vitest';
import { adminEnrollmentRequired, enforceAdminTwoFactor } from './admin-two-factor.ts';
import type { Database } from './db/client.ts';

function database(policy?: boolean) {
  const select = vi.fn(() => ({
    from: () => ({ where: async () => [{ value: { requireAdminTwoFactor: policy } }] }),
  }));
  return { db: { select } as unknown as Database, select };
}

describe('administrator enrollment policy', () => {
  it('uses the loaded user and only queries the settings for incomplete administrators', async () => {
    const { db, select } = database(true);
    const owner = { role: 'admin', twoFactorEnabled: false };
    expect(await adminEnrollmentRequired(db, owner)).toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
    await expect(enforceAdminTwoFactor(db, owner)).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'admin_two_factor_required' },
    });
  });
  it.each([
    ['admin', true, true],
    ['member', false, true],
    ['admin', false, false],
    ['admin', false, undefined],
  ] as const)('allows role %s with factor %s and policy %s', async (role, enabled, policy) => {
    const { db, select } = database(policy);
    expect(await adminEnrollmentRequired(db, { role, twoFactorEnabled: enabled })).toBe(false);
    expect(select).toHaveBeenCalledTimes(role !== 'admin' || enabled ? 0 : 1);
  });
});
