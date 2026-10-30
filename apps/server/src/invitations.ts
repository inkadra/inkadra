import type { AcceptedInvitation, InvitationPreview, ProjectRole } from '@inkadra/shared';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { atLeast, boardAccess, projectRole } from './access.ts';
import type { Database } from './db/client.ts';
import {
  board,
  boardGrant,
  invitation,
  notification,
  project,
  projectMember,
  user,
} from './db/schema.ts';
import { HttpError } from './http/errors.ts';
import { sha256 } from './secrets.ts';

/** Cookie set by POST /invitations/by-token/{token}/claim, read when an account is created. */
export const INVITATION_COOKIE = 'inkadra.invitation';
export const invitationCookieName = (publicUrl: string) =>
  publicUrl.startsWith('https:') ? '__Host-inkadra.invitation' : INVITATION_COOKIE;
export const INVITATION_COOKIE_MAX_AGE = 60 * 60;

export type InvitationRow = typeof invitation.$inferSelect;

export function invitationStatus(
  row: InvitationRow,
  now = new Date(),
): InvitationPreview['status'] {
  if (row.revokedAt) return 'revoked';
  if (row.maxUses !== null && row.uses >= row.maxUses) return 'used';
  if (row.expiresAt <= now) return 'expired';
  return 'valid';
}

export async function findInvitation(db: Database, token: string): Promise<InvitationRow | null> {
  const [row] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.tokenHash, sha256(token)));
  return row ?? null;
}

/** A usable invitation from the claim cookie of a request, or null. */
export async function invitationFromCookie(
  db: Database,
  cookieHeader: string | null | undefined,
  publicUrl: string,
): Promise<InvitationRow | null> {
  const token = readCookie(cookieHeader, invitationCookieName(publicUrl));
  if (!token) return null;
  const row = await findInvitation(db, token);
  return row && invitationStatus(row) === 'valid' ? row : null;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The role an invitation gives. Links give at most `editor` (decision 0019); links made with
 * `owner` before that stay in the database and are capped here, when read and accepted.
 */
export function invitedRole(row: InvitationRow): ProjectRole | null {
  return row.kind === 'link' && row.role === 'owner' ? 'editor' : row.role;
}

/** Email invitations are for the address they were sent to (decision 0011). */
export function invitedAddressMatches(row: InvitationRow, email: string): boolean {
  return row.kind !== 'email' || row.email?.toLowerCase() === email.toLowerCase();
}

/**
 * Counts one use of an invitation before the account it creates exists. A single conditional
 * UPDATE, so parallel sign-ups with the same link can never exceed `maxUses`: the ones that
 * find no use left get null. A use stays counted if creating the account fails afterwards.
 */
export async function reserveInvitationUse(
  db: Database,
  invitationId: string,
): Promise<InvitationRow | null> {
  const [row] = await db
    .update(invitation)
    .set({ uses: sql`${invitation.uses} + 1` })
    .where(
      and(
        eq(invitation.id, invitationId),
        isNull(invitation.revokedAt),
        gt(invitation.expiresAt, sql`now()`),
        or(isNull(invitation.maxUses), lt(invitation.uses, invitation.maxUses)),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Gives the person what the invitation is for and counts the use. Never lowers a role the
 * person already has. Throws `not_found` for an invitation that cannot be used any more and
 * `forbidden` when an email invitation is opened with an account for another address.
 */
export async function acceptInvitation(
  db: Database,
  invitationId: string,
  userId: string,
  /** The use was already counted by reserveInvitationUse at sign-up. */
  { reserved = false }: { reserved?: boolean } = {},
): Promise<AcceptedInvitation> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(invitation)
      .where(eq(invitation.id, invitationId))
      .for('update');
    if (!row) throw new HttpError('not_found', 'This invitation can no longer be used.');
    const [me] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId));
    const db2 = tx as unknown as Database;
    // Accepting after the end date of the access it gives gives nothing (decision 0041).
    const end = row.accessExpiresAt;
    const role = end && end.getTime() <= Date.now() ? null : invitedRole(row);
    // An account created through Google, OIDC or an email link already used its email
    // invitation; coming back to the link then just leads to what it was for.
    if (
      invitationStatus(row) === 'used' &&
      row.kind === 'email' &&
      me &&
      invitedAddressMatches(row, me.email) &&
      role &&
      (await hasInvitedRole(db2, row, userId))
    )
      return { projectId: row.projectId, boardId: row.boardId };
    if (!reserved && invitationStatus(row) !== 'valid')
      throw new HttpError('not_found', 'This invitation can no longer be used.');
    if (!me || !invitedAddressMatches(row, me.email))
      throw new HttpError(
        'forbidden',
        `This invitation was sent to ${row.email}: sign in with that address to accept it.`,
      );
    // The link reached this mailbox, which proves the address.
    if (row.kind === 'email')
      await tx.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
    if (!reserved)
      await tx
        .update(invitation)
        .set({ uses: sql`${invitation.uses} + 1` })
        .where(eq(invitation.id, row.id));
    if (role && row.boardId) {
      const access = await boardAccess(db2, { id: userId }, row.boardId);
      if (!access) throw new HttpError('not_found', 'The board of this invitation was deleted.');
      if (!atLeast(access.role, role))
        await tx
          .insert(boardGrant)
          .values({ boardId: row.boardId, userId, role, grantedBy: row.invitedBy, expiresAt: end })
          .onConflictDoUpdate({
            target: [boardGrant.boardId, boardGrant.userId],
            set: { role, grantedBy: row.invitedBy, expiresAt: end, expiryWarnedAt: null },
          });
    } else if (role && row.projectId) {
      const current = await projectRole(tx, { id: userId }, row.projectId);
      if (!atLeast(current, role))
        await tx
          .insert(projectMember)
          .values({ projectId: row.projectId, userId, role, expiresAt: end })
          .onConflictDoUpdate({
            target: [projectMember.projectId, projectMember.userId],
            set: { role, expiresAt: end, expiryWarnedAt: null },
          });
    }
    // The person who invited hears about it (decision 0013), unless they used their own link.
    if (row.invitedBy && row.invitedBy !== userId) {
      // Both the sign-up hook and the accept endpoint can redeem a reusable link.
      // Use the existing notification primary key to deduplicate this invitation/person
      // pair atomically, without conflating different links to the same board/project.
      // Notifications live 90 days, at least as long as a link can remain valid.
      const key = sha256(JSON.stringify(['invitation_accepted', row.id, userId]));
      const id = `${key.slice(0, 8)}-${key.slice(8, 12)}-8${key.slice(13, 16)}-a${key.slice(17, 20)}-${key.slice(20, 32)}`;
      await tx
        .insert(notification)
        .values({
          id,
          userId: row.invitedBy,
          type: 'invitation_accepted',
          actorId: userId,
          projectId: row.projectId,
          boardId: row.boardId,
        })
        .onConflictDoNothing({ target: notification.id });
    }
    return { projectId: row.projectId, boardId: row.boardId };
  });
}

async function hasInvitedRole(db: Database, row: InvitationRow, userId: string) {
  const role = invitedRole(row);
  if (!role) return false;
  if (row.boardId) {
    const access = await boardAccess(db, { id: userId }, row.boardId);
    return access !== null && atLeast(access.role, role);
  }
  if (row.projectId) return atLeast(await projectRole(db, { id: userId }, row.projectId), role);
  return false;
}

/** Names shown on an invitation: project and board. */
export async function invitationTarget(db: Database, row: InvitationRow) {
  const [p] = row.projectId
    ? await db.select({ name: project.name }).from(project).where(eq(project.id, row.projectId))
    : [];
  const [b] = row.boardId
    ? await db
        .select({ title: board.title, parent: board.parentBoardId })
        .from(board)
        .where(and(eq(board.id, row.boardId), isNull(board.deletedAt)))
    : [];
  return { projectName: p?.name ?? null, boardTitle: b && b.parent !== null ? b.title : null };
}
