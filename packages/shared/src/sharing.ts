// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';
import { ProjectRole } from './projects.ts';
import { UserSummary } from './users.ts';

/** A person as shown to people who manage access: the email helps tell namesakes apart. */
export const Person = UserSummary.extend({ email: z.email() }).openapi('Person');
export type Person = z.infer<typeof Person>;

/**
 * Where a role comes from. `project`: the project membership. `board`: a grant on this board
 * or, when `boardId` is another board, on an ancestor (the role is inherited from there).
 */
export const AccessSource = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('project') }),
    z.object({ kind: z.literal('board'), boardId: Id, boardTitle: z.string() }),
  ])
  .openapi('AccessSource');
export type AccessSource = z.infer<typeof AccessSource>;

export const BoardAccessEntry = z
  .object({
    user: Person,
    role: ProjectRole.openapi({ description: 'Effective role on this board.' }),
    source: AccessSource,
    projectRole: ProjectRole.nullable().openapi({
      description: 'Role on the project, or null for people who only have board grants.',
    }),
  })
  .openapi('BoardAccessEntry');
export type BoardAccessEntry = z.infer<typeof BoardAccessEntry>;

export const InvitationKind = z.enum(['email', 'link']).openapi({
  description:
    '`email`: sent to one address, usable once. `link`: a link to copy, usable by several ' +
    'people until it expires or is revoked.',
});
export type InvitationKind = z.infer<typeof InvitationKind>;

export const Invitation = z
  .object({
    id: Id,
    kind: InvitationKind,
    email: z.email().nullable(),
    projectId: Id.nullable().openapi({
      description: 'Null for an invitation to the instance only (administrators).',
    }),
    boardId: Id.nullable().openapi({
      description: 'Set when the invitation gives a role on one board and its sub-boards.',
    }),
    role: ProjectRole.nullable(),
    invitedBy: UserSummary.nullable(),
    uses: z.int().min(0),
    maxUses: z.int().min(1).nullable().openapi({ description: 'Null: until it expires.' }),
    url: z
      .url()
      .nullable()
      .openapi({
        description:
          'Link to open the invitation. For `link` invitations, present for the people who ' +
          'manage it while it can be used. For `email` invitations only in the answer that ' +
          'creates or resends it: each send makes a new link and the previous one stops working.',
      }),
    emailSent: z.boolean().openapi({
      description: 'False when the instance has no SMTP: share `url` some other way.',
    }),
    createdAt: Timestamp,
    expiresAt: Timestamp,
    lastSentAt: Timestamp.nullable(),
  })
  .openapi('Invitation');
export type Invitation = z.infer<typeof Invitation>;

export const CreateInvitation = z
  .object({
    kind: InvitationKind.default('email'),
    email: z.email().max(254).optional().openapi({ description: 'Required for `email`.' }),
    projectId: Id.optional(),
    boardId: Id.optional().openapi({
      description: 'Invite to this board (and what is inside it) instead of the whole project.',
    }),
    role: ProjectRole.optional().openapi({
      description: 'Required with projectId or boardId. At most the role of the person inviting.',
    }),
    expiresInDays: z.int().min(1).max(90).default(7),
  })
  .refine((v) => v.kind !== 'email' || v.email !== undefined, {
    message: 'An email invitation needs an address.',
    path: ['email'],
  })
  .refine((v) => (v.projectId === undefined && v.boardId === undefined) || v.role !== undefined, {
    message: 'Choose a role.',
    path: ['role'],
  })
  .openapi('CreateInvitation');
export type CreateInvitation = z.infer<typeof CreateInvitation>;

/**
 * POST /invitations with the address of someone who already has an account gives them the
 * role straight away (`added`) instead of sending an invitation.
 */
export const InvitationResult = z
  .discriminatedUnion('status', [
    z.object({ status: z.literal('added'), entry: BoardAccessEntry }),
    z.object({ status: z.literal('invited'), invitation: Invitation }),
  ])
  .openapi('InvitationResult');
export type InvitationResult = z.infer<typeof InvitationResult>;

export const InvitationQuery = z
  .object({ projectId: Id.optional(), boardId: Id.optional() })
  .openapi('InvitationQuery');

/** What someone opening an invitation link sees, before signing in. */
export const InvitationPreview = z
  .object({
    instanceName: z.string(),
    invitedBy: z.string().nullable().openapi({ description: 'Name of the person who invited.' }),
    projectName: z.string().nullable(),
    boardTitle: z.string().nullable(),
    role: ProjectRole.nullable(),
    email: z.email().nullable(),
    status: z.enum(['valid', 'expired', 'used', 'revoked']),
    expiresAt: Timestamp,
  })
  .openapi('InvitationPreview');
export type InvitationPreview = z.infer<typeof InvitationPreview>;

export const AcceptedInvitation = z
  .object({ projectId: Id.nullable(), boardId: Id.nullable() })
  .openapi('AcceptedInvitation');
export type AcceptedInvitation = z.infer<typeof AcceptedInvitation>;

export const SetBoardGrant = z.object({ role: ProjectRole }).openapi('SetBoardGrant');
export type SetBoardGrant = z.infer<typeof SetBoardGrant>;

export const UserSearchQuery = z.object({ q: z.string().trim().min(1).max(254) });

export const BoardAccess = z
  .object({
    items: z.array(BoardAccessEntry),
    canManage: z.boolean().openapi({
      description: 'True for editors and owners: they can invite and change grants.',
    }),
  })
  .openapi('BoardAccess');
export type BoardAccess = z.infer<typeof BoardAccess>;
