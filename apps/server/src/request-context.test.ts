import { describe, expect, it } from 'vitest';
import { requestContext, requestIdFrom, withRequestId } from './request-context.ts';

describe('request ids (#817)', () => {
  it("keeps a proxy's plain id and replaces anything else", () => {
    expect(requestIdFrom('abc-123.x:y_z', () => 'new')).toBe('abc-123.x:y_z');
    for (const odd of [undefined, '', 'a b', 'a\nb', ['a'], 'x'.repeat(129)])
      expect(requestIdFrom(odd, () => 'new')).toBe('new');
  });

  it('tags the jobs a request queues, and only those', async () => {
    expect(withRequestId({ assetId: 'a' })).toEqual({ assetId: 'a' });
    const inside = await requestContext.run({ requestId: 'r1' }, async () => {
      await Promise.resolve();
      return withRequestId({ assetId: 'a' });
    });
    expect(inside).toEqual({ assetId: 'a', requestId: 'r1' });
  });
});
