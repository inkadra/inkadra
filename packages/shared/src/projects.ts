// SPDX-License-Identifier: MPL-2.0
import { FractionalIndex, Id, Timestamp, z } from './common.ts';
import { UserSummary } from './users.ts';

/** Roles on a project. Boards inherit the project role unless a board grant overrides it. */
export const ProjectRole = z.enum(['owner', 'editor', 'commenter', 'viewer']);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const ProjectIcon = z
  .object({
    shape: z.enum(['diamond', 'circle', 'triangle', 'square']),
    color: z.enum(['blue', 'orange', 'purple', 'green', 'neutral']),
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
  })
  .openapi('ProjectMember');
export type ProjectMember = z.infer<typeof ProjectMember>;

export const SetProjectMember = z.object({ role: ProjectRole }).openapi('SetProjectMember');

export const SetProjectPin = z.object({ pinned: z.boolean() }).openapi('SetProjectPin');
