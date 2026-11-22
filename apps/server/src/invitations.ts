import type { AcceptedInvitation, InvitationPreview, ProjectRole } from '@inkadra/shared';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { activeGrant, activeMember, atLeast, boardAccess, projectRole } from './access.ts';
import { mergeInvitedRole } from './access-expiry.ts';
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
import { lockAccount, lockActiveAccount } from './locks.ts';
import { nextOwnPosition } from './project-order.ts';
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
  // The access it gives has already ended (decision 0041): nothing left to accept.
  if (row.accessExpiresAt && row.accessExpiresAt <= now) return 'expired';
  return 'valid';
}

/**
 * Whether the person who made an invitation can still give what it gives, checked like the
 * creator of a share link (decision 0013): their account exists and is not deactivated, and they
 * still hold at least the invited role on its board or project, or are still an administrator
 * for an invitation to the instance alone.
 */
export async function inviterCanGrant(
  db: Pick<Database, 'select' | 'execute'>,
  row: InvitationRow,
): Promise<boolean> {
  if (!row.invitedBy) return false;
  const [inviter] = await db
    .select({ role: user.role })
    .from(user)
    .where(and(eq(user.id, row.invitedBy), isNull(user.deactivatedAt)));
  if (!inviter) return false;
  return row.projectId ? inviterHoldsRole(db, row) : inviter.role === 'admin';
}

/**
 * The role part of inviterCanGrant, whatever the state of the account: a deactivation only
 * suspends an invitation, so revoking it for good looks at the role alone.
 */
async function inviterHoldsRole(
  db: Pick<Database, 'select' | 'execute'>,
  row: InvitationRow,
): Promise<boolean> {
  if (!row.invitedBy) return false;
  const role = invitedRole(row) ?? 'viewer';
  if (row.boardId) {
    const access = await boardAccess(db, { id: row.invitedBy }, row.boardId);
    return access !== null && atLeast(access.role, role);
  }
  if (row.projectId)
    return atLeast(await projectRole(db, { id: row.invitedBy }, row.projectId), role);
  return false;
}

/** invitationStatus, with an invitation its inviter can no longer give read as revoked. */
export async function currentStatus(
  db: Pick<Database, 'select' | 'execute'>,
  row: InvitationRow,
): Promise<InvitationPreview['status']> {
  const status = invitationStatus(row);
  return status === 'valid' && !(await inviterCanGrant(db, row)) ? 'revoked' : status;
}

/**
 * Revokes the pending invitations a person made in a project that they can no longer give, in
 * the transaction that removed or lowered their access (after their account lock, decision 0134).
 */
export async function revokeOutgrownInvitations(
  tx: Pick<Database, 'select' | 'execute' | 'update'>,
  invitedBy: string,
  projectId: string,
) {
  const pending = await tx
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.invitedBy, invitedBy),
        eq(invitation.projectId, projectId),
        isNull(invitation.revokedAt),
      ),
    );
  const outgrown: string[] = [];
  for (const row of pending)
    if (invitationStatus(row) === 'valid' && !(await inviterHoldsRole(tx, row)))
      outgrown.push(row.id);
  if (outgrown.length > 0)
    await tx
      .update(invitation)
      .set({ revokedAt: new Date() })
      .where(inArray(invitation.id, outgrown));
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
  return row && (await currentStatus(db, row)) === 'valid' ? row : null;
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
 * Counts one use of an invitation before the account it creates exists, while its inviter can
 * still give it. Under the inviter's account lock (decision 0134), so a deactivation, removal or
 * demotion of theirs comes first and is seen, or waits. The count is a conditional UPDATE, so
 * parallel sign-ups with the same link can never exceed `maxUses`: the ones that find no use
 * left get null. A use stays counted if creating the account fails afterwards.
 */
export async function reserveInvitationUse(
  db: Database,
  invitationId: string,
): Promise<InvitationRow | null> {
  return db.transaction(async (tx) => {
    const [about] = await tx
      .select({ invitedBy: invitation.invitedBy })
      .from(invitation)
      .where(eq(invitation.id, invitationId));
    if (!about?.invitedBy) return null;
    await lockAccount(tx, about.invitedBy);
    const [current] = await tx.select().from(invitation).where(eq(invitation.id, invitationId));
    if (!current || !(await inviterCanGrant(tx, current))) return null;
    const [row] = await tx
      .update(invitation)
      .set({ uses: sql`${invitation.uses} + 1` })
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.invitedBy, about.invitedBy),
          isNull(invitation.revokedAt),
          gt(invitation.expiresAt, sql`now()`),
          or(isNull(invitation.accessExpiresAt), gt(invitation.accessExpiresAt, sql`now()`)),
          or(isNull(invitation.maxUses), lt(invitation.uses, invitation.maxUses)),
        ),
      )
      .returning();
    return row ?? null;
  });
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
    // Who and what it is for, read before any lock (decision 0134): the person and whoever
    // invited them (a grant and a notification refer to them) first, so their deletions come
    // first or wait; the person gone or deactivated meanwhile, 401. Then the project before the
    // invitation, which its deletion reaches through the cascade. The inviter can only become
    // nobody meanwhile (their deletion came first): then nothing below refers to them.
    const [about] = await tx
      .select({ projectId: invitation.projectId, invitedBy: invitation.invitedBy })
      .from(invitation)
      .where(eq(invitation.id, invitationId));
    if (!about) throw new HttpError('not_found', 'This invitation can no longer be used.');
    await lockActiveAccount(tx, userId, ...(about.invitedBy ? [about.invitedBy] : []));
    if (about.projectId)
      await tx
        .select({ id: project.id })
        .from(project)
        .where(eq(project.id, about.projectId))
        .for('key share');
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
    const incoming = role && { role, expiresAt: end };
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
    // Read under the inviter's account lock: a removal or demotion committed first is seen.
    if (!(await inviterCanGrant(db2, row)))
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
    // Only ever raises a role, and never turns a permanent one into a temporary one.
    if (incoming && row.boardId) {
      const access = await boardAccess(db2, { id: userId }, row.boardId);
      if (!access) throw new HttpError('not_found', 'The board of this invitation was deleted.');
      const [held] = await tx
        .select({ role: boardGrant.role, expiresAt: boardGrant.expiresAt })
        .from(boardGrant)
        .where(
          and(eq(boardGrant.boardId, row.boardId), eq(boardGrant.userId, userId), activeGrant()),
        );
      const next = !atLeast(access.role, incoming.role)
        ? mergeInvitedRole(held ?? null, incoming)
        : null;
      if (next)
        await tx
          .insert(boardGrant)
          .values({ boardId: row.boardId, userId, grantedBy: row.invitedBy, ...next })
          .onConflictDoUpdate({
            target: [boardGrant.boardId, boardGrant.userId],
            set: { ...next, grantedBy: row.invitedBy, expiryWarnedAt: null },
          });
    } else if (incoming && row.projectId) {
      const [held] = await tx
        .select({ role: projectMember.role, expiresAt: projectMember.expiresAt })
        .from(projectMember)
        .where(
          and(
            eq(projectMember.projectId, row.projectId),
            eq(projectMember.userId, userId),
            activeMember(),
          ),
        );
      const next = mergeInvitedRole(held ?? null, incoming);
      // A new membership, or one that had ended, goes last in their list (decision 0134).
      const position = next && !held ? await nextOwnPosition(tx, userId) : undefined;
      if (next)
        await tx
          .insert(projectMember)
          .values({ projectId: row.projectId, userId, ...next, position })
          .onConflictDoUpdate({
            target: [projectMember.projectId, projectMember.userId],
            set: { ...next, expiryWarnedAt: null, ...(held ? {} : { position }) },
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
