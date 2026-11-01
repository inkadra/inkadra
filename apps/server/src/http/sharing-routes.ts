import {
  API_PREFIX,
  type BoardAccess,
  type BoardAccessEntry,
  CreateInvitation,
  Id,
  type Invitation,
  type InvitationPreview,
  InvitationQuery,
  type InvitationResult,
  type Person,
  type ProjectRole,
  SetBoardGrant,
  UserSearchQuery,
  z,
} from '@inkadra/shared';
import { and, asc, count, eq, gt, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  type BoardAccess as Access,
  type Actor,
  activeGrant,
  activeMember,
  atLeast,
  boardAccess,
  effectiveRole,
  higher,
  live,
  projectRole,
  requireBoardRole,
  requireProjectRole,
} from '../access.ts';
import { mergeInvitedRole, readExpiry, widensEnd } from '../access-expiry.ts';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { board, boardGrant, invitation, projectMember, user } from '../db/schema.ts';
import {
  acceptInvitation,
  findInvitation,
  INVITATION_COOKIE_MAX_AGE,
  type InvitationRow,
  invitationCookieName,
  invitationStatus,
  invitationTarget,
  invitedRole,
} from '../invitations.ts';
import { mailText } from '../mail-texts.ts';
import { actionMail, type Mailer } from '../mailer.ts';
import { addressBucket, RateLimiter } from '../rate-limits.ts';
import { requestOrigin } from '../request-origin.ts';
import { newSecret, sealer, sha256 } from '../secrets.ts';
import { iso } from './api-routes.ts';
import { requireActor } from './auth-routes.ts';
import { toBoard } from './boards-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  mailer: Mailer;
}

const BoardParams = z.object({ boardId: Id });
const GrantParams = z.object({ boardId: Id, userId: Id });
const InvitationParams = z.object({ invitationId: Id });
const TokenParams = z.object({ token: z.string().min(16).max(128) });

/** Invitations a person may create in an hour, so an account cannot be used to send spam. */
const INVITATIONS_PER_HOUR = 50;
/**
 * An instance invitation link creates an account for whoever opens it, so unless the request
 * asks otherwise it works once and for two days. CreateInvitation's own default (7 days) is
 * the contract; the request body tells whether the client chose it.
 */
const INSTANCE_LINK_DAYS = 2;

const toPerson = (row: typeof user.$inferSelect): Person => ({
  id: row.id,
  name: row.name,
  image: row.image,
  email: row.email,
});

/** Everyone with a role on a board, from its project members and the grants on its chain. */
async function accessList(db: Database, access: Access): Promise<BoardAccessEntry[]> {
  const chainIds = access.chain.map((c) => c.id);
  const titles = new Map(access.chain.map((c) => [c.id, c.title]));
  const [members, grants] = await Promise.all([
    db
      .select({ role: projectMember.role, expiresAt: projectMember.expiresAt, user })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .where(and(eq(projectMember.projectId, access.board.projectId), activeMember()))
      .orderBy(asc(projectMember.addedAt)),
    db
      .select({
        boardId: boardGrant.boardId,
        role: boardGrant.role,
        expiresAt: boardGrant.expiresAt,
        user,
      })
      .from(boardGrant)
      .innerJoin(user, eq(user.id, boardGrant.userId))
      .where(and(inArray(boardGrant.boardId, chainIds), activeGrant()))
      .orderBy(asc(boardGrant.createdAt)),
  ]);
  const people = new Map<
    string,
    {
      row: typeof user.$inferSelect;
      projectRole: ProjectRole | null;
      projectEnd: Date | null;
      grants: Map<string, ProjectRole>;
      grantEnds: Map<string, Date | null>;
    }
  >();
  for (const m of members)
    people.set(m.user.id, {
      row: m.user,
      projectRole: m.role,
      projectEnd: m.expiresAt,
      grants: new Map(),
      grantEnds: new Map(),
    });
  for (const g of grants) {
    const p = people.get(g.user.id) ?? {
      row: g.user,
      projectRole: null,
      projectEnd: null,
      grants: new Map(),
      grantEnds: new Map(),
    };
    p.grants.set(g.boardId, g.role);
    p.grantEnds.set(g.boardId, g.expiresAt);
    people.set(g.user.id, p);
  }
  const out: BoardAccessEntry[] = [];
  for (const p of people.values()) {
    const eff = effectiveRole(chainIds, p.grants, p.projectRole);
    if (!eff.role) continue;
    out.push({
      user: toPerson(p.row),
      role: eff.role,
      source: eff.grantBoardId
        ? {
            kind: 'board',
            boardId: eff.grantBoardId,
            boardTitle: titles.get(eff.grantBoardId) ?? '',
          }
        : { kind: 'project' },
      projectRole: p.projectRole,
      expiresAt: endOf(
        eff.grantBoardId ? (p.grantEnds.get(eff.grantBoardId) ?? null) : p.projectEnd,
      ),
    });
  }
  const order: Record<ProjectRole, number> = { owner: 0, editor: 1, commenter: 2, viewer: 3 };
  return out.sort(
    (a, b) => order[a.role] - order[b.role] || a.user.name.localeCompare(b.user.name),
  );
}

const endOf = (at: Date | null) => (at ? iso(at) : null);

async function entryFor(db: Database, boardId: string, userId: string) {
  const access = await boardAccess(db, { id: userId }, boardId);
  if (!access) throw new HttpError('not_found', 'Board not found.');
  const entry = (await accessList(db, access)).find((e) => e.user.id === userId);
  if (!entry) throw new HttpError('not_found', 'No access.');
  return entry;
}

async function rootBoardId(db: Database, projectId: string): Promise<string> {
  const [root] = await db
    .select({ id: board.id })
    .from(board)
    .where(and(eq(board.projectId, projectId), isNull(board.parentBoardId)));
  if (!root) throw new HttpError('not_found', 'Project not found.');
  return root.id;
}

export function registerSharingRoutes(app: FastifyInstance, deps: Deps) {
  const { config, db, auth, mailer } = deps;
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  const seal = sealer(config.AUTH_SECRET, 'invitation');
  const previewLimiter = new RateLimiter(30, 60_000);
  const searchLimiter = new RateLimiter(30, 60_000);
  const joinUrl = (token: string) => `${config.PUBLIC_URL}/join/${token}`;

  /** `fresh`: the token just made, for the answer that creates or resends an invitation. */
  async function toInvitation(row: InvitationRow, fresh?: string): Promise<Invitation> {
    const [inviter] = row.invitedBy
      ? await db.select().from(user).where(eq(user.id, row.invitedBy))
      : [];
    const valid = invitationStatus(row) === 'valid';
    const token = !valid ? null : (fresh ?? (row.tokenSealed ? seal.open(row.tokenSealed) : null));
    return {
      id: row.id,
      kind: row.kind,
      email: row.email,
      projectId: row.projectId,
      boardId: row.boardId,
      role: invitedRole(row),
      invitedBy: inviter ? { id: inviter.id, name: inviter.name, image: inviter.image } : null,
      uses: row.uses,
      maxUses: row.maxUses,
      url: token ? joinUrl(token) : null,
      emailSent: row.lastSentAt !== null,
      createdAt: iso(row.createdAt),
      expiresAt: iso(row.expiresAt),
      lastSentAt: row.lastSentAt ? iso(row.lastSentAt) : null,
      accessExpiresAt: endOf(row.accessExpiresAt),
    };
  }

  /** The role an actor has over what an invitation targets, or throws. */
  async function managerRole(
    actor: Actor,
    target: { projectId: string | null; boardId: string | null },
  ): Promise<ProjectRole | null> {
    if (target.boardId) return (await requireBoardRole(db, actor, target.boardId, 'editor')).role;
    if (target.projectId) return requireProjectRole(db, actor, target.projectId, 'editor');
    if (actor.role !== 'admin')
      throw new HttpError('forbidden', 'Only administrators invite people to the instance.');
    return null;
  }

  async function sendInvitation(row: InvitationRow, token: string, inviter: Actor) {
    if (!mailer.enabled || row.kind !== 'email' || !row.email) return row;
    const [from] = await db.select().from(user).where(eq(user.id, inviter.id));
    const { projectName, boardTitle } = await invitationTarget(db, row);
    const what = boardTitle ?? projectName ?? config.INSTANCE_NAME;
    const t = mailText(from ?? {});
    const who = from?.name ?? config.INSTANCE_NAME;
    await mailer.send(
      actionMail(
        row.email,
        t.inviteSubject(who, what),
        t.inviteLines(who, what, row.role, config.INSTANCE_NAME),
        { label: t.inviteAction, url: joinUrl(token) },
        { instanceName: config.INSTANCE_NAME },
      ),
    );
    const [sent] = await db
      .update(invitation)
      .set({ lastSentAt: new Date() })
      .where(eq(invitation.id, row.id))
      .returning();
    return sent ?? row;
  }

  function setInvitationCookie(reply: FastifyReply, token: string | null) {
    const origin = requestOrigin(reply.request);
    const secureCookie = origin.startsWith('https:');
    const parts = [
      `${invitationCookieName(origin)}=${token ? encodeURIComponent(token) : ''}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${token ? INVITATION_COOKIE_MAX_AGE : 0}`,
      ...(secureCookie ? ['Secure'] : []),
    ];
    reply.header('set-cookie', parts.join('; '));
  }

  // Access to a board ------------------------------------------------------------

  app.get(v1('/boards/:boardId/access'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId } = BoardParams.parse(req.params);
    const access = await requireBoardRole(db, actor, boardId, 'viewer');
    const canManage = atLeast(access.role, 'editor');
    const items = await accessList(db, access);
    const body: BoardAccess = {
      // Addresses are for the people who share; the others see names only.
      items: canManage ? items : items.map((e) => ({ ...e, user: { ...e.user, email: null } })),
      canManage,
    };
    return body;
  });

  /** Checks the actor may change the access of `userId` on the board and give `role`. */
  async function checkGrant(actor: Actor, boardId: string, userId: string, role?: ProjectRole) {
    const mine = await requireBoardRole(db, actor, boardId, 'editor');
    if (mine.board.parentBoardId === null)
      throw new HttpError('bad_request', 'For the root board, change the project members.');
    if (role && higher(role, mine.role))
      throw new HttpError('forbidden', 'You cannot give a role higher than yours.');
    const theirs = await boardAccess(db, { id: userId }, boardId);
    if (theirs?.role && higher(theirs.role, mine.role))
      throw new HttpError('forbidden', 'This person has more access than you here.');
    return mine;
  }

  app.put(v1('/boards/:boardId/grants/:userId'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, userId } = GrantParams.parse(req.params);
    const { role, expiresAt: requested } = SetBoardGrant.parse(req.body);
    const expiresAt = readExpiry(requested, role);
    const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!target) throw new HttpError('not_found', 'User not found.');
    const mine = await checkGrant(actor, boardId, userId, role);
    const [current] = await db
      .select({ expiresAt: boardGrant.expiresAt })
      .from(boardGrant)
      .where(and(eq(boardGrant.boardId, boardId), eq(boardGrant.userId, userId), activeGrant()));
    // Left out, the end date stays (older clients do not show it); owners never end.
    const end =
      role === 'owner' ? null : expiresAt === undefined ? (current?.expiresAt ?? null) : expiresAt;
    // Removing or extending an end date widens access: project owners only (decision 0041).
    if (
      widensEnd(current?.expiresAt, end) &&
      (await projectRole(db, actor, mine.board.projectId)) !== 'owner'
    )
      throw new HttpError('forbidden', 'Only project owners can remove or extend an end date.');
    const reset = !current || end?.getTime() !== current.expiresAt?.getTime();
    await db
      .insert(boardGrant)
      .values({ boardId, userId, role, grantedBy: actor.id, expiresAt: end })
      .onConflictDoUpdate({
        target: [boardGrant.boardId, boardGrant.userId],
        set: {
          role,
          grantedBy: actor.id,
          expiresAt: end,
          ...(reset ? { expiryWarnedAt: null } : {}),
        },
      });
    return entryFor(db, boardId, userId);
  });

  app.delete(v1('/boards/:boardId/grants/:userId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { boardId, userId } = GrantParams.parse(req.params);
    await checkGrant(actor, boardId, userId);
    const removed = await db
      .delete(boardGrant)
      .where(and(eq(boardGrant.boardId, boardId), eq(boardGrant.userId, userId)))
      .returning({ userId: boardGrant.userId });
    if (removed.length === 0) throw new HttpError('not_found', 'No grant on this board.');
    return reply.status(204).send();
  });

  app.get(v1('/shared-boards'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const rows = await db
      .select({ board })
      .from(boardGrant)
      .innerJoin(board, eq(board.id, boardGrant.boardId))
      .where(
        and(
          eq(boardGrant.userId, actor.id),
          isNull(board.deletedAt),
          activeGrant(),
          sql`not exists (select 1 from ${projectMember} pm where pm.project_id = ${board.projectId} and pm.user_id = ${actor.id} and (pm.expires_at is null or pm.expires_at > now()))`,
        ),
      )
      .orderBy(asc(board.title));
    const granted = new Set(rows.map((r) => r.board.id));
    const items = [];
    for (const { board: row } of rows) {
      const access = await boardAccess(db, actor, row.id);
      // Only the top of each shared subtree, and nothing whose ancestor is in the trash.
      if (!access?.role || access.chain.slice(1).some((c) => granted.has(c.id))) continue;
      items.push(toBoard(row, access.role));
    }
    return { items };
  });

  app.get(v1('/users/search'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { q } = UserSearchQuery.parse(req.query ?? {});
    if (!searchLimiter.take(actor.id))
      throw new HttpError('rate_limited', 'Too many searches: wait a minute.');
    const [sharer] = await db.execute<{ ok: number }>(sql`
      select 1 as ok from ${projectMember} m
      where m.user_id = ${actor.id} and m.role in ('owner', 'editor') and ${live('m')}
      union all
      select 1 from ${boardGrant} g
      where g.user_id = ${actor.id} and g.role in ('owner', 'editor') and ${live('g')}
      limit 1`);
    if (!sharer) throw new HttpError('forbidden', 'Only people who can share can search.');
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await db
      .select()
      .from(user)
      .where(
        and(
          ne(user.id, actor.id),
          or(
            eq(user.email, q.toLowerCase()),
            and(
              or(ilike(user.name, like), ilike(user.email, like)),
              sql`exists (
                select 1 from ${projectMember} a join ${projectMember} b on a.project_id = b.project_id
                where a.user_id = ${actor.id} and b.user_id = ${user.id}
                  and ${live('a')} and ${live('b')})`,
            ),
          ),
        ),
      )
      .orderBy(asc(user.name))
      .limit(10);
    return { items: rows.map(toPerson) };
  });

  // Invitations ------------------------------------------------------------------

  app.get(v1('/invitations'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const query = InvitationQuery.parse(req.query ?? {});
    const now = new Date();
    const usable = and(
      isNull(invitation.revokedAt),
      gt(invitation.expiresAt, now),
      or(isNull(invitation.maxUses), sql`${invitation.uses} < ${invitation.maxUses}`),
    );
    let where: ReturnType<typeof and>;
    if (query.boardId) {
      const access = await requireBoardRole(db, actor, query.boardId, 'editor');
      where =
        access.board.parentBoardId === null
          ? and(eq(invitation.projectId, access.board.projectId), isNull(invitation.boardId))
          : eq(invitation.boardId, query.boardId);
    } else if (query.projectId) {
      await requireProjectRole(db, actor, query.projectId, 'editor');
      where = eq(invitation.projectId, query.projectId);
    } else {
      if (actor.role !== 'admin') throw new HttpError('forbidden', 'Administrators only.');
      where = undefined;
    }
    const rows = await db
      .select()
      .from(invitation)
      .where(and(usable, where))
      .orderBy(asc(invitation.createdAt));
    return { items: await Promise.all(rows.map((r) => toInvitation(r))) };
  });

  app.post(v1('/invitations'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const input = CreateInvitation.parse(req.body ?? {});
    let projectId = input.projectId ?? null;
    let boardId = input.boardId ?? null;
    if (boardId) {
      const [b] = await db
        .select({ projectId: board.projectId, parent: board.parentBoardId })
        .from(board)
        .where(and(eq(board.id, boardId), isNull(board.deletedAt)));
      if (!b) throw new HttpError('not_found', 'Board not found.');
      if (projectId && projectId !== b.projectId)
        throw new HttpError('bad_request', 'The board is not in this project.');
      projectId = b.projectId;
      // The root board stands for the whole project.
      if (b.parent === null) {
        await requireBoardRole(db, actor, boardId, 'editor');
        boardId = null;
      }
    }
    const mine = await managerRole(actor, { projectId, boardId });
    const role = projectId ? (input.role ?? null) : null;
    if (role && mine && higher(role, mine))
      throw new HttpError('forbidden', 'You cannot give a role higher than yours.');
    const accessExpiresAt = (role && readExpiry(input.accessExpiresAt, role)) || null;

    const [recent] = await db
      .select({ n: count() })
      .from(invitation)
      .where(
        and(
          eq(invitation.invitedBy, actor.id),
          gt(invitation.createdAt, sql`now() - interval '1 hour'`),
        ),
      );
    if ((recent?.n ?? 0) >= INVITATIONS_PER_HOUR)
      throw new HttpError('rate_limited', 'Too many invitations in the last hour.');

    const email = input.kind === 'email' ? (input.email?.toLowerCase() ?? null) : null;
    if (email) {
      const [existing] = await db.select().from(user).where(eq(user.email, email));
      if (existing && !projectId)
        throw new HttpError('conflict', 'This person already has an account.');
      if (existing && projectId && role) {
        const target = boardId ?? (await rootBoardId(db, projectId));
        const current = await boardAccess(db, existing, target);
        if (!atLeast(current?.role ?? null, role)) {
          if (boardId) {
            if (current?.role && mine && higher(current.role, mine))
              throw new HttpError('forbidden', 'This person has more access than you here.');
            const [held] = await db
              .select({ role: boardGrant.role, expiresAt: boardGrant.expiresAt })
              .from(boardGrant)
              .where(
                and(
                  eq(boardGrant.boardId, boardId),
                  eq(boardGrant.userId, existing.id),
                  activeGrant(),
                ),
              );
            // Only raises, never makes a permanent role temporary or extends an end date.
            const next = mergeInvitedRole(held ?? null, { role, expiresAt: accessExpiresAt });
            if (!next)
              throw new HttpError(
                'conflict',
                'This person already has a role here without an end date: change it in the list instead.',
              );
            await db
              .insert(boardGrant)
              .values({ boardId, userId: existing.id, grantedBy: actor.id, ...next })
              .onConflictDoUpdate({
                target: [boardGrant.boardId, boardGrant.userId],
                set: { ...next, grantedBy: actor.id, expiryWarnedAt: null },
              });
          } else {
            const pRole = await projectRole(db, existing, projectId);
            // Changing an existing member's role is for owners (PUT /members does that).
            if (pRole)
              throw new HttpError('conflict', 'Already a member: change the role instead.');
            // An ended membership not swept yet is replaced.
            await db
              .insert(projectMember)
              .values({ projectId, userId: existing.id, role, expiresAt: accessExpiresAt })
              .onConflictDoUpdate({
                target: [projectMember.projectId, projectMember.userId],
                set: {
                  role,
                  expiresAt: accessExpiresAt,
                  expiryWarnedAt: null,
                  addedAt: sql`now()`,
                },
              });
          }
        }
        const body: InvitationResult = {
          status: 'added',
          entry: await entryFor(db, target, existing.id),
        };
        return reply.status(200).send(body);
      }
    }

    const instanceLink = input.kind === 'link' && !projectId;
    const expiresInDays =
      instanceLink && (req.body as { expiresInDays?: unknown } | null)?.expiresInDays === undefined
        ? INSTANCE_LINK_DAYS
        : input.expiresInDays;
    const token = newSecret('', 24);
    const [created] = await db
      .insert(invitation)
      .values({
        kind: input.kind,
        tokenHash: sha256(token),
        // Email invitations get a new token when sent again, so they need no copy.
        tokenSealed: input.kind === 'link' ? seal.seal(token) : null,
        email,
        projectId,
        boardId,
        role,
        invitedBy: actor.id,
        maxUses: input.kind === 'email' || instanceLink ? 1 : null,
        expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
        accessExpiresAt,
      })
      .returning();
    if (!created) throw new Error('Invitation insert returned nothing');
    let row = created;
    try {
      row = await sendInvitation(created, token, actor);
    } catch (err) {
      req.log.warn({ err }, 'invitation email not sent');
    }
    const body: InvitationResult = {
      status: 'invited',
      invitation: await toInvitation(row, token),
    };
    return reply.status(201).send(body);
  });

  async function managedInvitation(actor: Actor, invitationId: string) {
    const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
    if (!row) throw new HttpError('not_found', 'Invitation not found.');
    if (row.invitedBy !== actor.id) await managerRole(actor, row);
    return row;
  }

  app.post(v1('/invitations/:invitationId/resend'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { invitationId } = InvitationParams.parse(req.params);
    const row = await managedInvitation(actor, invitationId);
    if (
      row.kind !== 'email' ||
      invitationStatus(row) === 'revoked' ||
      invitationStatus(row) === 'used'
    )
      throw new HttpError('conflict', 'Only unused email invitations can be sent again.');
    if (!mailer.enabled) throw new HttpError('conflict', 'This instance cannot send email.');
    if (row.lastSentAt && Date.now() - row.lastSentAt.getTime() < 60_000)
      throw new HttpError('rate_limited', 'Wait a minute before sending it again.');
    // A new token: the link of the previous email stops working.
    const token = newSecret('', 24);
    const [renewed] = await db
      .update(invitation)
      .set({ tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) })
      .where(eq(invitation.id, row.id))
      .returning();
    return toInvitation(await sendInvitation(renewed ?? row, token, actor), token);
  });

  app.delete(v1('/invitations/:invitationId'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { invitationId } = InvitationParams.parse(req.params);
    const row = await managedInvitation(actor, invitationId);
    await db.update(invitation).set({ revokedAt: new Date() }).where(eq(invitation.id, row.id));
    return reply.status(204).send();
  });

  app.get(v1('/invitations/by-token/:token'), async (req) => {
    if (!previewLimiter.take(addressBucket(req.ip)))
      throw new HttpError('rate_limited', 'Too many requests: wait a minute.');
    const { token } = TokenParams.parse(req.params);
    const row = await findInvitation(db, token);
    if (!row) throw new HttpError('not_found', 'Invitation not found.');
    const [inviter] = row.invitedBy
      ? await db.select({ name: user.name }).from(user).where(eq(user.id, row.invitedBy))
      : [];
    const body: InvitationPreview = {
      instanceName: config.INSTANCE_NAME,
      invitedBy: inviter?.name ?? null,
      ...(await invitationTarget(db, row)),
      role: invitedRole(row),
      email: row.email,
      status: invitationStatus(row),
      expiresAt: iso(row.expiresAt),
      accessExpiresAt: endOf(row.accessExpiresAt),
    };
    return body;
  });

  app.post(v1('/invitations/by-token/:token/claim'), async (req, reply) => {
    if (!previewLimiter.take(addressBucket(req.ip)))
      throw new HttpError('rate_limited', 'Too many requests: wait a minute.');
    const { token } = TokenParams.parse(req.params);
    const row = await findInvitation(db, token);
    if (!row || invitationStatus(row) !== 'valid')
      throw new HttpError('not_found', 'This invitation can no longer be used.');
    setInvitationCookie(reply, token);
    return reply.status(204).send();
  });

  app.post(v1('/invitations/by-token/:token/accept'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    const { token } = TokenParams.parse(req.params);
    const row = await findInvitation(db, token);
    if (!row) throw new HttpError('not_found', 'Invitation not found.');
    const accepted = await acceptInvitation(db, row.id, actor.id);
    setInvitationCookie(reply, null);
    return accepted;
  });
}
