import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ApiError,
  Board,
  FractionalIndex,
  Id,
  Project,
  ProjectRole,
  SearchResult,
  Timestamp,
  z,
} from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  board,
  boardElementIndex,
  boardGrant,
  crewMember,
  personalToken,
  project,
  projectMember,
  shootingDay,
  user,
} from '../db/schema.ts';
import { pkceChallenge } from '../secrets.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { OFFICIAL_CLIPPER_IDS } from './account-routes.ts';
import { createApp } from './app.ts';
import { requireActor } from './auth-routes.ts';

/** `SearchHit` as the oldest released Clipper (v0.3.0) knew it, copied from that tag. */
const SearchHitV030 = z.object({
  kind: z.enum(['project', 'board', 'element']),
  projectId: Id,
  projectName: z.string(),
  boardId: Id.nullable(),
  boardTitle: z.string().nullable(),
  boardKind: z.enum(['board', 'storyboard']).nullable(),
  elementId: z.string().nullable(),
  elementType: z.string().nullable(),
  title: z.string(),
  snippet: z.string().nullable(),
  assetId: Id.nullable(),
  tags: z.array(z.string()),
  myRole: ProjectRole.optional(),
});

/** `Project` and `Board` as v0.3.0 knew them, copied from that tag. */
const ProjectV030 = z.object({
  id: Id,
  name: z.string().min(1).max(120),
  icon: z.object({
    shape: z.enum(['diamond', 'circle', 'triangle', 'square']),
    color: z.enum(['blue', 'orange', 'purple', 'green', 'neutral']),
  }),
  rootBoardId: Id,
  position: FractionalIndex,
  archivedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  myRole: ProjectRole,
});
const BoardV030 = z.object({
  id: Id,
  projectId: Id,
  parentBoardId: Id.nullable(),
  kind: z.enum(['board', 'storyboard']),
  title: z.string().min(1).max(200),
  position: FractionalIndex,
  coverAssetId: Id.nullable(),
  docSchemaVersion: z.int().min(1),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  myRole: ProjectRole,
});
const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('token scopes (decision 0137)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const log = pino({ level: 'silent' });
  const other = randomUUID();
  const mine = randomUUID();
  const theirs = randomUUID();
  const myBoard = randomUUID();
  const theirBoard = randomUUID();
  const viewed = randomUUID();
  const viewedBoard = randomUUID();
  const production = randomUUID();
  const archived = randomUUID();
  const granted = randomUUID();
  const grantedRoot = randomUUID();
  const grantedEdit = randomUUID();
  const grantedView = randomUUID();
  const grantedBelow = randomUUID();
  let me = '';
  let cookie = '';
  let app: Awaited<ReturnType<typeof createApp>>;
  const auth = createAuth(config, db);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const call = (token: string, method: string, path: string, payload?: object) =>
    app.inject({
      method: method as 'GET',
      url: `/api/v1${path}`,
      headers: bearer(token),
      ...(payload ? { payload } : {}),
    });

  /** A Clipper token the way the extension gets one: /authorize, then the code exchange. */
  async function clipperSignIn() {
    const verifier = randomBytes(32).toString('base64url');
    const redirectUri = `https://${OFFICIAL_CLIPPER_IDS[0]}.chromiumapp.org/auth`;
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/app-authorizations',
      headers: { cookie, origin: config.PUBLIC_URL },
      payload: {
        clientId: 'clipper',
        redirectUri,
        codeChallenge: pkceChallenge(verifier),
        codeChallengeMethod: 'S256',
      },
    });
    expect(allowed.statusCode).toBe(200);
    const code = new URL(allowed.json().redirectTo).searchParams.get('code');
    const exchanged = await app.inject({
      method: 'POST',
      url: '/api/v1/app-authorizations/token',
      payload: { clientId: 'clipper', redirectUri, code, codeVerifier: verifier },
    });
    expect(exchanged.statusCode).toBe(200);
    return exchanged.json() as { token: string; tokenId: string };
  }

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrations);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth,
      log,
      ...testDeps(db, log),
      boards: { addCard: async () => ({ ok: true, elementId: randomUUID() }) },
    });
    // A route nobody listed: a limited token must not reach it.
    app.get('/api/v1/test-only/new-route', async (req) => {
      await requireActor(auth, req, db);
      return { ok: true };
    });
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: 'clips@example.com', password: 'correct-horse-battery', name: 'Clips' },
    });
    cookie = String(signUp.headers['set-cookie']).split(';')[0] ?? '';
    me = signUp.json().user.id;
    await db.insert(user).values({ id: other, name: 'Other', email: 'other@example.com' });
    await db.insert(project).values([
      { id: mine, name: 'Mine', position: 'a0' },
      { id: theirs, name: 'Theirs', position: 'a1' },
      { id: viewed, name: 'Viewed', position: 'a2' },
      { id: archived, name: 'Archived', position: 'a3', archivedAt: new Date() },
      { id: granted, name: 'Granted', position: 'a4' },
    ]);
    await db.insert(projectMember).values([
      { projectId: mine, userId: me, role: 'owner' },
      { projectId: theirs, userId: other, role: 'owner' },
      { projectId: viewed, userId: other, role: 'owner' },
      { projectId: viewed, userId: me, role: 'viewer' },
      { projectId: archived, userId: me, role: 'owner' },
      { projectId: granted, userId: other, role: 'owner' },
    ]);
    await db.insert(board).values([
      { id: myBoard, projectId: mine, title: 'Refs', position: 'a0' },
      { id: theirBoard, projectId: theirs, title: 'Private', position: 'a0' },
      { id: viewedBoard, projectId: viewed, title: 'Read only', position: 'a0' },
      { id: archived, projectId: archived, title: 'Old', position: 'a0' },
      { id: grantedRoot, projectId: granted, title: 'Granted root', position: 'a0' },
      {
        id: grantedEdit,
        projectId: granted,
        parentBoardId: grantedRoot,
        title: 'Shared to edit',
        position: 'a0',
        coverAssetId: null,
      },
      {
        id: grantedView,
        projectId: granted,
        parentBoardId: grantedRoot,
        title: 'Shared to read',
        position: 'a1',
      },
      // Editable below a read-only board: the picker reaches it through the tree.
      {
        id: grantedBelow,
        projectId: granted,
        parentBoardId: grantedView,
        title: 'Editable below',
        position: 'a0',
      },
      {
        id: production,
        projectId: mine,
        parentBoardId: myBoard,
        kind: 'production',
        title: 'Shoot',
        position: 'a1',
      },
    ]);
    await db.insert(boardGrant).values([
      { boardId: grantedEdit, userId: me, role: 'editor' },
      { boardId: grantedView, userId: me, role: 'viewer' },
      { boardId: grantedBelow, userId: me, role: 'editor' },
    ]);
    // Content that matches "zebra" on an editable board, and on a read-only one.
    await db.insert(boardElementIndex).values([
      {
        boardId: myBoard,
        elementId: 'card-editable-0001',
        projectId: mine,
        type: 'note',
        title: 'Hidden card title',
        text: 'Hidden card title: a zebra crossing at dawn',
        tags: ['zebra-tag'],
      },
      {
        boardId: viewedBoard,
        elementId: 'card-readonly-0001',
        projectId: viewed,
        type: 'note',
        title: 'Read only card',
        text: 'a zebra seen by a viewer',
        tags: [],
      },
    ]);
    await db.insert(crewMember).values({
      projectId: mine,
      name: 'Zebra Crewperson',
      role: 'Zebra wrangler',
      department: 'Animals',
      phone: '',
      email: '',
      pickup: '',
      notes: '',
    });
    await db.insert(shootingDay).values({
      projectId: mine,
      boardId: production,
      date: '2027-03-04',
      callTime: '08:00',
      location: 'Zebra farm',
      notes: '',
      blocks: [],
    });
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('marks the Clipper token at issue, and nothing else', async () => {
    const { tokenId } = await clipperSignIn();
    const scopeOf = async (id: string) =>
      (await db.select().from(personalToken).where(eq(personalToken.id, id)))[0]?.scope;
    expect(await scopeOf(tokenId)).toBe('clip');
    const phone = await issueToken(db, me, { name: 'Phone', client: 'mobile' });
    expect(phone.row.scope).toBe('full');
    const script = await issueToken(db, me, { name: 'Script' });
    expect(script.row.scope).toBe('full');
  });

  it('lets a Clipper token do everything the Clipper does', async () => {
    const { token } = await clipperSignIn();
    for (const [method, path, payload, status] of [
      ['GET', '/me/clip-boards', undefined, 200],
      ['GET', '/projects?limit=200', undefined, 200],
      ['GET', `/projects/${mine}/boards`, undefined, 200],
      ['GET', '/shared-boards', undefined, 200],
      ['GET', `/boards/${myBoard}/columns`, undefined, 200],
      ['GET', '/search?q=refs&limit=20', undefined, 200],
      ['POST', '/clip', { boardId: myBoard, text: 'Quote' }, 201],
      ['DELETE', `/me/clip-boards/${myBoard}`, undefined, 204],
    ] as const) {
      const res = await call(token, method, path, payload);
      expect(res.statusCode, `${method} ${path}`).toBe(status);
    }
    // Per-project access still applies on top of the scope.
    expect((await call(token, 'GET', `/projects/${theirs}/boards`)).statusCode).not.toBe(200);
    expect(
      (await call(token, 'POST', '/clip', { boardId: theirBoard, text: 'No' })).statusCode,
    ).not.toBe(201);
  });

  it("finds a Clipper's boards by their content, and answers with board data only", async () => {
    const { token } = await clipperSignIn();
    const search = async (params: string, as: Record<string, string> = bearer(token)) => {
      const res = await app.inject({ url: `/api/v1/search?${params}`, headers: as });
      expect(res.statusCode).toBe(200);
      return res;
    };
    const res = await search('q=zebra&limit=20');
    const items = SearchResult.parse(res.json()).items;
    // The schema of the oldest and of the newest released Clipper both read it.
    expect(z.object({ items: z.array(SearchHitV030) }).parse(res.json()).items).toHaveLength(
      items.length,
    );
    expect(items.map((h) => h.boardId).sort()).toEqual([myBoard, production].sort());
    for (const hit of items)
      expect(hit).toMatchObject({
        kind: 'board',
        elementId: null,
        elementType: null,
        snippet: null,
        assetId: null,
        tags: [],
        boardKind: null,
        myRole: 'owner',
      });
    // Nothing of what matched is in the answer: text, titles, tags, ids, crew, dates, places.
    for (const word of [
      'zebra',
      'Hidden card',
      'card-editable',
      'card-readonly',
      'Crewperson',
      'wrangler',
      'Animals',
      '2027-03-04',
      'farm',
      'Read only',
    ])
      expect(res.body.toLowerCase()).not.toContain(word.toLowerCase());
    // Filters the Clipper never sends change nothing.
    for (const params of [`tag=zebra-tag`, `type=note`, `projectId=${viewed}`])
      expect((await search(`q=zebra&limit=20&${params}`)).json()).toEqual(res.json());

    // A session and a full token get today's answer: cards, snippets, tags, read-only boards.
    const full = (await issueToken(db, me, { name: 'Phone', client: 'mobile' })).token;
    const session = (await search('q=zebra&limit=20', { cookie })).json();
    expect((await search('q=zebra&limit=20', bearer(full))).json()).toEqual(session);
    const hits = SearchResult.parse(session).items;
    expect(hits.map((h) => h.boardId)).toContain(viewedBoard);
    expect(hits).toContainEqual(
      expect.objectContaining({ elementId: 'card-editable-0001', tags: ['zebra-tag'] }),
    );
    expect(hits.some((h) => h.elementType === 'crew' && h.title === 'Zebra Crewperson')).toBe(true);
  });

  it('lists for a Clipper token only what its picker offers, with the fields it reads', async () => {
    const { token } = await clipperSignIn();
    const get = async (path: string) => {
      const res = await call(token, 'GET', path);
      expect(res.statusCode, path).toBe(200);
      return res.json();
    };
    const projects = await get('/projects?limit=200');
    page(ProjectV030).parse(projects);
    page(Project).parse(projects);
    // Active projects where a card can go: not the read-only one, not the archived one.
    expect(projects.items.map((p: { id: string }) => p.id)).toEqual([mine]);
    for (const key of ['type', 'timeZone', 'shootingStart', 'shootingEnd', 'pinned', 'group'])
      expect(projects.items[0]).not.toHaveProperty(key);
    expect((await get('/projects?limit=200&archived=true')).items).toEqual([]);

    const shared = await get('/shared-boards');
    expect(page(BoardV030).parse(shared).items).toHaveLength(1);
    page(Board).parse(shared);
    expect(shared.items.map((b: { id: string }) => b.id)).toEqual([grantedEdit]);
    // A project's boards keep the tree, read-only boards included, without covers or views.
    const boards = await get(`/projects/${granted}/boards`);
    page(BoardV030).parse(boards);
    page(Board).parse(boards);
    expect(boards.items.map((b: { id: string }) => b.id).sort()).toEqual(
      [grantedEdit, grantedView, grantedBelow].sort(),
    );
    for (const b of boards.items) {
      expect(b.coverAssetId).toBeNull();
      for (const key of ['icon', 'views', 'editedAt']) expect(b).not.toHaveProperty(key);
    }

    // A full token gets today's lists.
    const full = (await issueToken(db, me, { name: 'Phone', client: 'mobile' })).token;
    const all = await call(full, 'GET', '/projects?limit=200');
    expect(
      all
        .json()
        .items.map((p: { id: string }) => p.id)
        .sort(),
    ).toEqual([mine, viewed].sort());
    expect((await call(full, 'GET', '/shared-boards')).json().items).toHaveLength(2);
  });

  it('refuses a Clipper token everywhere else with the usual 403', async () => {
    const { token, tokenId } = await clipperSignIn();
    const phone = await issueToken(db, me, { name: 'Phone', client: 'mobile' });
    for (const [method, path, payload] of [
      ['DELETE', `/projects/${mine}`, undefined],
      ['PATCH', `/projects/${mine}`, { name: 'Renamed' }],
      ['PUT', `/projects/${mine}/members/${other}`, { role: 'editor' }],
      ['GET', `/boards/${myBoard}`, undefined],
      ['GET', `/boards/${theirBoard}`, undefined],
      ['DELETE', `/boards/${myBoard}`, undefined],
      ['GET', '/me', undefined],
      ['PATCH', '/me', { name: 'Someone' }],
      ['GET', '/instance/members', undefined],
      ['GET', '/instance/version', undefined],
      ['POST', '/me/token-proof-key', undefined],
      ['POST', '/uploads', undefined],
      ['GET', '/test-only/new-route', undefined],
      // Signing out revokes its own token only.
      ['DELETE', `/me/tokens/${phone.row.id}`, undefined],
    ] as const) {
      const res = await call(token, method, path, payload);
      expect(res.statusCode, `${method} ${path}`).toBe(403);
      expect(ApiError.parse(res.json()).error.code).toBe('forbidden');
    }
    // Nothing changed.
    const [still] = await db.select().from(project).where(eq(project.id, mine));
    expect(still?.name).toBe('Mine');
    expect(
      await db.select().from(personalToken).where(eq(personalToken.id, phone.row.id)),
    ).toHaveLength(1);
    // Signing out of the Clipper still works.
    expect((await call(token, 'DELETE', `/me/tokens/${tokenId}`)).statusCode).toBe(204);
    expect((await call(token, 'GET', '/me/clip-boards')).statusCode).toBe(401);
  });

  it('records the use of a token only for a request its scope admits', async () => {
    const { token, tokenId } = await clipperSignIn();
    const lastUsed = async () =>
      (await db.select().from(personalToken).where(eq(personalToken.id, tokenId)))[0]?.lastUsedAt;
    expect((await call(token, 'GET', '/me')).statusCode).toBe(403);
    expect(await lastUsed()).toBeNull();
    expect((await call(token, 'GET', '/me/clip-boards')).statusCode).toBe(200);
    expect(await lastUsed()).toBeInstanceOf(Date);
  });

  it('leaves app tokens, personal tokens and sessions as they were', async () => {
    const phone = await issueToken(db, me, { name: 'Phone', client: 'mobile' });
    const script = await issueToken(db, me, { name: 'Script' });
    for (const token of [phone.token, script.token]) {
      expect((await call(token, 'GET', '/me')).statusCode).toBe(200);
      expect((await call(token, 'GET', `/boards/${myBoard}`)).statusCode).toBe(200);
      expect((await call(token, 'GET', '/test-only/new-route')).statusCode).toBe(200);
    }
    expect((await call(phone.token, 'POST', '/me/token-proof-key')).statusCode).toBe(200);
    const session = await app.inject({ url: '/api/v1/me', headers: { cookie } });
    expect(session.statusCode).toBe(200);
  });

  it('limits Clipper tokens issued before the scope, and only those (migration 0057)', async () => {
    const backfill = readFileSync(`${migrations}/0057_token_scope.sql`, 'utf8')
      .split('--> statement-breakpoint')
      .filter((s) => /^\s*(--.*\n\s*)*UPDATE/i.test(s));
    expect(backfill).toHaveLength(1);
    // Rows as an older server wrote them: every one `full`, as the new column's default makes them.
    const rows = await Promise.all(
      (['clipper', 'mobile', undefined] as const).map((c) =>
        issueToken(db, me, { name: `Old ${c}`, ...(c ? { client: c } : {}) }),
      ),
    );
    const ids = rows.map((r) => r.row.id);
    for (const id of ids)
      await db.update(personalToken).set({ scope: 'full' }).where(eq(personalToken.id, id));
    await db.execute(sql.raw(backfill[0] ?? ''));
    const scopes = await Promise.all(
      ids.map(
        async (id) =>
          (await db.select().from(personalToken).where(eq(personalToken.id, id)))[0]?.scope,
      ),
    );
    expect(scopes).toEqual(['clip', 'full', 'full']);
    expect((await call(rows[0]?.token ?? '', 'GET', '/me')).statusCode).toBe(403);
    expect((await call(rows[1]?.token ?? '', 'GET', '/me')).statusCode).toBe(200);
  });
});
