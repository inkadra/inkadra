// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { InstanceSettings, UpdateInstanceSettings } from './instance-admin.ts';
import { buildOpenApiDocument } from './openapi.ts';

it('requires the effective administrator policy in responses and in generated OpenAPI', () => {
  expect(buildOpenApiDocument().components?.schemas?.InstanceSettings).toMatchObject({
    required: expect.arrayContaining(['name', 'registration', 'requireAdminTwoFactor']),
  });
  expect(InstanceSettings.safeParse({ name: 'Studio', registration: 'invite' }).success).toBe(
    false,
  );
});

it('does not apply a read default to a PATCH omission', () => {
  expect(UpdateInstanceSettings.parse({ name: 'Studio' })).toEqual({ name: 'Studio' });
});
