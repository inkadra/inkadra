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
      'octagon',
      'drop',
      'moon',
      'clapperboard',
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
export const ProjectTimeZone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use an IANA time zone.');
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
    timeZone: ProjectTimeZone.optional(),
    shootingStart: ShootingDate.nullable().optional(),
    shootingEnd: ShootingDate.nullable().optional(),
    pinned: z.boolean().optional(),
    group: z.object({ id: Id, position: FractionalIndex }).nullable().optional().openapi({
      description:
        'The caller’s own group of the project and its place in it; null outside any group.',
    }),
  })
  .openapi('Project');
export type Project = z.infer<typeof Project>;

export const CreateProject = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: ProjectIcon.optional(),
    type: ProjectType.nullable().optional(),
    timeZone: ProjectTimeZone.optional(),
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
    timeZone: ProjectTimeZone.optional(),
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

/** Personal project groups (decision 0056): organisation only, never access. */
export const ProjectGroupColor = z.enum(['blue', 'orange', 'purple', 'green', 'teal', 'pink']);
export type ProjectGroupColor = z.infer<typeof ProjectGroupColor>;
/** More groups than anyone organises by hand; keeps one person from filling the table. */
export const MAX_PROJECT_GROUPS = 200;

export const ProjectGroup = z
  .object({
    id: Id,
    name: z.string().min(1).max(80),
    color: ProjectGroupColor,
    position: FractionalIndex,
    collapsed: z.boolean(),
  })
  .openapi('ProjectGroup');
export type ProjectGroup = z.infer<typeof ProjectGroup>;

export const CreateProjectGroup = z
  .object({ name: z.string().trim().min(1).max(80), color: ProjectGroupColor })
  .openapi('CreateProjectGroup');
export type CreateProjectGroup = z.infer<typeof CreateProjectGroup>;

export const UpdateProjectGroup = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: ProjectGroupColor,
    collapsed: z.boolean(),
    before: Id.nullable().openapi({
      description: 'Moves the group just before this other group of the caller; null, last.',
    }),
  })
  .partial()
  .openapi('UpdateProjectGroup');
export type UpdateProjectGroup = z.infer<typeof UpdateProjectGroup>;

export const SetProjectGroup = z
  .object({
    groupId: Id.nullable().openapi({ description: 'null takes the project out of its group.' }),
    before: Id.optional().openapi({
      description: 'Places the project just before this project of the same group; left out, last.',
    }),
  })
  .openapi('SetProjectGroup');
export type SetProjectGroup = z.infer<typeof SetProjectGroup>;

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
