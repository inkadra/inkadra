// SPDX-License-Identifier: MPL-2.0
import { AccessExpiry, FractionalIndex, Id, Timestamp, z } from './common.ts';
import { UserSummary } from './users.ts';

/** Roles on a project. Boards inherit the project role unless a board grant overrides it. */
export const ProjectRole = z.enum(['owner', 'editor', 'commenter', 'viewer']);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const ProjectIcon = z
  .object({
    shape: z.enum([
      'diamond',
      'circle',
      'triangle',
      'square',
      'hexagon',
      'star',
      'pentagon',
      'cross',
    ]),
    color: z.enum([
      'blue',
      'orange',
      'purple',
      'green',
      'neutral',
      'teal',
      'yellow',
      'red',
      'pink',
    ]),
    emoji: z
      .string()
      .max(32)
      .refine((value) => {
        const segments = [
          ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value),
        ];
        return (
          segments.length === 1 &&
          /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u.test(value)
        );
      }, 'Use one emoji.')
      .nullable()
      .optional(),
  })
  .openapi('ProjectIcon');

/** Stable ID in the instance project-type catalog. */
export const ProjectType = z.string().min(1).max(40);
export type ProjectType = z.infer<typeof ProjectType>;
const ShootingDate = z.iso.date();

export const Project = z
  .object({
    id: Id,
    name: z.string().min(1).max(120),
    icon: ProjectIcon,
    rootBoardId: Id,
    position: FractionalIndex,
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    myRole: ProjectRole,
    type: ProjectType.nullable().optional(),
    shootingStart: ShootingDate.nullable().optional(),
    shootingEnd: ShootingDate.nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .openapi('Project');
export type Project = z.infer<typeof Project>;

export const CreateProject = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: ProjectIcon.optional(),
    type: ProjectType.nullable().optional(),
    shootingStart: ShootingDate.nullable().optional(),
    shootingEnd: ShootingDate.nullable().optional(),
  })
  .openapi('CreateProject');
export type CreateProject = z.infer<typeof CreateProject>;

export const UpdateProject = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: ProjectIcon,
    position: FractionalIndex,
    archived: z.boolean(),
    type: ProjectType.nullable(),
    shootingStart: ShootingDate.nullable(),
    shootingEnd: ShootingDate.nullable(),
  })
  .partial()
  .openapi('UpdateProject');
export type UpdateProject = z.infer<typeof UpdateProject>;

export const ProjectMember = z
  .object({
    user: UserSummary,
    role: ProjectRole,
    addedAt: Timestamp,
    expiresAt: AccessExpiry.optional(),
  })
  .openapi('ProjectMember');
export type ProjectMember = z.infer<typeof ProjectMember>;

export const SetProjectMember = z
  .object({
    role: ProjectRole,
    expiresAt: AccessExpiry.optional().openapi({
      description:
        'When the membership ends; null removes the end, left out keeps it. Setting it is for ' +
        'owners. Making someone owner clears it; an owner with an end date is refused.',
    }),
  })
  .openapi('SetProjectMember');
export type SetProjectMember = z.infer<typeof SetProjectMember>;

/** `details` of the 403 to POST /projects and POST /projects/import (decision 0041). */
export const ProjectCreationDenied = z
  .object({
    reason: z.literal('project_creation_disabled').openapi({
      description:
        'An administrator lets only some people create and import projects on this instance. ' +
        'Open: clients show a reason they do not know as a generic error.',
    }),
  })
  .openapi('ProjectCreationDenied');
export type ProjectCreationDenied = z.infer<typeof ProjectCreationDenied>;

export const SetProjectPin = z.object({ pinned: z.boolean() }).openapi('SetProjectPin');

/** Deterministic frame-inspired defaults, independent of names and list ordering. */
export function defaultProjectIcon(id: string): z.infer<typeof ProjectIcon> {
  const seed = Number.parseInt(id.replaceAll('-', '').slice(-6), 16) || 0;
  const shapes = ['diamond', 'triangle', 'square', 'circle'] as const;
  const colors = ['blue', 'orange', 'purple', 'green'] as const;
  return {
    shape: shapes[seed % 4] ?? 'diamond',
    color: colors[Math.floor(seed / 4) % 4] ?? 'blue',
    emoji: null,
  };
}
