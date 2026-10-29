// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';
import { InstanceRole } from './users.ts';

export const InstanceSettings = z
  .object({
    name: z.string().trim().min(1).max(120),
    registration: z.enum(['open', 'invite', 'closed']),
    requireAdminTwoFactor: z.boolean().default(false).openapi({
      description:
        'Require administrators to enroll in two-step verification before using the instance. Defaults to false on older installations.',
    }),
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
    image: z.url().nullable().optional().openapi({
      description: 'Avatar address, null without one. Servers before 0.4.0-rc.5 leave it out.',
    }),
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

export const StorageUsage = z
  .object({
    originalBytes: z.number().nonnegative(),
    byType: z.array(
      z.object({
        type: z.enum(['images', 'videos', 'audio', 'documents', 'other']),
        bytes: z.number().nonnegative(),
      }),
    ),
    byProject: z.array(
      z.object({
        projectId: Id.nullable(),
        name: z.string().nullable(),
        scope: z.enum(['project', 'restricted', 'unassigned']),
        bytes: z.number().nonnegative(),
      }),
    ),
  })
  .openapi('StorageUsage', {
    description:
      'Completed original uploads (processing, ready or failed), once per asset row. Pending uploads, derived files, database and physical capacity excluded. Attribution uses asset.projectId, independent of references. Inaccessible projects are combined without names or IDs.',
  });
export type StorageUsage = z.infer<typeof StorageUsage>;
