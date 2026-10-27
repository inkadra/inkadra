// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';
import { InstanceRole } from './users.ts';

export const InstanceSettings = z
  .object({
    name: z.string().trim().min(1).max(120),
    registration: z.enum(['open', 'invite', 'closed']),
  })
  .openapi('InstanceSettings');
export type InstanceSettings = z.infer<typeof InstanceSettings>;
export const UpdateInstanceSettings = InstanceSettings.partial()
  .strict()
  .openapi('UpdateInstanceSettings');
export const InstanceMember = z
  .object({
    id: Id,
    name: z.string(),
    email: z.email(),
    role: InstanceRole,
    deactivatedAt: Timestamp.nullable(),
    lastActiveAt: Timestamp.nullable().openapi({
      description:
        'Most recent recorded session update or personal token use; null if none is recorded.',
    }),
    projectsCount: z.int().min(0).openapi({
      description:
        'Direct project memberships, including archived projects; excludes board-only grants.',
    }),
  })
  .openapi('InstanceMember');
export type InstanceMember = z.infer<typeof InstanceMember>;
export const UpdateInstanceMember = z
  .object({ role: InstanceRole.optional(), active: z.boolean().optional() })
  .strict()
  .openapi('UpdateInstanceMember');
