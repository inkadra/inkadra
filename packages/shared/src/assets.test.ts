// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { ASSET_LOOKUP_CAPABILITY, ASSET_LOOKUP_MAX, AssetLookupQuery } from './assets.ts';

describe('AssetLookupQuery', () => {
  const id = (n: number) => `0193f0a4-6c1e-7b9a-9c51-${String(n).padStart(12, '0')}`;

  it('takes 1 to 200 asset ids', () => {
    expect(ASSET_LOOKUP_CAPABILITY).toBe('asset-lookup');
    expect(ASSET_LOOKUP_MAX).toBe(200);
    expect(AssetLookupQuery.safeParse({ ids: [id(1)] }).success).toBe(true);
    const full = Array.from({ length: ASSET_LOOKUP_MAX }, (_, n) => id(n));
    expect(AssetLookupQuery.safeParse({ ids: full }).success).toBe(true);
    expect(AssetLookupQuery.safeParse({ ids: [...full, id(999)] }).success).toBe(false);
    expect(AssetLookupQuery.safeParse({ ids: [] }).success).toBe(false);
    expect(AssetLookupQuery.safeParse({ ids: ['not-an-id'] }).success).toBe(false);
  });
});
