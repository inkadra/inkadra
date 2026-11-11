// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { InstanceVersion } from './instance.ts';

it('accepts older servers and unknown capabilities and platforms', () => {
  expect(InstanceVersion.parse({ version: '0.9.0' })).toEqual({ version: '0.9.0' });
  expect(
    InstanceVersion.parse({
      version: '1.0.0',
      api: 'v1',
      docSchemaVersion: 20,
      minWriterSchema: 19,
      capabilities: ['future-feature'],
      minClient: { future: '2.0.0' },
    }),
  ).toMatchObject({
    minWriterSchema: 19,
    capabilities: ['future-feature'],
    minClient: { future: '2.0.0' },
  });
  expect(InstanceVersion.safeParse({ version: '1', docSchemaVersion: 0 }).success).toBe(false);
});
