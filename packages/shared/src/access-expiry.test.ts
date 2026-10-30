// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  CreateInvitation,
  InstanceSettings,
  Notification,
  ProjectCreationDenied,
  SetBoardGrant,
  SetProjectMember,
  UpdateInstanceMember,
  UpdateInstanceSettings,
  User,
} from './index.ts';
import { buildOpenApiDocument } from './openapi.ts';

const at = '2026-12-15T09:00:00.000Z';

describe('expiring access and project creation (decision 0041)', () => {
  it('takes an optional end date on members, grants and invitations', () => {
    expect(SetProjectMember.parse({ role: 'editor' })).toEqual({ role: 'editor' });
    expect(SetProjectMember.parse({ role: 'editor', expiresAt: at }).expiresAt).toBe(at);
    expect(SetProjectMember.parse({ role: 'editor', expiresAt: null }).expiresAt).toBeNull();
    expect(SetBoardGrant.safeParse({ role: 'viewer', expiresAt: 'tomorrow' }).success).toBe(false);
    const invite = CreateInvitation.parse({
      kind: 'link',
      projectId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
      role: 'viewer',
      accessExpiresAt: at,
    });
    expect(invite.accessExpiresAt).toBe(at);
  });

  it('keeps answers of older servers valid', () => {
    expect(
      InstanceSettings.parse({
        name: 'Studio',
        registration: 'invite',
        requireAdminTwoFactor: false,
      }).membersCanCreateProjects,
    ).toBe(true);
    expect(
      User.safeParse({
        id: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
        email: 'a@example.com',
        name: 'A',
        image: null,
        role: 'member',
        locale: null,
        twoFactorEnabled: false,
        createdAt: at,
      }).success,
    ).toBe(true);
    expect(Notification.shape.type.safeParse('access_expiring').success).toBe(true);
  });

  it('lets administrators set or clear the per-account override', () => {
    expect(UpdateInstanceMember.parse({ canCreateProjects: null })).toEqual({
      canCreateProjects: null,
    });
    expect(UpdateInstanceSettings.parse({ membersCanCreateProjects: false })).toEqual({
      membersCanCreateProjects: false,
    });
    expect(ProjectCreationDenied.parse({ reason: 'project_creation_disabled' })).toBeTruthy();
  });

  it('documents the refusal on creation and import', () => {
    const paths = buildOpenApiDocument().paths ?? {};
    expect(paths['/api/v1/projects']?.post?.description).toContain('ProjectCreationDenied');
    expect(paths['/api/v1/projects/import']?.post?.summary).toContain('ProjectCreationDenied');
  });
});
