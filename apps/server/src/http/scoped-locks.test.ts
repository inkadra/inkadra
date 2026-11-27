import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClassificationCatalogs, Project } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../auth.ts';
import { lockUses } from '../classifications.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, type Database, runMigrations } from '../db/client.ts';
import {
  asset,
  auditEvent,
  board,
  boardGrant,
  creationRequest,
  invitation,
  notification,
  project,
  projectExportSettings,
  projectMember,
  user,
} from '../db/schema.ts';
import { acceptInvitation } from '../invitations.ts';
import { lockAccount } from '../locks.ts';
import { sha256 } from '../secrets.ts';
import { freshDatabase, testDeps } from '../test-deps.ts';
import { exportProject } from '../transfers/export.ts';
import { importProject } from '../transfers/import.ts';
import { createApp } from './app.ts';
import { creationKeyHash } from './idempotency.ts';

const url = process.env.DATABASE_URL;
const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** The Postgres error code of a failed query (drizzle wraps the driver's error). */
const codeOf = (err: unknown) =>
  (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;

/** Decision 0134: one lock per invariant instead of the instance lock, and an order per member. */
describe.skipIf(!url)('scoped locks and the order per member (needs DATABASE_URL)', () => {
  let db: Database;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createApp>>;
  let deps: ReturnType<typeof testDeps>;
  const people = new Map<string, { id: string; cookie: string }>();

  const call = (
    who: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object | Buffer,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { cookie: people.get(who)?.cookie ?? '', origin: ORIGIN, ...headers },
      ...(payload ? { payload } : {}),
    });
  const deleteMe = (who: string) => call(who, 'DELETE', '/me', { password: PASSWORD });
  const signUp = async (name: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN },
      payload: { name, email: `${name}@example.com`, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    // A verified address, so inviting it gives the role at once.
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, res.json().user.id));
    people.set(name, {
      id: res.json().user.id,
      cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
    });
    return people.get(name)?.id as string;
  };
  const idOf = (name: string) => people.get(name)?.id as string;
  const create = async (who: string, name: string, extra: object = {}) => {
    const res = await call(who, 'POST', '/projects', { name, ...extra });
    expect(res.statusCode).toBe(201);
    return res.json() as Project;
  };
  const list = async (who: string) =>
    ((await call(who, 'GET', '/projects?limit=100')).json().items as Project[]).map((p) => p.name);
  const orphans = async () =>
    (
      await db.execute<{ n: number }>(sql`select count(*)::int as n from project p
        where not exists (select 1 from project_member m where m.project_id = p.id)`)
    )[0]?.n;
  /** A database error under a race comes back as 503 (deadlock, lock timeout) or 500. */
  const noLockErrors = (statuses: number[]) => {
    for (const status of statuses) expect(status).toBeLessThan(500);
  };
  /** Sessions of this database waiting for a lock. */
  const waiting = async () =>
    (
      await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`)
    )[0]?.n ?? 0;
  /** Until `n` sessions wait for a lock, or `done` settles (it waited for nothing). */
  const untilWaiting = async (n: number, done: Promise<unknown>) => {
    let settled = false;
    void done.finally(() => {
      settled = true;
    });
    for (let i = 0; i < 400; i++) {
      if (settled || (await waiting()) >= n) return;
      await sleep(25);
    }
    throw new Error(`${n} sessions never waited`);
  };
  /** A transaction holding what `take` locks, until `release`. */
  const hold = async (take: (tx: Tx) => Promise<unknown>) => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held = () => {};
    const holding = new Promise<void>((r) => {
      held = r;
    });
    const open = db.transaction(async (tx) => {
      await take(tx);
      held();
      await gate;
    });
    await Promise.race([holding, open]);
    return async () => {
      release();
      await open;
    };
  };
  /**
   * The contested order, every time: `first` runs until it waits for what `gate` holds, then
   * `second` until it waits too (for `first`, or the gate), then both go on. The default gate
   * stops a request at its audit event, near the end of its transaction.
   */
  const inOrder = async <A, B>(
    first: () => Promise<A>,
    second: () => Promise<B>,
    gate = sql`lock table audit_event in share mode`,
  ): Promise<[A, B]> => {
    const release = await hold((tx) => tx.execute(gate));
    let a: Promise<A> | undefined;
    let b: Promise<B> | undefined;
    try {
      a = first();
      await untilWaiting(1, a);
      b = second();
      await untilWaiting(2, b);
    } finally {
      await release();
    }
    return [await a, await (b as Promise<B>)];
  };

  beforeAll(async () => {
    const databaseUrl = await freshDatabase(url as string, 'scoped_locks');
    const config = loadConfig({
      NODE_ENV: 'test',
      AUTH_RATE_LIMITS: 'off',
      PUBLIC_URL: ORIGIN,
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
      REGISTRATION: 'open',
    });
    await runMigrations(databaseUrl, migrations);
    const created = createDatabase(databaseUrl, 10);
    db = created.db;
    end = () => created.sql.end({ timeout: 1 });
    const log = pino({ level: 'silent' });
    deps = testDeps(db, log);
    // The password check (scrypt) takes long enough that the request without one always
    // commits first: the races here are about the locks after it.
    const auth = createAuth(config, db);
    vi.spyOn(auth, 'confirmPassword').mockResolvedValue('ok');
    app = await createApp({
      config: { ...config, DATA_DIR: deps.root },
      db,
      auth,
      log,
      ...deps,
    });
    // The first account administers the instance.
    for (const name of ['root', 'ada', 'bruno']) await signUp(name);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await end?.();
  });

  it('lets other people create projects and administrators save settings meanwhile', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held = () => {};
    const holding = new Promise<void>((r) => {
      held = r;
    });
    // What a creation by Ada holds until its commit.
    const open = db.transaction(async (tx) => {
      await lockUses(tx, 'shared');
      await lockAccount(tx, idOf('ada'));
      held();
      await gate;
    });
    await holding;
    try {
      const timeout = sleep(5_000).then(() => 'waited');
      const others = await Promise.race([
        Promise.all([
          call('bruno', 'POST', '/projects', { name: 'Altrove' }),
          call('root', 'PATCH', '/instance/settings', { membersCanCreateProjects: true }),
          call('root', 'PATCH', '/instance/storage-limits', { warnPercent: 80 }),
          call('root', 'PATCH', `/instance/members/${idOf('bruno')}`, { canCreateProjects: true }),
        ]),
        timeout,
      ]);
      expect(others).not.toBe('waited');
      expect((others as { statusCode: number }[]).map((r) => r.statusCode)).toEqual([
        201, 200, 200, 200,
      ]);
      // Ada's own creation waits for her account.
      let settled = false;
      const mine = call('ada', 'POST', '/projects', { name: 'In coda' }).finally(() => {
        settled = true;
      });
      await sleep(300);
      expect(settled).toBe(false);
      release();
      expect((await mine).statusCode).toBe(201);
    } finally {
      release();
      await open;
    }
  });

  it('gives each creation by one person a position of its own', async () => {
    const made = await Promise.all(
      Array.from({ length: 6 }, (_, i) => call('ada', 'POST', '/projects', { name: `Pari ${i}` })),
    );
    expect(made.map((r) => r.statusCode)).toEqual(Array(6).fill(201));
    const rows = await db
      .select({ position: projectMember.position })
      .from(projectMember)
      .where(eq(projectMember.userId, idOf('ada')));
    expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length);
    expect(rows.every((r) => r.position !== null)).toBe(true);
  });

  it('never leaves a project without its creator when they delete their account meanwhile', async () => {
    for (let round = 0; round < 4; round++) {
      const name = `racer${round}`;
      const id = await signUp(name);
      await create(name, 'Primo');
      // Two rounds reuse an Idempotency-Key whose row has expired: it is deleted under the key.
      const key = `chiave-${round}`;
      const keyed = round >= 2;
      if (keyed)
        await db.insert(creationRequest).values({
          keyHash: creationKeyHash(id, 'projects', key),
          userId: id,
          fingerprint: 'scaduta',
          resourceId: randomUUID(),
          expiresAt: new Date(Date.now() - 60_000),
        });
      const creation = () =>
        call(
          name,
          'POST',
          '/projects',
          { name: 'Ultimo' },
          keyed ? { 'idempotency-key': key } : {},
        );
      const deletion = () => deleteMe(name);
      if (round % 2 === 0) {
        // The creation holds the account while it inserts the project: the deletion waits,
        // then deletes the project with them.
        const [made, deleted] = await inOrder(
          creation,
          deletion,
          sql`lock table project in share mode`,
        );
        expect([made.statusCode, deleted.statusCode]).toEqual([201, 204]);
      } else {
        const [deleted, made] = await inOrder(deletion, creation);
        expect([deleted.statusCode, made.statusCode]).toEqual([204, 401]);
      }
      expect(await orphans()).toBe(0);
    }
  });

  it('runs one account deletion at a time: their cascades meet in rows that refer to both', async () => {
    const [a, b] = [await signUp('mittente'), await signUp('destinatario')];
    // Each deletes one of these and clears its actor on the other.
    const rows = await db
      .insert(notification)
      .values([
        { userId: a, actorId: b, type: 'mention' },
        { userId: b, actorId: a, type: 'mention' },
      ])
      .returning({ id: notification.id });
    const ids = rows.map((r) => r.id);
    // Both deletions reach the notifications at once, past every other step.
    const [first, second] = await inOrder(
      () => deleteMe('mittente'),
      () => deleteMe('destinatario'),
      sql`select id from notification where id in (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}) for update`,
    );
    expect([first.statusCode, second.statusCode]).toEqual([204, 204]);
  });

  it('lets two administrators change each other at once', async () => {
    const other = await signUp('vice');
    expect(
      (await call('root', 'PATCH', `/instance/members/${other}`, { role: 'admin' })).statusCode,
    ).toBe(200);
    // Each holds the other's row when it records the change, which refers to itself.
    const [one, two] = await inOrder(
      () => call('root', 'PATCH', `/instance/members/${other}`, { canCreateProjects: false }),
      () => call('vice', 'PATCH', `/instance/members/${idOf('root')}`, { canCreateProjects: true }),
    );
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(
      (await call('root', 'PATCH', `/instance/members/${other}`, { role: 'member' })).statusCode,
    ).toBe(200);
  });

  it('deletes an account while its owner uploads into a project of someone else', async () => {
    const id = await signUp('caricatore');
    const own = await create('caricatore', 'Da solo');
    const shared = await create('root', 'Di root');
    expect(
      (await call('root', 'PUT', `/projects/${shared.id}/members/${id}`, { role: 'editor' }))
        .statusCode,
    ).toBe(200);
    const file = (projectId: string) => ({
      projectId,
      kind: 'file' as const,
      mime: 'text/plain',
      filename: 'nota.txt',
      size: 10,
      storageKey: `originals/${randomUUID()}`,
      createdBy: id,
    });
    await db.insert(asset).values(file(own.id));
    let upload: Promise<unknown> | undefined;
    // The deletion stops at its audit events, after deleting the project it owns alone (and
    // its file, off their storage total); then their upload elsewhere adds a file.
    const [deletion] = await inOrder(
      () => deleteMe('caricatore'),
      () => {
        upload = db
          .insert(asset)
          .values(file(shared.id))
          .catch((err: unknown) => err);
        return upload;
      },
    );
    expect(deletion.statusCode).toBe(204);
    // The upload waited for the deletion and finds nobody to give the file to.
    expect(codeOf(await upload)).toBe('23503');
  });

  it('answers a member added or invited just before their deletion', async () => {
    const p = await create('root', 'Risposte');
    const transaction = db.transaction.bind(db);
    for (const via of ['put', 'invitation'] as const) {
      const name = `risposta-${via}`;
      const id = await signUp(name);
      // Their deletion commits right after the transaction that added them.
      let fired = false;
      let deletion: Awaited<ReturnType<typeof deleteMe>> | undefined;
      const spy = vi.spyOn(db, 'transaction').mockImplementation((async (
        ...args: Parameters<typeof transaction>
      ) => {
        const result = await transaction(...args);
        const [member] = await db
          .select()
          .from(projectMember)
          .where(sql`${projectMember.projectId} = ${p.id} and ${projectMember.userId} = ${id}`);
        if (member && !fired) {
          fired = true;
          deletion = await deleteMe(name);
        }
        return result;
      }) as never);
      try {
        const added =
          via === 'put'
            ? await call('root', 'PUT', `/projects/${p.id}/members/${id}`, { role: 'editor' })
            : await call('root', 'POST', '/invitations', {
                kind: 'email',
                email: `${name}@example.com`,
                projectId: p.id,
                role: 'editor',
              });
        expect(deletion?.statusCode).toBe(204);
        expect(added.statusCode).toBe(200);
        const body = added.json();
        expect((via === 'put' ? body : body.entry).user.id).toBe(id);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it('accepts an invitation before the deletion of the owner who sent it, or not at all', async () => {
    for (const acceptFirst of [true, false]) {
      const host = `ospite${acceptFirst}`;
      const guest = `invitato${acceptFirst}`;
      const hostId = await signUp(host);
      const guestId = await signUp(guest);
      // Theirs alone: the deletion deletes it, and the invitation with it.
      const p = await create(host, 'Invito');
      const [inv] = await db
        .insert(invitation)
        .values({
          kind: 'email',
          tokenHash: sha256(randomUUID()),
          email: `${guest}@example.com`,
          projectId: p.id,
          role: 'editor',
          invitedBy: hostId,
          maxUses: 1,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning({ id: invitation.id });
      const accept = () =>
        acceptInvitation(db, inv?.id as string, guestId).catch((err: unknown) => err);
      if (acceptFirst) {
        // The accept stops when it marks the address verified, holding the invitation.
        const [accepted, deleted] = await inOrder(
          accept,
          () => deleteMe(host),
          sql`select id from "user" where id = ${guestId} for share`,
        );
        expect(accepted).toEqual({ projectId: p.id, boardId: null });
        // Now shared with the guest, of whom the host is the only owner.
        expect(deleted.statusCode).toBe(409);
        expect(await list(guest)).toEqual(['Invito']);
      } else {
        const [deleted, accepted] = await inOrder(() => deleteMe(host), accept);
        expect(deleted.statusCode).toBe(204);
        expect((accepted as { code?: string }).code).toBe('not_found');
        expect(await list(guest)).toEqual([]);
      }
    }
  });

  it('shares a board before its sole owner is deleted, or refuses once they are gone', async () => {
    for (const shareFirst of [true, false]) {
      const owner = `condivide${shareFirst}`;
      const guest = `ricevente${shareFirst}`;
      await signUp(owner);
      await signUp(guest);
      const p = await create(owner, 'Da condividere');
      const share = () =>
        call(owner, 'POST', '/invitations', {
          kind: 'email',
          email: `${guest}@example.com`,
          projectId: p.id,
          boardId: p.rootBoardId,
          role: 'viewer',
        });
      if (shareFirst) {
        const [shared, deleted] = await inOrder(share, () => deleteMe(owner));
        expect(shared.statusCode).toBe(200);
        // The guest's grant counts: the deletion no longer deletes the project with it.
        expect(deleted.statusCode).toBe(409);
      } else {
        const [deleted, shared] = await inOrder(() => deleteMe(owner), share);
        expect(deleted.statusCode).toBe(204);
        expect(shared.statusCode).toBe(401);
      }
    }
  });

  it('grants a board before its sole owner is deleted, or refuses once they are gone', async () => {
    for (const grantFirst of [true, false]) {
      const owner = `concede${grantFirst}`;
      const guest = `concesso${grantFirst}`;
      await signUp(owner);
      const guestId = await signUp(guest);
      const p = await create(owner, 'Da concedere');
      const sub = await call(owner, 'POST', `/projects/${p.id}/boards`, {
        parentBoardId: p.rootBoardId,
        title: 'Sotto',
      });
      expect(sub.statusCode).toBe(201);
      const grant = () =>
        call(owner, 'PUT', `/boards/${sub.json().id}/grants/${guestId}`, { role: 'viewer' });
      if (grantFirst) {
        const [granted, deleted] = await inOrder(grant, () => deleteMe(owner));
        expect(granted.statusCode).toBe(200);
        expect(granted.json().user.id).toBe(guestId);
        // The guest's grant counts: the deletion no longer deletes the project with it.
        expect(deleted.statusCode).toBe(409);
      } else {
        const [deleted, granted] = await inOrder(() => deleteMe(owner), grant);
        expect(deleted.statusCode).toBe(204);
        expect(granted.statusCode).toBe(401);
      }
    }
  });

  it('removes a grant for an editor deleting their own account meanwhile, or refuses after', async () => {
    const p = await create('root', 'Da revocare');
    const sub = await call('root', 'POST', `/projects/${p.id}/boards`, {
      parentBoardId: p.rootBoardId,
      title: 'Sotto',
    });
    expect(sub.statusCode).toBe(201);
    for (const removeFirst of [true, false]) {
      const editor = `revoca${removeFirst}`;
      const editorId = await signUp(editor);
      const guestId = await signUp(`revocato${removeFirst}`);
      expect(
        (await call('root', 'PUT', `/projects/${p.id}/members/${editorId}`, { role: 'editor' }))
          .statusCode,
      ).toBe(200);
      const path = `/boards/${sub.json().id}/grants/${guestId}`;
      // Granted by the editor: their deletion clears `granted_by` on it.
      expect((await call(editor, 'PUT', path, { role: 'viewer' })).statusCode).toBe(200);
      const remove = () => call(editor, 'DELETE', path);
      if (removeFirst) {
        const [removed, deleted] = await inOrder(remove, () => deleteMe(editor));
        expect(removed.statusCode).toBe(204);
        expect(deleted.statusCode).toBe(204);
      } else {
        const [deleted, removed] = await inOrder(() => deleteMe(editor), remove);
        expect(deleted.statusCode).toBe(204);
        expect(removed.statusCode).toBe(401);
      }
    }
  });

  it('refuses a grant by an editor demoted meanwhile, after it waited for them', async () => {
    const p = await create('root', 'Da declassare');
    const sub = await call('root', 'POST', `/projects/${p.id}/boards`, {
      parentBoardId: p.rootBoardId,
      title: 'Sotto',
    });
    expect(sub.statusCode).toBe(201);
    for (const via of ['put', 'delete'] as const) {
      const editor = `declassato-${via}`;
      const editorId = await signUp(editor);
      const guestId = await signUp(`ospite-${via}`);
      const member = `/projects/${p.id}/members/${editorId}`;
      expect((await call('root', 'PUT', member, { role: 'editor' })).statusCode).toBe(200);
      const path = `/boards/${sub.json().id}/grants/${guestId}`;
      if (via === 'delete')
        expect((await call('root', 'PUT', path, { role: 'viewer' })).statusCode).toBe(200);
      // The editor passes the check before the transaction, then waits for their account.
      const [demoted, changed] = await inOrder(
        () => call('root', 'PUT', member, { role: 'viewer' }),
        () =>
          via === 'put'
            ? call(editor, 'PUT', path, { role: 'viewer' })
            : call(editor, 'DELETE', path),
      );
      expect(demoted.statusCode).toBe(200);
      expect(changed.statusCode).toBe(403);
      const grants = await db
        .select()
        .from(boardGrant)
        .where(sql`${boardGrant.boardId} = ${sub.json().id} and ${boardGrant.userId} = ${guestId}`);
      expect(grants.length).toBe(via === 'put' ? 0 : 1);
    }
  });

  it('answers a grant to a person deleted right after it', async () => {
    const p = await create('root', 'Risposta concessa');
    const sub = await call('root', 'POST', `/projects/${p.id}/boards`, {
      parentBoardId: p.rootBoardId,
      title: 'Sotto',
    });
    expect(sub.statusCode).toBe(201);
    const guestId = await signUp('concessa-poi-via');
    const transaction = db.transaction.bind(db);
    let fired = false;
    let deletion: Awaited<ReturnType<typeof deleteMe>> | undefined;
    // Their deletion commits right after the transaction that granted them the board.
    const spy = vi.spyOn(db, 'transaction').mockImplementation((async (
      ...args: Parameters<typeof transaction>
    ) => {
      const result = await transaction(...args);
      const [grant] = await db.select().from(boardGrant).where(eq(boardGrant.userId, guestId));
      if (grant && !fired) {
        fired = true;
        deletion = await deleteMe('concessa-poi-via');
      }
      return result;
    }) as never);
    try {
      const granted = await call('root', 'PUT', `/boards/${sub.json().id}/grants/${guestId}`, {
        role: 'viewer',
      });
      expect(deletion?.statusCode).toBe(204);
      expect(granted.statusCode).toBe(200);
      expect(granted.json().user.id).toBe(guestId);
    } finally {
      spy.mockRestore();
    }
  });

  it('adds a member for an editor deleting their own account meanwhile, or refuses after', async () => {
    const p = await create('root', 'Aggiunte da editor');
    for (const addFirst of [true, false]) {
      const editor = `editore${addFirst}`;
      const added = `aggiunto${addFirst}`;
      const editorId = await signUp(editor);
      const addedId = await signUp(added);
      expect(
        (await call('root', 'PUT', `/projects/${p.id}/members/${editorId}`, { role: 'editor' }))
          .statusCode,
      ).toBe(200);
      const add = () =>
        call(editor, 'PUT', `/projects/${p.id}/members/${addedId}`, { role: 'viewer' });
      if (addFirst) {
        const [put, deleted] = await inOrder(add, () => deleteMe(editor));
        expect(put.statusCode).toBe(200);
        expect(deleted.statusCode).toBe(204);
      } else {
        const [deleted, put] = await inOrder(() => deleteMe(editor), add);
        expect(deleted.statusCode).toBe(204);
        expect(put.statusCode).toBe(401);
      }
    }
  });

  it('lets a person leave a project while deleting their account', async () => {
    const p = await create('root', 'Da lasciare');
    const id = await signUp('partente');
    expect(
      (await call('root', 'PUT', `/projects/${p.id}/members/${id}`, { role: 'editor' })).statusCode,
    ).toBe(200);
    const [deleted, left] = await inOrder(
      () => deleteMe('partente'),
      () => call('partente', 'DELETE', `/projects/${p.id}/members/${id}`),
    );
    expect(deleted.statusCode).toBe(204);
    expect([401, 404]).toContain(left.statusCode);
  });

  it('refuses an import by a person deleted meanwhile, with an expired Idempotency-Key', async () => {
    const id = await signUp('importatore');
    await db.insert(creationRequest).values({
      keyHash: creationKeyHash(id, 'imports', 'vecchia'),
      userId: id,
      fingerprint: 'scaduta',
      resourceId: randomUUID(),
      expiresAt: new Date(Date.now() - 60_000),
    });
    const [deleted, imported] = await inOrder(
      () => deleteMe('importatore'),
      () =>
        call('importatore', 'POST', '/projects/import', Buffer.from('PK'), {
          'content-type': 'application/zip',
          'idempotency-key': 'vecchia',
        }),
    );
    expect(deleted.statusCode).toBe(204);
    expect(imported.statusCode).toBe(401);
  });

  it('deletes an account once when asked twice at once', async () => {
    await signUp('doppio');
    const events = async () =>
      (
        await db
          .select({ id: auditEvent.id })
          .from(auditEvent)
          .where(eq(auditEvent.action, 'account.deleted'))
      ).length;
    const before = await events();
    const [first, second] = await inOrder(
      () => deleteMe('doppio'),
      () => deleteMe('doppio'),
    );
    expect([first.statusCode, second.statusCode]).toEqual([204, 401]);
    expect(await events()).toBe(before + 1);
  });

  it('refuses a setting by an administrator demoted meanwhile', async () => {
    const id = await signUp('declassato');
    expect(
      (await call('root', 'PATCH', `/instance/members/${id}`, { role: 'admin' })).statusCode,
    ).toBe(200);
    const [demoted, saved] = await inOrder(
      () => call('root', 'PATCH', `/instance/members/${id}`, { role: 'member' }),
      () => call('declassato', 'PATCH', '/instance/settings', { membersCanCreateProjects: true }),
    );
    expect([demoted.statusCode, saved.statusCode]).toEqual([200, 403]);
  });

  it('promotes a member deleting their account, or finds them gone', async () => {
    for (const promoteFirst of [true, false]) {
      const name = `promosso${promoteFirst}`;
      const id = await signUp(name);
      const promote = () => call('root', 'PATCH', `/instance/members/${id}`, { role: 'admin' });
      if (promoteFirst) {
        const [promoted, deleted] = await inOrder(promote, () => deleteMe(name));
        expect([promoted.statusCode, deleted.statusCode]).toEqual([200, 204]);
      } else {
        const [deleted, promoted] = await inOrder(() => deleteMe(name), promote);
        expect([deleted.statusCode, promoted.statusCode]).toEqual([204, 404]);
      }
    }
  });

  /** A project made by `name` and owned by root now: their deletion clears its `created_by`. */
  const handedOver = async (name: string) => {
    await signUp(name);
    const p = await create(name, 'Condiviso');
    expect(
      (await call(name, 'PUT', `/projects/${p.id}/members/${idOf('root')}`, { role: 'owner' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call('root', 'PUT', `/projects/${p.id}/members/${idOf(name)}`, { role: 'editor' }))
        .statusCode,
    ).toBe(200);
    return p;
  };

  it('locks the projects a deletion changes before their boards, as a project change does', async () => {
    const p = await handedOver('mover');
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held = () => {};
    const holding = new Promise<void>((r) => {
      held = r;
    });
    // What PATCH /projects/:id does: the project row, then its root board (the creator's).
    const change = db.transaction(async (tx) => {
      await tx.execute(sql`select id from project where id = ${p.id} for update`);
      held();
      await gate;
      await tx.execute(sql`update board set title = 'Spostato' where id = ${p.rootBoardId}`);
    });
    await holding;
    const deletion = deleteMe('mover');
    // The deletion waits for the project the change holds.
    await untilWaiting(1, deletion);
    release();
    await change;
    expect((await deletion).statusCode).toBe(204);
  });

  /** A file of `who` in the project `projectId`, as an upload leaves it. */
  const fileIn = async (projectId: string, who: string) => {
    const id = randomUUID();
    await db.insert(asset).values({
      id,
      projectId,
      kind: 'image',
      mime: 'image/png',
      filename: 'logo.png',
      size: 10,
      storageKey: `originals/${id}`,
      createdBy: idOf(who),
    });
    return id;
  };

  it('locks a deleted project before its files, as a change of its logo does', async () => {
    const p = await create('root', 'Con logo');
    const file = await fileIn(p.id, 'root');
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held = () => {};
    const holding = new Promise<void>((r) => {
      held = r;
    });
    // What PATCH export-settings does: the project row, then the logo's file.
    const change = db.transaction(async (tx) => {
      await tx.execute(sql`select id from project where id = ${p.id} for update`);
      held();
      await gate;
      await tx.execute(sql`select id from asset where id = ${file} for update`);
    });
    await holding;
    const deletion = call('root', 'DELETE', `/projects/${p.id}`);
    // The deletion waits for the project the change holds, holding none of its files.
    await untilWaiting(1, deletion);
    release();
    await change;
    expect((await deletion).statusCode).toBe(204);
  });

  it('deletes a project while an editor who made a board and a file in it leaves', async () => {
    // Root's project; the editor neither made nor owns it, but made a board and a file in it.
    const editor = await signUp('redattrice');
    const p = await create('root', 'Di root, con altri');
    expect(
      (await call('root', 'PUT', `/projects/${p.id}/members/${editor}`, { role: 'editor' }))
        .statusCode,
    ).toBe(200);
    await db.insert(board).values({
      projectId: p.id,
      parentBoardId: p.rootBoardId,
      title: 'Sua',
      position: 'a1',
      createdBy: editor,
    });
    await fileIn(p.id, 'redattrice');
    // The account deletion holds the editor's files and stops at its audit event, before it
    // clears `created_by` on their board; then the project deletion runs until it waits.
    const [left, deleted] = await inOrder(
      () => deleteMe('redattrice'),
      () => call('root', 'DELETE', `/projects/${p.id}`),
    );
    expect([left.statusCode, deleted.statusCode]).toEqual([204, 204]);
  });

  it('changes a logo to a file of another project while its uploader leaves', async () => {
    // The person's current logo of one project, and a file of theirs in another project with a
    // lower id: their account deletion locks their files by id, the second one first.
    const uploader = await signUp('grafica');
    const mine = await create('grafica', 'Con logo suo');
    const other = await create('grafica', 'Altro');
    const [low, high] = [randomUUID(), randomUUID()].sort();
    const file = (id: string, projectId: string) => ({
      id,
      projectId,
      kind: 'image' as const,
      mime: 'image/png',
      filename: 'logo.png',
      size: 10,
      storageKey: `originals/${id}`,
      status: 'ready' as const,
      createdBy: uploader,
    });
    await db.insert(asset).values([file(high as string, mine.id), file(low as string, other.id)]);
    await db.insert(projectExportSettings).values({ projectId: mine.id, logoAssetId: high });
    // What DELETE /me does with their files: the lower id first, then the other.
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held = () => {};
    const holding = new Promise<void>((r) => {
      held = r;
    });
    const deletion = db.transaction(async (tx) => {
      await tx.execute(sql`select id from asset where id = ${low} for update`);
      held();
      await gate;
      await tx.execute(sql`select id from asset where id = ${high} for update`);
    });
    await holding;
    // The change locks its project's logo; the file of the other project is only read.
    const change = call('grafica', 'PATCH', `/projects/${mine.id}/export-settings`, {
      logoAssetId: low,
    });
    await untilWaiting(1, change);
    release();
    await deletion;
    expect((await change).statusCode).toBe(400);
  });

  it('orders an account deletion with changes to its projects and to the person', async () => {
    for (let round = 0; round < 4; round++) {
      const name = `leaver${round}`;
      const p = await handedOver(name);
      const results = await Promise.all([
        call(name, 'PATCH', `/projects/${p.id}`, { name: 'Rinominato' }),
        call('root', 'PATCH', `/projects/${p.id}`, { name: 'Rinominato ancora' }),
        call(name, 'DELETE', '/me', { password: PASSWORD }),
        call('root', 'PATCH', `/instance/members/${idOf(name)}`, { canCreateProjects: false }),
      ]);
      noLockErrors(results.map((r) => r.statusCode));
      expect(results[2]?.statusCode).toBe(204);
      const [left] = await db.select().from(project).where(eq(project.id, p.id));
      expect(left?.createdBy).toBeNull();
    }
  });

  it('refuses a removal of a type that a creation or a change is using, or the use', async () => {
    const catalogs = async () =>
      (await call('root', 'GET', '/instance/classifications')).json() as ClassificationCatalogs;
    const target = await create('root', 'Da cambiare');
    for (let round = 0; round < 4; round++) {
      const id = randomUUID();
      const next = await catalogs();
      next.projectTypes.push({ id, label: `Tipo ${round}`, archived: false });
      expect((await call('root', 'PUT', '/instance/classifications', next)).statusCode).toBe(200);
      const without = await catalogs();
      without.projectTypes = without.projectTypes.filter((o) => o.id !== id);
      const use =
        round % 2
          ? call('ada', 'POST', '/projects', { name: 'Tipizzato', type: id })
          : call('root', 'PATCH', `/projects/${target.id}`, { type: id });
      const [removal, used] = await Promise.all([
        call('root', 'PUT', '/instance/classifications', without),
        use,
      ]);
      noLockErrors([removal.statusCode, used.statusCode]);
      const [{ n } = { n: 0 }] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from project where type = ${id}`,
      );
      if (removal.statusCode === 200) {
        expect(used.statusCode).toBe(400);
        expect(n).toBe(0);
      } else {
        expect(removal.statusCode).toBe(409);
        expect(removal.json().error.details.reason).toBe('classification_in_use');
        expect([200, 201]).toContain(used.statusCode);
        expect(n).toBe(1);
      }
      if (round % 2 === 0) await call('root', 'PATCH', `/projects/${target.id}`, { type: null });
    }
  });

  it('keeps an order per member, and lets a viewer move a project in their own list', async () => {
    const version = await call('bruno', 'GET', '/instance/version');
    expect(version.json().capabilities).toContain('per-member-project-order');
    const owner = await signUp('carla');
    const viewer = await signUp('dario');
    const first = await create('carla', 'Primo');
    const second = await create('carla', 'Secondo');
    for (const p of [first, second])
      expect(
        (await call('carla', 'PUT', `/projects/${p.id}/members/${viewer}`, { role: 'viewer' }))
          .statusCode,
      ).toBe(200);
    expect(await list('dario')).toEqual(['Primo', 'Secondo']);
    // A viewer still cannot change the project for everyone, and then moves nothing either.
    const top = generateKeyBetween(
      null,
      (await call('dario', 'GET', `/projects/${first.id}`)).json().position,
    );
    expect(
      (await call('dario', 'PATCH', `/projects/${second.id}`, { name: 'No', position: top }))
        .statusCode,
    ).toBe(403);
    expect(await list('dario')).toEqual(['Primo', 'Secondo']);
    // Not a key: it would break every later addition after it.
    expect(
      (await call('dario', 'PATCH', `/projects/${second.id}`, { position: 'zz' })).statusCode,
    ).toBe(400);
    const moved = await call('dario', 'PATCH', `/projects/${second.id}`, { position: top });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().position).toBe(top);
    expect(await list('dario')).toEqual(['Secondo', 'Primo']);
    expect(await list('carla')).toEqual(['Primo', 'Secondo']);
    // The cursor follows the caller's order.
    const page = (await call('dario', 'GET', '/projects?limit=1')).json();
    expect(page.items.map((p: Project) => p.name)).toEqual(['Secondo']);
    const rest = (
      await call('dario', 'GET', `/projects?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`)
    ).json();
    expect(rest.items.map((p: Project) => p.name)).toEqual(['Primo']);
    // The project's own position, for older servers and archives, did not move.
    const [row] = await db.select().from(project).where(eq(project.id, second.id));
    expect(row?.position).toBe(second.position);
    expect(owner).toBeTruthy();
    // A project they join goes last in their list; a change of role keeps its place.
    const third = await create('carla', 'Terzo');
    expect(
      (await call('carla', 'PUT', `/projects/${third.id}/members/${viewer}`, { role: 'viewer' }))
        .statusCode,
    ).toBe(200);
    expect(await list('dario')).toEqual(['Secondo', 'Primo', 'Terzo']);
    expect(
      (await call('carla', 'PUT', `/projects/${second.id}/members/${viewer}`, { role: 'editor' }))
        .statusCode,
    ).toBe(200);
    expect(await list('dario')).toEqual(['Secondo', 'Primo', 'Terzo']);
  });

  it('puts a membership that had ended last in the list again', async () => {
    await signUp('gaia');
    const id = await signUp('ivo');
    const made = [];
    for (const name of ['Uno', 'Due', 'Tre']) {
      const p = await create('gaia', name);
      expect(
        (await call('gaia', 'PUT', `/projects/${p.id}/members/${id}`, { role: 'viewer' }))
          .statusCode,
      ).toBe(200);
      made.push(p);
    }
    expect(await list('ivo')).toEqual(['Uno', 'Due', 'Tre']);
    // Ended, not swept yet: given again, it starts over at the end.
    await db
      .update(projectMember)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(sql`${projectMember.projectId} = ${made[0]?.id} and ${projectMember.userId} = ${id}`);
    expect(
      (await call('gaia', 'PUT', `/projects/${made[0]?.id}/members/${id}`, { role: 'viewer' }))
        .statusCode,
    ).toBe(200);
    expect(await list('ivo')).toEqual(['Due', 'Tre', 'Uno']);
  });

  it('keeps every list as it was through the migration, and reads a missing position as before', async () => {
    const before = await list('ada');
    await db
      .update(projectMember)
      .set({ position: null })
      .where(eq(projectMember.userId, idOf('ada')));
    // Without a position of their own, the list falls back to the project's.
    expect(await list('ada')).toEqual(before);
    const migration = readFileSync(join(migrations, '0056_project_member_position.sql'), 'utf8');
    const update = migration
      .split('--> statement-breakpoint')
      .map((s) => s.replace(/^--.*$/gm, '').trim())
      .find((s) => s.startsWith('UPDATE'));
    expect(update).toBeDefined();
    await db.execute(sql.raw(update as string));
    expect(await list('ada')).toEqual(before);
    const [{ n } = { n: -1 }] = await db.execute<{ n: number }>(sql`select count(*)::int as n
      from project_member m join project p on p.id = m.project_id
      where m.position is distinct from p.position`);
    expect(n).toBe(0);
  });

  it('keeps one active administrator when two demote or delete each other at once', async () => {
    const admins = async () =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from "user" where role = 'admin' and deactivated_at is null`,
        )
      )[0]?.n;
    const eva = await signUp('eva');
    const fede = await signUp('fede');
    await db.update(user).set({ role: 'admin' }).where(sql`${user.id} in (${eva}, ${fede})`);
    await db
      .update(user)
      .set({ role: 'member' })
      .where(eq(user.id, idOf('root')));
    expect(await admins()).toBe(2);
    const demotions = await Promise.all([
      call('eva', 'PATCH', `/instance/members/${fede}`, { role: 'member' }),
      call('fede', 'PATCH', `/instance/members/${eva}`, { role: 'member' }),
    ]);
    noLockErrors(demotions.map((r) => r.statusCode));
    expect(demotions.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(await admins()).toBe(1);
    await db.update(user).set({ role: 'admin' }).where(sql`${user.id} in (${eva}, ${fede})`);
    const deletions = await Promise.all([
      call('eva', 'DELETE', '/me', { password: PASSWORD }),
      call('fede', 'DELETE', '/me', { password: PASSWORD }),
    ]);
    expect(deletions.map((r) => r.statusCode).sort()).toEqual([204, 409]);
    expect(await admins()).toBe(1);
    await db
      .update(user)
      .set({ role: 'admin' })
      .where(eq(user.id, idOf('root')));
  });

  it('lets an import finish before its importer is deleted, or fail cleanly after', async () => {
    const source = await create('root', 'Da esportare');
    const archive = join(deps.root, 'scoped-locks.zip');
    await exportProject({ db, storage: deps.storage }, source.id, archive);
    const importDeps = {
      db,
      storage: deps.storage,
      jobs: deps.jobs,
      uploadMaxSize: 0,
      importMaxSize: 1024 ** 3,
    };
    for (let round = 0; round < 4; round++) {
      const name = `importer${round}`;
      const id = await signUp(name);
      const [imported, deletion] = await Promise.allSettled([
        importProject(importDeps, archive, id),
        call(name, 'DELETE', '/me', { password: PASSWORD }),
      ]);
      expect(deletion.status === 'fulfilled' && deletion.value.statusCode).toBe(204);
      if (imported.status === 'rejected') expect((imported.reason as Error).message).toBe('gone');
      expect(await orphans()).toBe(0);
    }
  });

  it('runs two deletions asked at once when they share projects', async () => {
    for (let round = 0; round < 3; round++) {
      const [a, b] = [`pair${round}a`, `pair${round}b`];
      const [aId, bId] = [await signUp(a), await signUp(b)];
      const owner = (who: string, p: Project, id: string) =>
        call(who, 'PUT', `/projects/${p.id}/members/${id}`, { role: 'owner' });
      // Owned by both; and one made by each, now owned by the other alone.
      const both = await create(a, 'Di entrambi');
      expect((await owner(a, both, bId)).statusCode).toBe(200);
      const byA = await create(a, 'Fatto da A');
      expect((await owner(a, byA, bId)).statusCode).toBe(200);
      expect((await call(b, 'DELETE', `/projects/${byA.id}/members/${aId}`)).statusCode).toBe(204);
      const byB = await create(b, 'Fatto da B');
      expect((await owner(b, byB, aId)).statusCode).toBe(200);
      expect((await call(a, 'DELETE', `/projects/${byB.id}/members/${bId}`)).statusCode).toBe(204);
      const deletions = await Promise.all([
        call(a, 'DELETE', '/me', { password: PASSWORD }),
        call(b, 'DELETE', '/me', { password: PASSWORD }),
      ]);
      expect(deletions.map((r) => r.statusCode)).toEqual([204, 204]);
      expect(await orphans()).toBe(0);
    }
  });

  it('adds a person to a project before their deletion, or not at all', async () => {
    const p = await create('root', 'Accoglienza');
    for (let round = 0; round < 4; round++) {
      const name = `joiner${round}`;
      const id = await signUp(name);
      const add = () =>
        round % 2
          ? call('root', 'PUT', `/projects/${p.id}/members/${id}`, { role: 'editor' })
          : call('root', 'POST', '/invitations', {
              kind: 'email',
              email: `${name}@example.com`,
              projectId: p.id,
              role: 'editor',
            });
      if (round < 2) {
        const [added, deleted] = await inOrder(add, () => deleteMe(name));
        expect([added.statusCode, deleted.statusCode]).toEqual([200, 204]);
      } else {
        const [deleted, added] = await inOrder(() => deleteMe(name), add);
        expect([deleted.statusCode, added.statusCode]).toEqual([204, 404]);
      }
    }
  });

  it('refuses a removal of a type that an import is using, or brings it back', async () => {
    const catalogs = async () =>
      (await call('root', 'GET', '/instance/classifications')).json() as ClassificationCatalogs;
    const importDeps = {
      db,
      storage: deps.storage,
      jobs: deps.jobs,
      uploadMaxSize: 0,
      importMaxSize: 1024 ** 3,
    };
    for (let round = 0; round < 3; round++) {
      const id = randomUUID();
      const next = await catalogs();
      next.projectTypes.push({ id, label: `Importato ${round}`, archived: false });
      expect((await call('root', 'PUT', '/instance/classifications', next)).statusCode).toBe(200);
      const source = await create('root', 'Tipizzato', { type: id });
      const archive = join(deps.root, `typed-${round}.zip`);
      await exportProject({ db, storage: deps.storage }, source.id, archive);
      await call('root', 'DELETE', `/projects/${source.id}`);
      const without = await catalogs();
      without.projectTypes = without.projectTypes.filter((o) => o.id !== id);
      const [removal, imported] = await Promise.all([
        call('root', 'PUT', '/instance/classifications', without),
        importProject(importDeps, archive, idOf('ada')),
      ]);
      noLockErrors([removal.statusCode]);
      expect([200, 409]).toContain(removal.statusCode);
      const [made] = await db.select().from(project).where(eq(project.id, imported.projectId));
      expect(made?.type).toBe(id);
      // Either way the type is in the catalog: kept, or brought back archived.
      expect((await catalogs()).projectTypes.some((o) => o.id === id)).toBe(true);
    }
  });

  it('takes no instance-wide lock anywhere, and the scoped ones from locks.ts', () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    const using = files.filter((f) => /\b10892\b/.test(readFileSync(join(src, f), 'utf8')));
    expect(using).toEqual(['locks.ts']);
  });
});
