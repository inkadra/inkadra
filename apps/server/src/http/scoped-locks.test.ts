import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClassificationCatalogs, Project } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { lockUses } from '../classifications.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, type Database, runMigrations } from '../db/client.ts';
import { project, projectMember, user } from '../db/schema.ts';
import { lockAccount } from '../locks.ts';
import { freshDatabase, testDeps } from '../test-deps.ts';
import { exportProject } from '../transfers/export.ts';
import { importProject } from '../transfers/import.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { cookie: people.get(who)?.cookie ?? '', origin: ORIGIN },
      ...(payload ? { payload } : {}),
    });
  const signUp = async (name: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN },
      payload: { name, email: `${name}@example.com`, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
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
    app = await createApp({
      config: { ...config, DATA_DIR: deps.root },
      db,
      auth: createAuth(config, db),
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
    for (let round = 0; round < 6; round++) {
      const name = `racer${round}`;
      await signUp(name);
      await create(name, 'Primo');
      const [creation, deletion] = await Promise.all([
        call(name, 'POST', '/projects', { name: 'Ultimo' }),
        call(name, 'DELETE', '/me', { password: PASSWORD }),
      ]);
      noLockErrors([creation.statusCode, deletion.statusCode]);
      expect(deletion.statusCode).toBe(204);
      expect([201, 401]).toContain(creation.statusCode);
      expect(await orphans()).toBe(0);
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
    const deletion = call('mover', 'DELETE', '/me', { password: PASSWORD });
    // Long enough for the deletion to reach its locks after checking the password.
    await sleep(1_500);
    release();
    await change;
    expect((await deletion).statusCode).toBe(204);
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
        expect(removal.json().details.reason).toBe('classification_in_use');
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

  it('runs two deletions side by side when they share projects', async () => {
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
      const add =
        round % 2
          ? call('root', 'PUT', `/projects/${p.id}/members/${id}`, { role: 'editor' })
          : call('root', 'POST', '/invitations', {
              kind: 'email',
              email: `${name}@example.com`,
              projectId: p.id,
              role: 'editor',
            });
      const [added, deletion] = await Promise.all([
        add,
        call(name, 'DELETE', '/me', { password: PASSWORD }),
      ]);
      noLockErrors([added.statusCode, deletion.statusCode]);
      expect(deletion.statusCode).toBe(204);
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
