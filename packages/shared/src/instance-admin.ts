// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';
import { InstanceRole } from './users.ts';

export const InstanceSettings = z
  .object({
    name: z.string().trim().min(1).max(120),
    registration: z.enum(['open', 'invite', 'closed']),
    requireAdminTwoFactor: z.boolean().openapi({
      description:
        'Require administrators to enroll in two-step verification before using the instance. Defaults to false on older installations.',
    }),
    membersCanCreateProjects: z
      .boolean()
      .default(true)
      .openapi({
        description:
          'Whether members (not only administrators) can create and import projects. A ' +
          'per-account choice (InstanceMember.canCreateProjectsOverride) wins over it. Defaults ' +
          'to true; missing from servers before API 0.9.0.',
      }),
  })
  .openapi('InstanceSettings');
export type InstanceSettings = z.infer<typeof InstanceSettings>;
export const UpdateInstanceSettings = InstanceSettings.partial()
  // A PATCH omission must preserve the stored policy, not apply its read-time default.
  .extend({
    requireAdminTwoFactor: z.boolean().optional(),
    membersCanCreateProjects: z.boolean().optional(),
  })
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
    canCreateProjects: z
      .boolean()
      .optional()
      .openapi({
        description:
          'Effective: administrators always can; members follow their override, else the ' +
          'instance setting. Missing from servers before API 0.9.0.',
      }),
    canCreateProjectsOverride: z.boolean().nullable().optional().openapi({
      description: 'Per-account choice; null follows InstanceSettings.membersCanCreateProjects.',
    }),
  })
  .openapi('InstanceMember');
export type InstanceMember = z.infer<typeof InstanceMember>;
export const UpdateInstanceMember = z
  .object({
    role: InstanceRole.optional(),
    active: z.boolean().optional(),
    canCreateProjects: z.boolean().nullable().optional().openapi({
      description: 'Override for this account; null goes back to the instance setting.',
    }),
  })
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
