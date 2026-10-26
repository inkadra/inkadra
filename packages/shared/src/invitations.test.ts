// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { CreateInvitation, InvitationLinkRole } from './index.ts';

const projectId = '00000000-0000-4000-8000-000000000001';

describe('invitation roles', () => {
  it('caps invitation links at editor', () => {
    expect(InvitationLinkRole.options).toEqual(['editor', 'commenter', 'viewer']);
    for (const role of InvitationLinkRole.options)
      expect(CreateInvitation.safeParse({ kind: 'link', projectId, role }).success).toBe(true);
    const owner = CreateInvitation.safeParse({ kind: 'link', projectId, role: 'owner' });
    expect(owner.success).toBe(false);
    expect(owner.error?.issues[0]?.path).toEqual(['role']);
  });

  it('still lets email invitations name an owner', () => {
    const input = { kind: 'email', email: 'a@example.com', projectId, role: 'owner' };
    expect(CreateInvitation.safeParse(input).success).toBe(true);
  });
});
