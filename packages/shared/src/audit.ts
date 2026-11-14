// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';

/**
 * The audit log of administrative and security-relevant actions (#806): who changed a role,
 * removed a person, deleted a project, made a share link or a token, started a backup, and
 * which sign-ins failed. Append-only; kept for `AUDIT_RETENTION_DAYS`.
 */
export const AUDIT_CAPABILITY = 'audit-log';
export const AUDIT_RETENTION_DAYS = 365;

export const AUDIT_ACTIONS = [
  'member.updated',
  'settings.changed',
  'project.deleted',
  'project.member_set',
  'project.member_removed',
  'board.grant_set',
  'board.grant_removed',
  'invitation.created',
  'invitation.revoked',
  'share_link.created',
  'share_link.changed',
  'share_link.removed',
  'token.created',
  'token.revoked',
  'account.deleted',
  'backup.started',
  'backup.restored',
  'auth.sign_in_failed',
  'auth.locked_out',
] as const;
export const AuditAction = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditAction>;

/** The filter of the admin view: one group of actions, or all of them. */
export const AUDIT_GROUPS = {
  members: ['member.updated', 'invitation.created', 'invitation.revoked', 'account.deleted'],
  sharing: [
    'project.member_set',
    'project.member_removed',
    'board.grant_set',
    'board.grant_removed',
    'share_link.created',
    'share_link.changed',
    'share_link.removed',
  ],
  security: ['auth.sign_in_failed', 'auth.locked_out', 'token.created', 'token.revoked'],
  data: ['project.deleted', 'backup.started', 'backup.restored', 'settings.changed'],
} as const satisfies Record<string, readonly AuditAction[]>;
export type AuditGroup = keyof typeof AUDIT_GROUPS;

export const AuditEvent = z
  .object({
    id: Id,
    at: Timestamp,
    action: AuditAction,
    actor: z
      .object({
        id: Id.nullable().openapi({ description: 'Null once the account is deleted.' }),
        name: z.string().nullable().openapi({ description: 'Name at the time of the action.' }),
      })
      .nullable()
      .openapi({
        description:
          'Null for actions without a signed-in person (failed sign-ins) and for a deleted ' +
          'account, whose events keep an opaque id in `details.actor` instead (pseudonymized).',
      }),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    projectId: Id.nullable(),
    ip: z.string().nullable(),
    details: z.record(z.string(), z.unknown()),
  })
  .openapi('AuditEvent');
export type AuditEvent = z.infer<typeof AuditEvent>;

export const AuditEventsQuery = z
  .object({
    group: z.enum(['members', 'sharing', 'security', 'data']).optional(),
    action: AuditAction.optional(),
    actorId: Id.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .openapi('AuditEventsQuery');

export const AuditEvents = z
  .object({
    items: z.array(AuditEvent).openapi({ description: 'Newest first.' }),
    nextCursor: z.string().nullable(),
    retentionDays: z.int(),
  })
  .openapi('AuditEvents');
export type AuditEvents = z.infer<typeof AuditEvents>;
