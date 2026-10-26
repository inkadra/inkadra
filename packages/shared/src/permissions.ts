// SPDX-License-Identifier: MPL-2.0
import type { GuestRole } from './guests.ts';
import type { ProjectRole } from './projects.ts';

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  owner: 3,
};
export function atLeast(role: ProjectRole | null, needed: ProjectRole): boolean {
  return role !== null && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[needed];
}

/** Minimum roles enforced by board and asset endpoints (decision 0011). */
export const CAPABILITY_ROLE = {
  view: 'viewer',
  comment: 'commenter',
  edit: 'editor',
  share: 'editor',
  download: 'commenter',
} as const satisfies Record<string, ProjectRole>;
export const CAPABILITIES = ['view', 'comment', 'edit', 'share', 'download'] as const;
export function roleCapabilities(role: ProjectRole) {
  return CAPABILITIES.map((capability) => atLeast(role, CAPABILITY_ROLE[capability]));
}

export type GuestAction = 'view' | 'read_comments' | 'write_comments' | 'review' | 'pick';

const guestRights: Record<GuestRole, readonly GuestAction[]> = {
  guest_view: ['view', 'pick'],
  guest_comment: ['view', 'pick', 'read_comments', 'write_comments'],
  guest_approve: ['view', 'pick', 'read_comments', 'write_comments', 'review'],
};

export function guestCan(link: { role: GuestRole; proofing: boolean }, action: GuestAction) {
  if (action === 'pick' && !link.proofing) return false;
  return guestRights[link.role].includes(action);
}

export function guestCapabilities(link: {
  role: GuestRole;
  proofing: boolean;
  allowDownload: boolean;
}) {
  return [
    guestCan(link, 'view'),
    guestCan(link, 'write_comments'),
    false,
    false,
    link.allowDownload,
  ];
}
