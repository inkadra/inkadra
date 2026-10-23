import type { AcceptedInvitation, InvitationPreview } from '@inkadra/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { atLeast, boardAccess, projectRole } from './access.ts';
import type { Database } from './db/client.ts';
import { board, boardGrant, invitation, project, projectMember, user } from './db/schema.ts';
import { HttpError } from './http/errors.ts';
import { sha256 } from './secrets.ts';

/** Cookie set by POST /invitations/by-token/{token}/claim, read when an account is created. */
export const INVITATION_COOKIE = 'inkadra.invitation';
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
): Promise<InvitationRow | null> {
  const token = readCookie(cookieHeader, INVITATION_COOKIE);
  if (!token) return null;
  const row = await findInvitation(db, token);
  return row && invitationStatus(row) === 'valid' ? row : null;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Email invitations are for the address they were sent to (decision 0011). */
export function invitedAddressMatches(row: InvitationRow, email: string): boolean {
  return row.kind !== 'email' || row.email?.toLowerCase() === email.toLowerCase();
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
    // An account created through Google, OIDC or an email link already used its email
    // invitation; coming back to the link then just leads to what it was for.
    if (
      invitationStatus(row) === 'used' &&
      row.kind === 'email' &&
      me &&
      invitedAddressMatches(row, me.email) &&
      row.role &&
      (await hasInvitedRole(db2, row, userId))
    )
      return { projectId: row.projectId, boardId: row.boardId };
    if (invitationStatus(row) !== 'valid')
      throw new HttpError('not_found', 'This invitation can no longer be used.');
    if (!me || !invitedAddressMatches(row, me.email))
      throw new HttpError(
        'forbidden',
        `This invitation was sent to ${row.email}: sign in with that address to accept it.`,
      );
    // The link reached this mailbox, which proves the address.
    if (row.kind === 'email')
      await tx.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
    await tx
      .update(invitation)
      .set({ uses: sql`${invitation.uses} + 1` })
      .where(eq(invitation.id, row.id));
    if (row.role && row.boardId) {
      const access = await boardAccess(db2, { id: userId }, row.boardId);
      if (!access) throw new HttpError('not_found', 'The board of this invitation was deleted.');
      if (!atLeast(access.role, row.role))
        await tx
          .insert(boardGrant)
          .values({ boardId: row.boardId, userId, role: row.role, grantedBy: row.invitedBy })
          .onConflictDoUpdate({
            target: [boardGrant.boardId, boardGrant.userId],
            set: { role: row.role, grantedBy: row.invitedBy },
          });
    } else if (row.role && row.projectId) {
      const current = await projectRole(tx, { id: userId }, row.projectId);
      if (!atLeast(current, row.role))
        await tx
          .insert(projectMember)
          .values({ projectId: row.projectId, userId, role: row.role })
          .onConflictDoUpdate({
            target: [projectMember.projectId, projectMember.userId],
            set: { role: row.role },
          });
    }
    return { projectId: row.projectId, boardId: row.boardId };
  });
}

async function hasInvitedRole(db: Database, row: InvitationRow, userId: string) {
  if (!row.role) return false;
  if (row.boardId) {
    const access = await boardAccess(db, { id: userId }, row.boardId);
    return access !== null && atLeast(access.role, row.role);
  }
  if (row.projectId) return atLeast(await projectRole(db, { id: userId }, row.projectId), row.role);
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
