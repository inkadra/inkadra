// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';
import { InstanceRole } from './users.ts';

export const InstanceSettings = z
  .object({
    releaseNews: z.boolean().default(true),
    name: z.string().trim().min(1).max(120),
    calendarFeedEnabled: z.boolean().default(true),
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
    updateCheck: z
      .boolean()
      .default(true)
      .openapi({
        description:
          'Ask GitHub for new Inkadra releases every 6 hours and tell administrators (#515). ' +
          'Nothing about the instance is sent. Defaults to true; missing from servers before 0.10.0.',
      }),
    updateChannel: z
      .enum(['stable', 'preview'])
      .default('stable')
      .openapi({
        description:
          'Which releases are announced: `stable` only, or `preview` release candidates too. It ' +
          'never changes the running image. Defaults to `stable`; missing before 0.10.0.',
      }),
  })
  .openapi('InstanceSettings');
export type InstanceSettings = z.infer<typeof InstanceSettings>;
export const UpdateInstanceSettings = InstanceSettings.partial()
  // A PATCH omission must preserve the stored policy, not apply its read-time default.
  .extend({
    releaseNews: z.boolean().optional(),
    calendarFeedEnabled: z.boolean().optional(),
    requireAdminTwoFactor: z.boolean().optional(),
    membersCanCreateProjects: z.boolean().optional(),
    updateCheck: z.boolean().optional(),
    updateChannel: z.enum(['stable', 'preview']).optional(),
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
    derivedBytes: z.number().nonnegative().optional().openapi({
      description:
        'Previews and playable copies of all files, where their size is known. Servers before this field omit it.',
    }),
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
    byUser: z
      .array(
        z.object({
          userId: Id.nullable().openapi({
            description: 'Who uploaded the files; null when no account is linked to them.',
          }),
          name: z.string().nullable(),
          bytes: z.number().nonnegative(),
          derivedBytes: z.number().nonnegative().optional().openapi({
            description: 'Previews and playable copies of those files, where their size is known.',
          }),
        }),
      )
      .optional()
      .openapi({ description: 'Original bytes by uploader. Servers before this field omit it.' }),
  })
  .openapi('StorageUsage', {
    description:
      'Completed original uploads (processing, ready or failed), once per asset row. Pending uploads, derived files, database and physical capacity excluded. Attribution uses asset.projectId, independent of references. Inaccessible projects are combined without names or IDs.',
  });
export type StorageUsage = z.infer<typeof StorageUsage>;

/** A release of Inkadra on GitHub, reduced to plain text by the server (#515). */
export const InstanceRelease = z
  .object({
    version: z.string().openapi({ example: '0.9.0' }),
    publishedAt: Timestamp.nullable(),
    prerelease: z.boolean().openapi({ description: 'A release candidate (`X.Y.Z-rc.N`).' }),
    url: z.url().openapi({ description: 'The release on GitHub.' }),
    highlights: z
      .array(z.string().max(280))
      .max(5)
      .openapi({
        description:
          'The main news, plain text: release notes come from outside and are never sent as ' +
          'Markdown or HTML.',
      }),
    beforeUpdating: z.array(z.string().max(280)).max(10).openapi({
      description: 'The "Read before upgrading" section of the notes, plain text.',
    }),
  })
  .openapi('InstanceRelease');
export type InstanceRelease = z.infer<typeof InstanceRelease>;

export const InstanceUpdates = z
  .object({
    current: z.string().openapi({ description: 'The running version.' }),
    edge: z.boolean().openapi({
      description:
        'The running version is not SemVer (an edge build): it is never compared with the ' +
        'releases, so `available` is null and `earlier` is empty.',
    }),
    checkEnabled: z.boolean().openapi({ description: 'InstanceSettings.updateCheck.' }),
    channel: z.enum(['stable', 'preview']),
    checkedAt: Timestamp.nullable().openapi({
      description: 'Last answer from GitHub; null: never.',
    }),
    failed: z.boolean().openapi({ description: 'The last check could not reach GitHub.' }),
    available: InstanceRelease.nullable().openapi({
      description: 'The newest release of the channel newer than the running one; null: none.',
    }),
    earlier: z.array(InstanceRelease).max(10).openapi({
      description: 'Stable releases up to the running one, newest first; the running one too.',
    }),
  })
  .openapi('InstanceUpdates', {
    description:
      'Releases of Inkadra as last read from GitHub (#515). Edge builds are not compared: a ' +
      'running version that is not SemVer never has an update available.',
  });
export type InstanceUpdates = z.infer<typeof InstanceUpdates>;
