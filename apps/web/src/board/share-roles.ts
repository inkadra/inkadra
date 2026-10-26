import { InvitationLinkRole, PROJECT_ROLE_RANK, type ProjectRole } from '@inkadra/shared';

const ROLES: ProjectRole[] = ['viewer', 'commenter', 'editor', 'owner'];

export const rank = (r: ProjectRole) => PROJECT_ROLE_RANK[r];

/** Roles someone can give to people and email invitations: at most their own. */
export function roleChoices(myRole: ProjectRole): ProjectRole[] {
  return ROLES.filter((r) => rank(r) <= rank(myRole));
}

/** Roles for an invitation link: at most their own and never owner (decision 0019). */
export function linkRoleChoices(myRole: ProjectRole): InvitationLinkRole[] {
  return roleChoices(myRole).filter(
    (r): r is InvitationLinkRole => InvitationLinkRole.safeParse(r).success,
  );
}
