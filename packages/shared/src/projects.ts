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
  })
  .openapi('Project');
export type Project = z.infer<typeof Project>;

export const CreateProject = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: ProjectIcon.optional(),
  })
  .openapi('CreateProject');
export type CreateProject = z.infer<typeof CreateProject>;

export const UpdateProject = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: ProjectIcon,
    position: FractionalIndex,
    archived: z.boolean(),
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
