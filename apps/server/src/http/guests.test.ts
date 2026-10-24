import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { addElement, createBoardDoc, type Element, roots } from '@inkadra/doc-schema';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  asset,
  assetVariant,
  board,
  boardDoc,
  boardGrant,
  comment,
  elementReview,
  elementReviewEvent,
  project,
  projectMember,
  shareGuest,
  shareLink,
} from '../db/schema.ts';
import { clearExpiredGuestNames, DocViews, resolveLink } from '../share-links.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const PASSWORD = 'correct-horse-battery';

/** Element ids of the board of the link. */
const E = {
  col: 'col_______',
  img: 'img_______',
  hidcol: 'hidcol____',
  inner: 'inner_____',
  note: 'note______',
  hidnote: 'hidnote___',
  frame: 'frame_____',
  card1: 'card1_____',
  card2: 'card2_____',
  card3: 'card3_____',
  card4: 'card4_____',
  card5: 'card5_____',
  cardB: 'cardB_____',
  arrow: 'arrow_____',
  arrowHid: 'arrowhid__',
  linkCard: 'linkcard__',
  file: 'file______',
  foreign: 'foreign___',
  orphan: 'orphan____',
  sub: 'sub_______',
};

describe.skipIf(!url)('guest share links (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const deps = testDeps(db, log);
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';

  type Who = 'owner' | 'editor' | 'editor2' | 'commenter' | 'viewer' | 'outsider';
  const as = {} as Record<Who, { cookie: string; id: string }>;
  let P = '';
  let Q = '';
  /** Boards: R root, A the board of the links, A1…A5 under A, B beside A, QR in project Q. */
  const B = {} as Record<'R' | 'A' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B' | 'QR', string>;
  const X = {} as Record<'x1' | 'x2' | 'x3' | 'x4' | 'x5' | 'x6' | 'cover' | 'xq', string>;

  let ip = 0;
  const nextIp = () => `10.9.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;

  async function call(
    who: Who | { cookie?: string } | null,
    method: string,
    path: string,
    payload?: unknown,
    extra: Record<string, string | undefined> = {},
  ) {
    const headers: Record<string, string> = {
      origin: config.PUBLIC_URL,
      'x-forwarded-for': nextIp(),
    };
    const cookie = who === null ? undefined : typeof who === 'string' ? as[who].cookie : who.cookie;
    if (cookie) headers.cookie = cookie;
    if (payload !== undefined) headers['content-type'] = 'application/json';
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete headers[k];
      else headers[k] = v;
    }
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await res.text();
    let body: ReturnType<typeof JSON.parse> = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return {
      status: res.status,
      headers: res.headers,
      cookies: res.headers.getSetCookie(),
      body,
      text,
    };
  }

  const cookieOf = (cookies: string[], name: string) =>
    cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? '';

  interface Link {
    id: string;
    token: string;
  }

  async function createLink(who: Who, boardId: string, input: Record<string, unknown> = {}) {
    const res = await call(who, 'POST', `/api/v1/boards/${boardId}/share-links`, input);
    expect(res.status).toBe(201);
    return { id: res.body.id as string, token: (res.body.url as string).split('/s/')[1] as string };
  }

  async function open(
    link: Link,
    opts: { name?: string; password?: string; cookie?: string; ip?: string; token?: string } = {},
  ) {
    const res = await call(
      { cookie: opts.cookie },
      'POST',
      `/api/v1/guest/links/${link.id}/session`,
      { token: opts.token ?? link.token, name: opts.name, password: opts.password },
      opts.ip ? { 'x-forwarded-for': opts.ip } : {},
    );
    return { ...res, cookie: cookieOf(res.cookies, 'inkadra.guest') };
  }

  const g = (link: Link, path = '') => `/api/v1/guest/links/${link.id}${path}`;

  async function insertBoard(projectId: string, title: string, parent: string | null) {
    const [row] = await db
      .insert(board)
      .values({ projectId, title, position: 'a0', parentBoardId: parent })
      .returning();
    return row?.id as string;
  }

  async function saveDoc(boardId: string, elements: Element[], edit?: (doc: Y.Doc) => void) {
    const doc = createBoardDoc(boardId);
    for (const el of elements) addElement(doc, el);
    edit?.(doc);
    const state = Y.encodeStateAsUpdate(doc);
    await db
      .insert(boardDoc)
      .values({ boardId, state, schemaVersion: 3, size: state.byteLength })
      .onConflictDoUpdate({
        target: boardDoc.boardId,
        set: { state, size: state.byteLength, updatedAt: new Date() },
      });
  }

  async function makeAsset(projectId: string, filename: string, kind: 'image' | 'file' = 'image') {
    const [row] = await db
      .insert(asset)
      .values({
        projectId,
        kind,
        mime: kind === 'image' ? 'image/jpeg' : 'application/pdf',
        filename,
        size: 10,
        storageKey: `originals/${filename}`,
        status: 'ready',
        width: kind === 'image' ? 100 : null,
        height: kind === 'image' ? 80 : null,
        exif: { Make: 'Secret camera' },
      })
      .returning();
    const id = row?.id as string;
    await deps.storage.write(`originals/${filename}`, Buffer.from('0123456789'), 'image/jpeg');
    if (kind === 'image')
      for (const size of ['256', '512'] as const) {
        const key = `variants/${id}/${size}.webp`;
        await deps.storage.write(key, Buffer.from(`webp-${size}`), 'image/webp');
        await db
          .insert(assetVariant)
          .values({ assetId: id, size, width: Number(size), height: 80, storageKey: key });
      }
    return id;
  }

  const el = { w: 100, z: 'a0', createdBy: 'someone', createdAt: 1, x: 0, y: 0 };

  function boardOfLinkElements(): Element[] {
    return [
      { ...el, id: E.col, type: 'column', title: 'Selezione', parent: null },
      { ...el, id: E.img, type: 'image', assetId: X.x1, parent: E.col, tags: ['interno'] },
      { ...el, id: E.hidcol, type: 'column', title: 'Scarti', parent: null, guestHidden: true },
      { ...el, id: E.inner, type: 'image', assetId: X.x2, parent: E.hidcol },
      { ...el, id: E.note, type: 'note', parent: null, color: 'yellow' },
      { ...el, id: E.hidnote, type: 'note', parent: null, guestHidden: true },
      {
        ...el,
        id: E.frame,
        type: 'frame',
        parent: null,
        assetId: X.x3,
        status: 'retake',
        notes: 'Solo per la regia',
      },
      { ...el, id: E.card1, type: 'board', boardId: B.A1, parent: null },
      { ...el, id: E.card2, type: 'board', boardId: B.A2, parent: null, guestHidden: true },
      { ...el, id: E.card4, type: 'board', boardId: B.A4, parent: null },
      { ...el, id: E.card5, type: 'board', boardId: B.A5, parent: null },
      { ...el, id: E.cardB, type: 'board', boardId: B.B, parent: null },
      {
        ...el,
        id: E.arrow,
        type: 'arrow',
        parent: null,
        from: { elementId: E.img, x: 0, y: 0 },
        to: { elementId: E.note, x: 0, y: 0 },
      },
      {
        ...el,
        id: E.arrowHid,
        type: 'arrow',
        parent: null,
        from: { elementId: E.img, x: 0, y: 0 },
        to: { elementId: E.inner, x: 0, y: 0 },
      },
      {
        ...el,
        id: E.linkCard,
        type: 'link',
        parent: null,
        url: 'https://example.com/',
        imageAssetId: X.x4,
      },
      { ...el, id: E.file, type: 'file', parent: null, assetId: X.x5 },
      { ...el, id: E.foreign, type: 'image', parent: null, assetId: X.xq },
      { ...el, id: E.orphan, type: 'image', parent: 'gone______', assetId: X.x2 },
    ];
  }

  function noteText(doc: Y.Doc) {
    const body = roots(doc).elements.get(E.note)?.get('body') as Y.XmlFragment;
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('Ciao cliente')]);
    body.insert(0, [p]);
  }

  // Links and guests shared by the tests below.
  let linkC: Link; // guest_comment, the main one
  let linkV: Link; // guest_view
  let linkA: Link; // guest_approve with proofing
  let carla = ''; // cookie of a guest of linkC
  let anna = ''; // cookie of a guest of linkA
  let bruno = ''; // cookie of another guest of linkA
  let annaId = '';

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting, verification cascade`);
    const auth = createAuth(config, db, {});
    app = await createApp({ config, db, auth, log, ...deps });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    for (const who of ['owner', 'editor', 'editor2', 'commenter', 'viewer', 'outsider'] as const) {
      const res = await call(null, 'POST', '/api/auth/sign-up/email', {
        email: `${who}@example.com`,
        password: PASSWORD,
        name: who[0]?.toUpperCase() + who.slice(1),
      });
      expect(res.status).toBe(200);
      as[who] = { cookie: cookieOf(res.cookies, 'inkadra.session_token'), id: res.body.user.id };
    }
    [{ id: P }, { id: Q }] = (await db
      .insert(project)
      .values([
        { name: 'Spot', position: 'a0' },
        { name: 'Altro', position: 'a1' },
      ])
      .returning({ id: project.id })) as [{ id: string }, { id: string }];
    await db.insert(projectMember).values([
      { projectId: P, userId: as.owner.id, role: 'owner' },
      { projectId: P, userId: as.editor.id, role: 'editor' },
      { projectId: P, userId: as.editor2.id, role: 'editor' },
      { projectId: P, userId: as.commenter.id, role: 'commenter' },
      { projectId: P, userId: as.viewer.id, role: 'viewer' },
      { projectId: Q, userId: as.outsider.id, role: 'owner' },
    ]);
    B.R = await insertBoard(P, 'Spot', null);
    B.A = await insertBoard(P, 'Moodboard', B.R);
    for (const n of ['A1', 'A2', 'A3', 'A4', 'A5'] as const) B[n] = await insertBoard(P, n, B.A);
    B.B = await insertBoard(P, 'Fuori', B.R);
    B.QR = await insertBoard(Q, 'Altro', null);
    await db.update(board).set({ deletedAt: new Date() }).where(eq(board.id, B.A5));
    // The creator of the links (editor) is only a viewer of A4.
    await db
      .insert(boardGrant)
      .values({ boardId: B.A4, userId: as.editor.id, role: 'viewer', grantedBy: as.owner.id });
    X.x1 = await makeAsset(P, 'x1.jpg');
    X.x2 = await makeAsset(P, 'x2.jpg');
    X.x3 = await makeAsset(P, 'x3.jpg');
    X.x4 = await makeAsset(P, 'x4.jpg');
    X.x5 = await makeAsset(P, 'contratto.pdf', 'file');
    X.x6 = await makeAsset(P, 'x6.jpg');
    X.cover = await makeAsset(P, 'cover.jpg');
    X.xq = await makeAsset(Q, 'altrui.jpg');
    await db.update(board).set({ coverAssetId: X.cover }).where(eq(board.id, B.A1));
    await saveDoc(B.A, boardOfLinkElements(), noteText);
    await saveDoc(B.A1, [
      { ...el, id: E.sub, type: 'image', assetId: X.x6, parent: null },
      { ...el, id: E.card3, type: 'board', boardId: B.A3, parent: null, guestHidden: true },
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  // Team endpoints -----------------------------------------------------------------

  it('lets editors create share links, and nobody else', async () => {
    const res = await call('editor', 'POST', `/api/v1/boards/${B.A}/share-links`, {
      role: 'guest_comment',
      label: 'Cliente',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      projectId: P,
      boardId: B.A,
      boardTitle: 'Moodboard',
      role: 'guest_comment',
      label: 'Cliente',
      includeSubBoards: true,
      hasPassword: false,
      allowDownload: false,
      proofing: false,
      status: 'active',
      createdBy: { id: as.editor.id, name: 'Editor' },
      guestCount: 0,
      viewCount: 0,
      expiresAt: null,
    });
    expect(res.body.url).toMatch(/^http:\/\/localhost:3000\/s\/[A-Za-z0-9_-]{43}$/);
    linkC = { id: res.body.id, token: res.body.url.split('/s/')[1] };
    // The token is kept as a hash and sealed, never in clear.
    const [row] = await db.select().from(shareLink).where(eq(shareLink.id, linkC.id));
    expect(row?.tokenSealed).not.toContain(linkC.token);
    expect(row?.tokenHash).not.toBe(linkC.token);

    for (const who of ['commenter', 'viewer'] as const)
      expect((await call(who, 'POST', `/api/v1/boards/${B.A}/share-links`, {})).status).toBe(403);
    expect((await call('outsider', 'POST', `/api/v1/boards/${B.A}/share-links`, {})).status).toBe(
      404,
    );
    expect((await call(null, 'POST', `/api/v1/boards/${B.A}/share-links`, {})).status).toBe(401);
    // A board of another project.
    expect((await call('editor', 'POST', `/api/v1/boards/${B.QR}/share-links`, {})).status).toBe(
      404,
    );
    const short = await call('editor', 'POST', `/api/v1/boards/${B.A}/share-links`, {
      password: 'abc',
    });
    expect(short.status).toBe(400);
    expect(
      (await call('editor', 'POST', `/api/v1/boards/${B.A}/share-links`, { role: 'owner' })).status,
    ).toBe(400);

    linkV = await createLink('editor', B.A, { role: 'guest_view' });
    linkA = await createLink('editor', B.A, { role: 'guest_approve', proofing: true });
  });

  it('stores link passwords with the account password hasher', async () => {
    const res = await call('owner', 'POST', `/api/v1/boards/${B.A}/share-links`, {
      password: 'segreto-1',
    });
    expect(res.body.hasPassword).toBe(true);
    const [row] = await db.select().from(shareLink).where(eq(shareLink.id, res.body.id));
    // Better Auth's scrypt format: salt:key in hex.
    expect(row?.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    await call('owner', 'DELETE', `/api/v1/share-links/${res.body.id}`);
  });

  it('lists the links of a board for its editors, with the token to copy again', async () => {
    const res = await call('owner', 'GET', `/api/v1/boards/${B.A}/share-links`);
    expect(res.status).toBe(200);
    const mine = res.body.items.find((l: { id: string }) => l.id === linkC.id);
    expect(mine.url).toBe(`http://localhost:3000/s/${linkC.token}`);
    for (const who of ['commenter', 'viewer'] as const)
      expect((await call(who, 'GET', `/api/v1/boards/${B.A}/share-links`)).status).toBe(403);
    expect((await call('outsider', 'GET', `/api/v1/boards/${B.A}/share-links`)).status).toBe(404);
    expect((await call('editor', 'GET', `/api/v1/boards/${B.QR}/share-links`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/v1/boards/${B.A}/share-links`)).status).toBe(401);
  });

  it('changes and revokes links only for the editors of their board', async () => {
    const link = await createLink('editor', B.A, { label: 'Prova' });
    const path = `/api/v1/share-links/${link.id}`;
    const changed = await call('owner', 'PATCH', path, {
      role: 'guest_approve',
      label: null,
      allowDownload: true,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ role: 'guest_approve', label: null, allowDownload: true });
    for (const who of ['commenter', 'viewer'] as const)
      expect((await call(who, 'PATCH', path, { label: 'x' })).status).toBe(403);
    expect((await call('outsider', 'PATCH', path, { label: 'x' })).status).toBe(404);
    expect((await call('outsider', 'DELETE', path)).status).toBe(404);
    expect((await call('viewer', 'DELETE', path)).status).toBe(403);
    expect((await call('outsider', 'GET', `${path}/picks`)).status).toBe(404);
    expect((await call('commenter', 'GET', `${path}/picks`)).status).toBe(403);
    // A link of another project, through an editor of this one.
    const theirs = await createLink('outsider', B.QR);
    expect((await call('editor', 'PATCH', `/api/v1/share-links/${theirs.id}`, {})).status).toBe(
      404,
    );
    expect((await call('editor', 'GET', `/api/v1/share-links/${theirs.id}/picks`)).status).toBe(
      404,
    );

    expect((await call('editor', 'DELETE', path)).status).toBe(204);
    const list = await call('editor', 'GET', `/api/v1/boards/${B.A}/share-links`);
    const revoked = list.body.items.find((l: { id: string }) => l.id === link.id);
    expect(revoked).toMatchObject({ status: 'revoked', url: null });
    expect(revoked.revokedAt).not.toBeNull();
    expect((await call('editor', 'PATCH', path, { label: 'x' })).status).toBe(409);
    const preview = await call(null, 'GET', `/api/v1/guest/by-token/${link.token}`);
    expect(preview.status).toBe(403);
    expect(preview.body.error.details).toEqual({ reason: 'revoked' });
  });

  it('reserves scope changes for the creator or an owner but lets co-editors revoke', async () => {
    const link = await createLink('editor', B.A);
    const path = `/api/v1/share-links/${link.id}`;
    for (const input of [
      { includeSubBoards: true },
      { allowDownload: true },
      { role: 'guest_approve' },
      { password: null },
      { password: 'new-password' },
      { expiresAt: null },
      { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      { proofing: true },
    ])
      expect((await call('editor2', 'PATCH', path, input)).status).toBe(403);
    expect((await call('editor2', 'PATCH', path, { label: 'Client' })).status).toBe(200);
    expect((await call('editor', 'PATCH', path, { includeSubBoards: true })).status).toBe(200);
    expect((await call('owner', 'PATCH', path, { allowDownload: true })).status).toBe(200);
    expect((await call('editor2', 'DELETE', path)).status).toBe(204);
  });

  it('applies the same 365-day maximum to expiry updates and creation', async () => {
    const link = await createLink('editor', B.A);
    expect(
      (
        await call('editor', 'PATCH', `/api/v1/share-links/${link.id}`, {
          expiresAt: new Date(Date.now() + 366 * 86_400_000).toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('editor', 'POST', `/api/v1/boards/${B.A}/share-links`, {
          expiresInDays: 366,
        })
      ).status,
    ).toBe(400);
  });

  it('limits each person to 50 new links an hour', async () => {
    await db.insert(shareLink).values(
      Array.from({ length: 49 }, (_, i) => ({
        projectId: P,
        boardId: B.A3,
        role: 'guest_view' as const,
        tokenHash: `bulk-${i}`,
        tokenSealed: 'x',
        createdBy: as.editor2.id,
      })),
    );
    const raced = await Promise.all(
      Array.from({ length: 2 }, () =>
        call('editor2', 'POST', `/api/v1/boards/${B.A3}/share-links`, {}),
      ),
    );
    expect(raced.map((r) => r.status).sort()).toEqual([201, 429]);
    const res = await call('editor2', 'POST', `/api/v1/boards/${B.A3}/share-links`, {});
    expect(res.status).toBe(429);
    await db.delete(shareLink).where(eq(shareLink.boardId, B.A3));
  });

  it('checks origins on account cookie writes while allowing bearer clients', async () => {
    for (const extra of [
      { origin: 'http://evil.localhost:3000' },
      { origin: 'null' },
      { origin: undefined },
      { origin: undefined, 'sec-fetch-site': 'same-site' },
    ]) {
      expect((await call('owner', 'PATCH', '/api/v1/me', {}, extra)).status).toBe(403);
      expect(
        (await call('owner', 'POST', '/api/v1/me/tokens', { name: 'blocked' }, extra)).status,
      ).toBe(403);
    }
    expect(
      (
        await call(
          'owner',
          'PATCH',
          '/api/v1/me',
          {},
          {
            origin: undefined,
            'sec-fetch-site': 'same-origin',
          },
        )
      ).status,
    ).toBe(200);
    const { token } = await issueToken(db, as.owner.id, { name: 'CSRF bearer test' });
    expect(
      (
        await call(
          null,
          'PATCH',
          '/api/v1/me',
          {},
          {
            origin: undefined,
            authorization: `Bearer ${token}`,
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (await call(null, 'POST', '/api/v1/guest/unknown', {}, { origin: undefined })).status,
    ).toBe(403);
  });

  // Opening a link ------------------------------------------------------------------

  it('previews a link, revealing nothing for a password-protected one', async () => {
    const res = await call(null, 'GET', `/api/v1/guest/by-token/${linkC.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      linkId: linkC.id,
      instanceName: config.INSTANCE_NAME,
      needsPassword: false,
      boardTitle: 'Moodboard',
      sharedBy: 'Editor',
      role: 'guest_comment',
      expiresAt: null,
    });
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    const locked = await createLink('editor', B.A, { password: 'segreto-1', expiresInDays: 3 });
    const preview = await call(null, 'GET', `/api/v1/guest/by-token/${locked.token}`);
    expect(preview.body).toEqual({
      linkId: locked.id,
      instanceName: config.INSTANCE_NAME,
      needsPassword: true,
      boardTitle: null,
      sharedBy: null,
      role: null,
      expiresAt: null,
    });
    expect((await call(null, 'GET', `/api/v1/guest/by-token/${'x'.repeat(43)}`)).status).toBe(404);
    await db
      .update(shareLink)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shareLink.id, locked.id));
    const expired = await call(null, 'GET', `/api/v1/guest/by-token/${locked.token}`);
    expect(expired.status).toBe(403);
    expect(expired.body.error.details).toEqual({ reason: 'expired' });
    const opened = await open(locked, { password: 'segreto-1' });
    expect(opened.status).toBe(403);
    expect(opened.body.error.details).toEqual({ reason: 'expired' });
  });

  it('opens a session with a cookie scoped to the link', async () => {
    const res = await open(linkC);
    expect(res.status).toBe(200);
    const cookie = res.cookies.find((c) => c.startsWith('inkadra.guest='));
    expect(cookie).toContain(`Path=/api/v1/guest/links/${linkC.id}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toMatch(/Max-Age=259\d{4}/);
    expect(cookie).not.toContain('Secure');
    expect(res.body).toMatchObject({
      linkId: linkC.id,
      guest: { name: null },
      role: 'guest_comment',
      boardId: B.A,
      allowDownload: false,
      proofing: false,
      linkExpiresAt: null,
    });
    // A visible board card leads to A1; A2 is behind a hidden card, A3 behind a hidden card
    // on A1, A4 is not editable by the creator, A5 is in the trash, B is not below A.
    expect(res.body.boards).toEqual([
      { id: B.A, parentBoardId: null, kind: 'board', title: 'Moodboard', coverUrl: null },
      {
        id: B.A1,
        parentBoardId: B.A,
        kind: 'board',
        title: 'A1',
        coverUrl: `/api/v1/guest/links/${linkC.id}/assets/${X.cover}/variants/512`,
      },
    ]);
    carla = res.cookie;
    expect((await call({ cookie: carla }, 'GET', g(linkC, '/session'))).status).toBe(200);
    // The token of another link opens nothing here.
    expect((await open(linkC, { token: linkV.token })).status).toBe(404);
    expect((await call(null, 'GET', g(linkC, '/session'))).body.error.details).toEqual({
      reason: 'no_session',
    });
    // The cookie of one link is no session on another.
    expect((await call({ cookie: carla }, 'GET', g(linkV, '/session'))).status).toBe(401);

    const a = await open(linkA, { name: 'Anna' });
    anna = a.cookie;
    annaId = a.body.guest.id;
    bruno = (await open(linkA, { name: 'Bruno' })).cookie;
  });

  it('reuses the guest of an earlier visit and replaces the cookie token', async () => {
    const first = await open(linkV, { name: 'Vera' });
    const again = await open(linkV, { cookie: first.cookie });
    expect(again.body.guest).toEqual(first.body.guest);
    expect(again.cookie).not.toBe(first.cookie);
    expect((await call({ cookie: first.cookie }, 'GET', g(linkV, '/session'))).status).toBe(401);
    // Even after the session expired.
    await db
      .update(shareGuest)
      .set({ sessionExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(shareGuest.id, first.body.guest.id));
    const expired = await call({ cookie: again.cookie }, 'GET', g(linkV, '/session'));
    expect(expired.status).toBe(401);
    expect(expired.body.error.details).toEqual({ reason: 'no_session' });
    const back = await open(linkV, { cookie: again.cookie });
    expect(back.body.guest.id).toBe(first.body.guest.id);
    const [row] = await db.select().from(shareLink).where(eq(shareLink.id, linkV.id));
    expect(row?.viewCount).toBe(3);
    expect(row?.lastUsedAt).not.toBeNull();
    const list = await call('editor', 'GET', `/api/v1/boards/${B.A}/share-links`);
    expect(list.body.items.find((l: { id: string }) => l.id === linkV.id)).toMatchObject({
      guestCount: 1,
      viewCount: 3,
    });
  });

  it('slides the session at most once an hour, never beyond the link expiry', async () => {
    const link = await createLink('editor', B.A, { expiresInDays: 2 });
    const opened = await open(link);
    const until = new Date(opened.body.sessionExpiresAt).getTime();
    expect(until).toBeLessThanOrEqual(Date.now() + 2 * 86_400_000 + 1000);
    expect(until).toBeGreaterThan(Date.now() + 86_400_000);
    const quiet = await call({ cookie: opened.cookie }, 'GET', g(link, '/session'));
    expect(quiet.cookies).toEqual([]);

    const fresh = await createLink('editor', B.A);
    const o = await open(fresh);
    await db
      .update(shareGuest)
      .set({
        lastSeenAt: new Date(Date.now() - 2 * 3600_000),
        sessionExpiresAt: new Date(Date.now() + 86_400_000),
      })
      .where(eq(shareGuest.id, o.body.guest.id));
    const slid = await call({ cookie: o.cookie }, 'GET', g(fresh, '/session'));
    expect(new Date(slid.body.sessionExpiresAt).getTime()).toBeGreaterThan(
      Date.now() + 29 * 86_400_000,
    );
    expect(slid.cookies[0]).toMatch(/Max-Age=259\d{4}/);
    // Shortening the link caps the server session immediately, within the hour.
    const shortened = new Date(Date.now() + 3600_000).toISOString();
    await call('editor', 'PATCH', `/api/v1/share-links/${fresh.id}`, { expiresAt: shortened });
    const capped = await call({ cookie: o.cookie }, 'GET', g(fresh, '/session'));
    expect(capped.body.sessionExpiresAt).toBe(shortened);
    expect(capped.cookies).toEqual([]);
    const [stored] = await db.select().from(shareGuest).where(eq(shareGuest.id, o.body.guest.id));
    expect(stored?.sessionExpiresAt.toISOString()).toBe(shortened);
    expect((await call({ cookie: o.cookie }, 'GET', g(fresh, '/session'))).cookies).toEqual([]);
  });

  it('extends capped active sessions immediately while preserving the guest cookie', async () => {
    const link = await createLink('editor', B.A, { expiresInDays: 1 });
    const opened = await open(link, { name: 'Returning' });
    expect(opened.cookies[0]).toMatch(/Max-Age=2592000/);
    const extended = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(
      (await call('editor', 'PATCH', `/api/v1/share-links/${link.id}`, { expiresAt: extended }))
        .status,
    ).toBe(200);
    const [stored] = await db
      .select()
      .from(shareGuest)
      .where(eq(shareGuest.id, opened.body.guest.id));
    expect(stored?.sessionExpiresAt.toISOString()).toBe(extended);
    const resumed = await call({ cookie: opened.cookie }, 'GET', g(link, '/session'));
    expect(resumed.status).toBe(200);
    expect(resumed.body.guest.id).toBe(opened.body.guest.id);
    expect(resumed.body.sessionExpiresAt).toBe(extended);
    // Removing the cap restores the remainder of the idle timeout; no new guest is created.
    await call('editor', 'PATCH', `/api/v1/share-links/${link.id}`, { expiresAt: null });
    const uncapped = await call({ cookie: opened.cookie }, 'GET', g(link, '/session'));
    expect(new Date(uncapped.body.sessionExpiresAt).getTime()).toBeGreaterThan(
      Date.now() + 29 * 86_400_000,
    );
    // An inactive session must never be revived by extending a link.
    await db
      .update(shareGuest)
      .set({ sessionExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(shareGuest.id, opened.body.guest.id));
    await call('editor', 'PATCH', `/api/v1/share-links/${link.id}`, { expiresAt: extended });
    expect((await call({ cookie: opened.cookie }, 'GET', g(link, '/session'))).status).toBe(401);
  });

  it('treats malformed cookies as absent and does not reveal whether a link id exists', async () => {
    for (const link of [linkC, { id: '00000000-0000-4000-8000-000000000001', token: '' }]) {
      const absent = await call(null, 'GET', g(link, '/session'));
      const malformed = await call({ cookie: 'inkadra.guest=%E0' }, 'GET', g(link, '/session'));
      expect(absent.status).toBe(401);
      expect(malformed.status).toBe(401);
      expect(malformed.body).toEqual(absent.body);
    }
  });

  it('shares password budgets across IPv6 /64s and independently across all addresses', async () => {
    const link = await createLink('editor', B.A, { password: 'secret-password' });
    for (let i = 0; i < 10; i++)
      expect(
        (await open(link, { password: 'wrong-password', ip: `2001:db8:1:1::${i + 1}` })).status,
      ).toBe(403);
    expect(
      (await open(link, { password: 'secret-password', ip: '2001:db8:1:1::ffff' })).status,
    ).toBe(429);
    // A different /64 still has a budget until the independent link-wide cap is reached.
    expect((await open(link, { password: 'secret-password', ip: '2001:db8:1:2::1' })).status).toBe(
      200,
    );
    for (let batch = 0; batch < 18; batch++) {
      const attempts = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          open(link, {
            password: 'wrong-password',
            ip: `10.80.${batch}.${i + 1}`,
          }),
        ),
      );
      expect(attempts.every((r) => r.status === 403)).toBe(true);
    }
    expect((await open(link, { password: 'secret-password', ip: '10.81.0.1' })).status).toBe(429);
  }, 60_000);

  it('asks for the password, limits wrong ones and ends sessions when it changes', async () => {
    const link = await createLink('editor', B.A, { password: 'segreto-1' });
    const where = '10.20.0.1';
    const missing = await open(link, { ip: where });
    expect(missing.status).toBe(403);
    expect(missing.body.error.details).toEqual({ reason: 'password_required' });
    const wrong = await open(link, { password: 'sbagliata', ip: where });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.details).toEqual({ reason: 'wrong_password' });
    const ok = await open(link, { password: 'segreto-1', name: 'Ugo' });
    expect(ok.status).toBe(200);
    const simultaneous = await Promise.all(
      Array.from({ length: 12 }, () => open(link, { password: 'sbagliata', ip: where })),
    );
    expect(simultaneous.filter((r) => r.status === 403)).toHaveLength(9);
    expect(simultaneous.filter((r) => r.status === 429)).toHaveLength(3);
    // Blocked for this address, even with the right password; others still get in.
    expect((await open(link, { password: 'segreto-1', ip: where })).status).toBe(429);
    expect((await open(link, { password: 'segreto-1', ip: '10.20.0.2' })).status).toBe(200);

    expect(
      (await call('editor', 'PATCH', `/api/v1/share-links/${link.id}`, { password: 'nuova-pw' }))
        .status,
    ).toBe(200);
    const stale = await call({ cookie: ok.cookie }, 'GET', g(link, '/session'));
    expect(stale.status).toBe(403);
    expect(stale.body.error.details).toEqual({ reason: 'password_required' });
    const again = await open(link, { cookie: ok.cookie, password: 'nuova-pw' });
    expect(again.body.guest).toEqual(ok.body.guest);
    // Removing the password keeps the sessions.
    await call('editor', 'PATCH', `/api/v1/share-links/${link.id}`, { password: null });
    expect((await call({ cookie: again.cookie }, 'GET', g(link, '/session'))).status).toBe(200);
  });

  it('limits new guests per link and address', async () => {
    const link = await createLink('editor', B.A);
    for (let i = 0; i < 10; i++) expect((await open(link, { ip: '10.30.0.1' })).status).toBe(200);
    expect((await open(link, { ip: '10.30.0.1' })).status).toBe(429);
    expect((await open(link, { ip: '10.30.0.2' })).status).toBe(200);
  });

  it('enforces the daily guest cap under concurrent session opens', async () => {
    const link = await createLink('owner', B.A2);
    await db
      .insert(shareGuest)
      .values(
        Array.from({ length: 499 }, () => ({ shareLinkId: link.id, sessionExpiresAt: new Date() })),
      );
    const results = await Promise.all([open(link), open(link)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    const returning = results.find((r) => r.status === 200)!;
    expect((await open(link, { cookie: returning.cookie })).status).toBe(200);
    expect(
      (await db.select().from(shareGuest).where(eq(shareGuest.shareLinkId, link.id))).length,
    ).toBe(500);
    await call('owner', 'DELETE', `/api/v1/share-links/${link.id}`);
  });

  it('clears names after 90 days of expiry or revocation, retaining guest rows', async () => {
    const old = new Date(Date.now() - 91 * 86_400_000);
    const recent = new Date(Date.now() - 89 * 86_400_000);
    const expired = await createLink('owner', B.A2);
    const revoked = await createLink('owner', B.A2);
    const fresh = await createLink('owner', B.A2);
    const active = await createLink('owner', B.A2);
    for (const link of [expired, revoked, fresh, active]) await open(link, { name: 'Client' });
    await db.update(shareLink).set({ expiresAt: old }).where(eq(shareLink.id, expired.id));
    await db.update(shareLink).set({ revokedAt: old }).where(eq(shareLink.id, revoked.id));
    await db.update(shareLink).set({ expiresAt: recent }).where(eq(shareLink.id, fresh.id));
    await clearExpiredGuestNames(db);
    for (const [link, name] of [
      [expired, null],
      [revoked, null],
      [fresh, 'Client'],
      [active, 'Client'],
    ] as const) {
      const [guest] = await db.select().from(shareGuest).where(eq(shareGuest.shareLinkId, link.id));
      expect(guest).toBeDefined();
      expect(guest!.name).toBe(name);
    }
  });

  it('refuses cross-site guest writes, opening and leaving a session included', async () => {
    const evil = await call(
      null,
      'POST',
      g(linkC, '/session'),
      { token: linkC.token, name: 'Mallory' },
      { origin: 'https://evil.example.com' },
    );
    expect(evil.status).toBe(403);
    expect(evil.cookies).toEqual([]);
    const bare = await call(
      null,
      'POST',
      g(linkC, '/session'),
      { token: linkC.token },
      { origin: undefined },
    );
    expect(bare.status).toBe(403);
    const sameSite = await call(
      null,
      'POST',
      g(linkC, '/session'),
      { token: linkC.token },
      { origin: undefined, 'sec-fetch-site': 'same-site' },
    );
    expect(sameSite.status).toBe(403);
    const sameOrigin = await call(
      null,
      'POST',
      g(linkC, '/session'),
      { token: linkC.token },
      { origin: undefined, 'sec-fetch-site': 'same-origin' },
    );
    expect(sameOrigin.status).toBe(200);
    for (const [method, path, body] of [
      ['DELETE', '/session', undefined],
      ['PATCH', '/session', { name: 'X' }],
      ['POST', `/boards/${B.A}/comments`, { body: 'x' }],
      ['PUT', `/boards/${B.A}/elements/${E.img}/review`, { status: 'approved' }],
      ['PUT', `/boards/${B.A}/elements/${E.img}/pick`, { pick: 'picked' }],
    ] as const) {
      const res = await call({ cookie: carla }, method, g(linkC, path), body, {
        origin: 'https://sub.localhost:3000',
      });
      expect(res.status).toBe(403);
    }
    // Reads are not affected.
    expect(
      (await call({ cookie: carla }, 'GET', g(linkC, '/session'), undefined, { origin: undefined }))
        .status,
    ).toBe(200);
  });

  it('leaves: clears the token and the cookie', async () => {
    const o = await open(linkV);
    const res = await call({ cookie: o.cookie }, 'DELETE', g(linkV, '/session'));
    expect(res.status).toBe(204);
    expect(res.cookies[0]).toMatch(/^inkadra\.guest=; Path=\/api\/v1\/guest\/links\/.+Max-Age=0/);
    expect((await call({ cookie: o.cookie }, 'GET', g(linkV, '/session'))).status).toBe(401);
    const [row] = await db.select().from(shareGuest).where(eq(shareGuest.id, o.body.guest.id));
    expect(row?.tokenHash).toBeNull();
  });

  // The snapshot ----------------------------------------------------------------------

  it('renders a filtered snapshot of the board from the stored document', async () => {
    const res = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    const ids = res.body.elements.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(
      [E.col, E.img, E.note, E.frame, E.card1, E.arrow, E.linkCard, E.file, E.foreign].sort(),
    );
    const byId = new Map(res.body.elements.map((e: { id: string }) => [e.id, e]));
    expect(byId.get(E.img)).toEqual({
      id: E.img,
      type: 'image',
      assetId: X.x1,
      x: 0,
      y: 0,
      w: 100,
      z: 'a0',
      parent: E.col,
      createdAt: 1,
      createdBy: null,
    });
    const frame = byId.get(E.frame) as Record<string, unknown>;
    expect(frame.status).toBeUndefined();
    expect(frame.notes).toBeUndefined();
    expect((byId.get(E.note) as { body: unknown }).body).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ciao cliente' }] }],
    });
    // Only the files of visible elements, of this project, as guest URLs, without details.
    const assets = res.body.assets.map((a: { id: string }) => a.id).sort();
    expect(assets).toEqual([X.x1, X.x3, X.x4, X.x5].sort());
    const x1 = res.body.assets.find((a: { id: string }) => a.id === X.x1);
    expect(x1).toEqual({
      id: X.x1,
      kind: 'image',
      mime: 'image/jpeg',
      filename: null,
      size: null,
      width: 100,
      height: 80,
      durationMs: null,
      variants: [
        {
          size: '256',
          width: 256,
          height: 80,
          url: `/api/v1/guest/links/${linkC.id}/assets/${X.x1}/variants/256`,
        },
        {
          size: '512',
          width: 512,
          height: 80,
          url: `/api/v1/guest/links/${linkC.id}/assets/${X.x1}/variants/512`,
        },
      ],
      downloadUrl: null,
    });
    expect(res.body.board).toMatchObject({ id: B.A, parentBoardId: null, aspect: null });
    expect(res.body.breadcrumb).toEqual([]);
    expect(res.body.version).toBe(res.headers.get('etag')?.replaceAll('"', ''));
    expect(JSON.stringify(res.body)).not.toContain('interno');
    expect(JSON.stringify(res.body)).not.toContain('Secret camera');

    const sub = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A1}`));
    expect(sub.status).toBe(200);
    expect(sub.body.breadcrumb).toEqual([{ id: B.A, title: 'Moodboard' }]);
    expect(sub.body.elements.map((e: { id: string }) => e.id)).toEqual([E.sub]);
    for (const other of [B.A2, B.A3, B.A4, B.A5, B.B, B.R, B.QR])
      expect((await call({ cookie: carla }, 'GET', g(linkC, `/boards/${other}`))).status).toBe(404);
  });

  it('answers 304 to a poll while nothing guests see changed', async () => {
    const first = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}`));
    let etag = first.headers.get('etag') as string;
    const same = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}`), undefined, {
      'if-none-match': etag,
    });
    expect(same.status).toBe(304);
    // Any stored document change moves the version, including a hidden card (ADR 0013).
    await saveDoc(
      B.A,
      boardOfLinkElements().map((e) => (e.id === E.hidnote ? { ...e, x: 50 } : e)),
      noteText,
    );
    const hiddenChange = await call(
      { cookie: carla },
      'GET',
      g(linkC, `/boards/${B.A}`),
      undefined,
      {
        'if-none-match': etag,
      },
    );
    expect(hiddenChange.status).toBe(200);
    etag = hiddenChange.headers.get('etag') as string;
    // A visible change, and a new comment guests can read, each move the version.
    await saveDoc(
      B.A,
      boardOfLinkElements().map((e) => (e.id === E.img ? { ...e, x: 50 } : e)),
      noteText,
    );
    const moved = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}`), undefined, {
      'if-none-match': etag,
    });
    expect(moved.status).toBe(200);
    const etag2 = moved.headers.get('etag') as string;
    await db.insert(comment).values({
      projectId: P,
      boardId: B.A,
      elementId: E.note,
      authorId: as.owner.id,
      body: 'Nuovo',
      visibility: 'everyone',
    });
    const counted = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}`), undefined, {
      'if-none-match': etag2,
    });
    expect(counted.status).toBe(200);
    expect(counted.body.commentCounts).toEqual([{ elementId: E.note, open: 1, resolved: 0 }]);
    // guest_view cannot read comments: no counts.
    const viewer = await open(linkV);
    const v = await call({ cookie: viewer.cookie }, 'GET', g(linkV, `/boards/${B.A}`));
    expect(v.body.commentCounts).toEqual([]);
    await db.delete(comment).where(eq(comment.body, 'Nuovo'));
    await saveDoc(B.A, boardOfLinkElements(), noteText);
  });

  it('invalidates snapshot polls for comment activity, withdrawals, covers and link options', async () => {
    const path = g(linkC, `/boards/${B.A}`);
    const poll = (etag?: string) =>
      call({ cookie: carla }, 'GET', path, undefined, etag ? { 'if-none-match': etag } : {});
    const [thread] = await db
      .insert(comment)
      .values({
        projectId: P,
        boardId: B.A,
        elementId: E.note,
        authorId: as.owner.id,
        body: 'Initial',
        visibility: 'everyone',
      })
      .returning();
    let etag = (await poll()).headers.get('etag') as string;
    const changed = async () => {
      const res = await poll(etag);
      expect(res.status).toBe(200);
      etag = res.headers.get('etag') as string;
      expect((await poll(etag)).status).toBe(304);
    };
    await db.update(comment).set({ body: 'Edited' }).where(eq(comment.id, thread!.id));
    await changed();
    await db.insert(comment).values({
      projectId: P,
      boardId: B.A,
      elementId: E.note,
      threadId: thread!.id,
      authorId: as.owner.id,
      body: 'Reply',
      visibility: 'everyone',
    });
    await changed();
    // Replies assigned to another link are invisible and must not invalidate this poll.
    await db.insert(comment).values({
      projectId: P,
      boardId: B.A,
      elementId: E.note,
      threadId: thread!.id,
      shareLinkId: linkA.id,
      authorId: as.owner.id,
      body: 'Other client',
      visibility: 'everyone',
    });
    expect((await poll(etag)).status).toBe(304);
    await db.insert(elementReview).values({
      projectId: P,
      boardId: B.A,
      elementId: E.note,
      shareLinkId: linkC.id,
      changedByGuest: (
        await db.select().from(shareGuest).where(eq(shareGuest.shareLinkId, linkC.id))
      )[0]!.id,
      status: 'none',
    });
    await changed();
    await db.insert(assetVariant).values({
      assetId: X.cover,
      size: '1024',
      width: 1024,
      height: 80,
      storageKey: 'cover-1024.webp',
    });
    await changed();
    await call('editor', 'PATCH', `/api/v1/share-links/${linkC.id}`, { label: 'Updated client' });
    await changed();
    await db.delete(comment).where(eq(comment.id, thread!.id));
    await db
      .delete(elementReview)
      .where(and(eq(elementReview.boardId, B.A), eq(elementReview.elementId, E.note)));
  });

  it('keeps restrictive grants on trashed ancestors in the creator access calculation', async () => {
    await db
      .insert(boardGrant)
      .values({ boardId: B.R, userId: as.editor.id, role: 'viewer', grantedBy: as.owner.id });
    await db.update(board).set({ deletedAt: new Date() }).where(eq(board.id, B.R));
    const denied = await call(null, 'GET', `/api/v1/guest/by-token/${linkC.token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.details).toEqual({ reason: 'unavailable' });
    await db.update(board).set({ deletedAt: null }).where(eq(board.id, B.R));
    await db
      .delete(boardGrant)
      .where(and(eq(boardGrant.boardId, B.R), eq(boardGrant.userId, as.editor.id)));
  });

  it('follows the creator: sub-boards they lose and links they can no longer edit', async () => {
    await db
      .insert(boardGrant)
      .values({ boardId: B.A1, userId: as.editor.id, role: 'viewer', grantedBy: as.owner.id });
    const session = await call({ cookie: carla }, 'GET', g(linkC, '/session'));
    expect(session.body.boards.map((b: { id: string }) => b.id)).toEqual([B.A]);
    expect((await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A1}`))).status).toBe(404);
    const snap = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}`));
    expect(snap.body.elements.map((e: { id: string }) => e.id)).not.toContain(E.card1);
    await db
      .delete(boardGrant)
      .where(and(eq(boardGrant.boardId, B.A1), eq(boardGrant.userId, as.editor.id)));

    const link = await createLink('editor2', B.A);
    const o = await open(link);
    await db
      .update(projectMember)
      .set({ role: 'viewer' })
      .where(and(eq(projectMember.projectId, P), eq(projectMember.userId, as.editor2.id)));
    const stopped = await call({ cookie: o.cookie }, 'GET', g(link, '/session'));
    expect(stopped.status).toBe(403);
    expect(stopped.body.error.details).toEqual({ reason: 'unavailable' });
    const preview = await call(null, 'GET', `/api/v1/guest/by-token/${link.token}`);
    expect(preview.body.error.details).toEqual({ reason: 'unavailable' });
    const list = await call('owner', 'GET', `/api/v1/boards/${B.A}/share-links`);
    expect(list.body.items.find((l: { id: string }) => l.id === link.id)).toMatchObject({
      status: 'suspended',
      url: null,
    });
    await db
      .update(projectMember)
      .set({ role: 'editor' })
      .where(and(eq(projectMember.projectId, P), eq(projectMember.userId, as.editor2.id)));
    expect((await call({ cookie: o.cookie }, 'GET', g(link, '/session'))).status).toBe(200);

    // A revoked link stops its guests at once.
    await call('owner', 'DELETE', `/api/v1/share-links/${link.id}`);
    const revoked = await call({ cookie: o.cookie }, 'GET', g(link, `/boards/${B.A}`));
    expect(revoked.status).toBe(403);
    expect(revoked.body.error.details).toEqual({ reason: 'revoked' });
  });

  // Files -------------------------------------------------------------------------------

  it('serves thumbnails only of files shown to guests, and covers', async () => {
    const thumb = await call({ cookie: carla }, 'GET', g(linkC, `/assets/${X.x1}/variants/256`));
    expect(thumb.status).toBe(200);
    expect(thumb.text).toBe('webp-256');
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    expect(thumb.headers.get('content-security-policy')).toContain('sandbox');
    expect(thumb.headers.get('referrer-policy')).toBe('no-referrer');
    expect(thumb.headers.get('cache-control')).toBe('private, no-cache');
    await db.update(asset).set({ status: 'pending' }).where(eq(asset.id, X.x1));
    expect(
      (await call({ cookie: carla }, 'GET', g(linkC, `/assets/${X.x1}/variants/256`))).status,
    ).toBe(404);
    await db.update(asset).set({ status: 'ready' }).where(eq(asset.id, X.x1));
    // Visible on a sub-board, and the cover of a sub-board.
    expect(
      (await call({ cookie: carla }, 'GET', g(linkC, `/assets/${X.x6}/variants/512`))).status,
    ).toBe(200);
    expect(
      (await call({ cookie: carla }, 'GET', g(linkC, `/assets/${X.cover}/variants/512`))).status,
    ).toBe(200);
    // Hidden, of another project, or missing size.
    for (const id of [X.x2, X.xq])
      expect(
        (await call({ cookie: carla }, 'GET', g(linkC, `/assets/${id}/variants/256`))).status,
      ).toBe(404);
    expect(
      (await call({ cookie: carla }, 'GET', g(linkC, `/assets/${X.x1}/variants/1024`))).status,
    ).toBe(404);
    expect((await call(null, 'GET', g(linkC, `/assets/${X.x1}/variants/256`))).status).toBe(401);
    // No originals without allowDownload.
    expect((await call({ cookie: carla }, 'GET', g(linkC, `/assets/${X.x1}/file`))).status).toBe(
      403,
    );
  });

  it('reuses reachable boards and assets until documents or creator access change', async () => {
    const [row] = await db.select().from(shareLink).where(eq(shareLink.id, linkC.id));
    if (!row) throw new Error('Missing link');
    const docs = new DocViews();
    const first = await resolveLink(db, docs, row);
    const get = vi.spyOn(docs, 'get');
    const select = vi.spyOn(db, 'select');
    try {
      const warm = await resolveLink(db, docs, row);
      expect(warm.status).toBe('active');
      if (warm.status !== 'active' || first.status !== 'active') throw new Error('Inactive link');
      expect(warm.assets).toBe(first.assets);
      expect(warm.boards).toBe(first.boards);
      expect(get).not.toHaveBeenCalled();
      expect(select).toHaveBeenCalledTimes(4); // Three access queries plus batched doc stamps.
      expect(warm.assets.shown.has(X.x6)).toBe(true);
      await saveDoc(B.A1, [
        { ...el, id: E.sub, type: 'image', assetId: X.x6, parent: null, guestHidden: true },
      ]);
      const changed = await resolveLink(db, docs, row);
      if (changed.status !== 'active') throw new Error('Inactive link');
      expect(changed.assets.shown.has(X.x6)).toBe(false);
      expect(
        (await call({ cookie: carla }, 'GET', g(linkC, `/assets/${X.x6}/variants/512`))).status,
      ).toBe(404);
      const restricted = await resolveLink(db, docs, { ...row, includeSubBoards: false });
      if (restricted.status !== 'active') throw new Error('Inactive link');
      expect(restricted.boards.size).toBe(1);
    } finally {
      get.mockRestore();
      select.mockRestore();
      await saveDoc(B.A1, [
        { ...el, id: E.sub, type: 'image', assetId: X.x6, parent: null },
        { ...el, id: E.card3, type: 'board', boardId: B.A3, parent: null, guestHidden: true },
      ]);
    }
  });

  it('invalidates variant ETags after regeneration, including overwrites of the same key', async () => {
    const path = g(linkC, `/assets/${X.x1}/variants/256`);
    const first = await call({ cookie: carla }, 'GET', path);
    const etag = first.headers.get('etag') ?? '';
    expect(
      (await call({ cookie: carla }, 'GET', path, undefined, { 'if-none-match': etag })).status,
    ).toBe(304);
    // Regeneration replaces the variant row, even when the storage key is unchanged.
    await db
      .update(assetVariant)
      .set({ width: 255 })
      .where(and(eq(assetVariant.assetId, X.x1), eq(assetVariant.size, '256')));
    const regenerated = await call({ cookie: carla }, 'GET', path, undefined, {
      'if-none-match': etag,
    });
    expect(regenerated.status).toBe(200);
    expect(regenerated.headers.get('etag')).not.toBe(etag);
    await db
      .update(assetVariant)
      .set({ width: 256 })
      .where(and(eq(assetVariant.assetId, X.x1), eq(assetVariant.size, '256')));
  });

  it('serves originals as attachments when the link allows downloads', async () => {
    const link = await createLink('editor', B.A, { allowDownload: true });
    const o = await open(link);
    const snap = await call({ cookie: o.cookie }, 'GET', g(link, `/boards/${B.A}`));
    const x5 = snap.body.assets.find((a: { id: string }) => a.id === X.x5);
    expect(x5).toMatchObject({
      filename: 'contratto.pdf',
      size: 10,
      downloadUrl: `/api/v1/guest/links/${link.id}/assets/${X.x5}/file`,
    });
    const file = await call({ cookie: o.cookie }, 'GET', g(link, `/assets/${X.x1}/file`));
    expect(file.status).toBe(200);
    expect(file.text).toBe('0123456789');
    expect(file.headers.get('content-type')).toBe('application/octet-stream');
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="x1\.jpg"/);
    expect(file.headers.get('content-security-policy')).toContain('sandbox');
    const part = await call(
      { cookie: o.cookie },
      'GET',
      g(link, `/assets/${X.x1}/file`),
      undefined,
      {
        range: 'bytes=2-4',
      },
    );
    expect(part.status).toBe(206);
    expect(part.text).toBe('234');
    // Covers never as originals; hidden files never.
    expect(
      (await call({ cookie: o.cookie }, 'GET', g(link, `/assets/${X.cover}/file`))).status,
    ).toBe(404);
    expect((await call({ cookie: o.cookie }, 'GET', g(link, `/assets/${X.x2}/file`))).status).toBe(
      404,
    );
    expect((await call({ cookie: o.cookie }, 'GET', g(link, `/assets/${X.xq}/file`))).status).toBe(
      404,
    );
  });

  // Comments -----------------------------------------------------------------------------

  it('rejects comment, review and pick writes with another link guest cookie', async () => {
    for (const [suffix, input] of [
      [`/boards/${B.A}/comments`, { body: 'Foreign guest' }],
      [`/boards/${B.A}/elements/${E.img}/review`, { status: 'approved' }],
      [`/boards/${B.A}/elements/${E.img}/pick`, { pick: 'picked' }],
    ] as const) {
      const method = suffix.endsWith('/comments') ? 'POST' : 'PUT';
      expect((await call({ cookie: carla }, method, g(linkA, suffix), input)).status).toBe(401);
    }
  });

  it('shows guests only the threads of everyone, of their link and on visible cards', async () => {
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    const insert = async (values: Partial<typeof comment.$inferInsert>) => {
      const [row] = await db
        .insert(comment)
        .values({ projectId: P, boardId: B.A, body: 'x', ...values })
        .returning();
      return row?.id as string;
    };
    const t1 = await insert({
      elementId: E.img,
      authorId: as.owner.id,
      visibility: 'everyone',
      body: `Per tutti @{${as.commenter.id}} e @{${as.outsider.id}}`,
      mentions: [as.commenter.id, as.outsider.id],
      createdAt: at(50),
    });
    const t2 = await insert({ authorId: as.owner.id, body: 'Solo team', createdAt: at(40) });
    const t3 = await insert({
      authorId: as.owner.id,
      visibility: 'everyone',
      shareLinkId: linkA.id,
      body: 'Solo per A',
      createdAt: at(30),
    });
    const t4 = await insert({
      elementId: E.inner,
      authorId: as.owner.id,
      visibility: 'everyone',
      createdAt: at(20),
    });
    const t5 = await insert({
      elementId: E.card1,
      authorId: as.owner.id,
      visibility: 'everyone',
      body: 'Sottobacheca',
      createdAt: at(10),
      resolvedAt: new Date(),
      resolvedBy: as.editor.id,
    });
    await insert({
      threadId: t1,
      elementId: E.img,
      authorId: as.editor.id,
      body: 'Risposta team',
      visibility: 'everyone',
      createdAt: at(45),
    });
    await insert({
      threadId: t1,
      elementId: E.img,
      authorGuestId: annaId,
      shareLinkId: linkA.id,
      body: 'Risposta di Anna',
      visibility: 'everyone',
      createdAt: at(44),
    });

    const list = await call(
      { cookie: carla },
      'GET',
      g(linkC, `/boards/${B.A}/comments?status=all`),
    );
    expect(list.status).toBe(200);
    expect(list.body.items.map((t: { id: string }) => t.id)).toEqual([t5, t1]);
    const [resolved, thread] = list.body.items;
    expect(resolved.resolvedBy).toEqual({ kind: 'team', name: 'Editor', isYou: false });
    expect(thread).toMatchObject({
      elementId: E.img,
      parentId: null,
      author: { kind: 'team', name: 'Owner', isYou: false },
      body: 'Per tutti @Commenter e @…',
      canEdit: false,
      canDelete: false,
      replyCount: 1,
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(thread.replies.map((r: { body: string }) => r.body)).toEqual(['Risposta team']);
    expect(JSON.stringify(list.body)).not.toContain(as.owner.id);
    // Anna, of link A, sees her own reply and the thread of her link.
    const a = await call({ cookie: anna }, 'GET', g(linkA, `/boards/${B.A}/comments?status=all`));
    expect(a.body.items.map((t: { id: string }) => t.id)).toEqual([t5, t3, t1]);
    const annaThread = a.body.items[2];
    expect(annaThread.replyCount).toBe(2);
    expect(annaThread.replies[1]).toMatchObject({
      author: { kind: 'guest', name: 'Anna', isYou: true },
      canEdit: true,
    });

    // Paging, open only by default, and filters.
    const p1 = await call(
      { cookie: carla },
      'GET',
      g(linkC, `/boards/${B.A}/comments?status=all&limit=1`),
    );
    expect(p1.body.items.map((t: { id: string }) => t.id)).toEqual([t5]);
    const p2 = await call(
      { cookie: carla },
      'GET',
      g(linkC, `/boards/${B.A}/comments?status=all&limit=1&cursor=${p1.body.nextCursor}`),
    );
    expect(p2.body.items.map((t: { id: string }) => t.id)).toEqual([t1]);
    expect(p2.body.nextCursor).toBeNull();
    const openOnly = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}/comments`));
    expect(openOnly.body.items.map((t: { id: string }) => t.id)).toEqual([t1]);
    expect(
      (
        await call(
          { cookie: carla },
          'GET',
          g(linkC, `/boards/${B.A}/comments?elementId=${E.inner}`),
        )
      ).status,
    ).toBe(404);
    expect(
      (await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}/comments?cursor=bad`))).status,
    ).toBe(400);
    expect(
      (await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A3}/comments`))).status,
    ).toBe(404);

    for (const at of [
      '2026-01-01T00:00:00.000Zjunk',
      '2026-02-30T00:00:00.000000Z',
      '2026-01-01T25:00:00.000000Z',
      '2026-01-01T00:00:00.000000Z|extra',
    ]) {
      const cursor = Buffer.from(`${at}|${t1}`).toString('base64url');
      expect(
        (await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}/comments?cursor=${cursor}`)))
          .status,
      ).toBe(400);
    }

    // Replies of readable threads only.
    const replies = await call({ cookie: carla }, 'GET', g(linkC, `/comments/${t1}/replies`));
    expect(replies.body.items.map((r: { body: string }) => r.body)).toEqual(['Risposta team']);
    for (const t of [t2, t3, t4])
      expect(
        (await call({ cookie: carla }, 'GET', g(linkC, `/comments/${t}/replies`))).status,
      ).toBe(404);

    // guest_view reads no comments.
    const viewer = await open(linkV);
    expect(
      (await call({ cookie: viewer.cookie }, 'GET', g(linkV, `/boards/${B.A}/comments`))).status,
    ).toBe(403);
    // Counts in the snapshot follow the same rule.
    const snap = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}`));
    expect(snap.body.commentCounts).toEqual([
      { elementId: E.card1, open: 0, resolved: 1 },
      { elementId: E.img, open: 1, resolved: 0 },
    ]);
  });

  it('lets guests write comments for their link once they have a name', async () => {
    const path = g(linkC, `/boards/${B.A}/comments`);
    const unnamed = await call({ cookie: carla }, 'POST', path, { body: 'Ciao', elementId: E.img });
    expect(unnamed.status).toBe(403);
    expect(unnamed.body.error.details).toEqual({ reason: 'name_required' });
    expect(
      (await call({ cookie: carla }, 'PATCH', g(linkC, '/session'), { name: 'Carla' })).body.guest
        .name,
    ).toBe('Carla');

    const typed = `Vedi @{${as.owner.id}}`;
    const created = await call({ cookie: carla }, 'POST', path, {
      body: typed,
      elementId: E.img,
      pin: { x: 0.5, y: 0.5 },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      elementId: E.img,
      parentId: null,
      pin: { x: 0.5, y: 0.5 },
      body: typed,
      author: { kind: 'guest', name: 'Carla', isYou: true },
      canEdit: true,
      canDelete: true,
    });
    const [row] = await db.select().from(comment).where(eq(comment.id, created.body.id));
    expect(row).toMatchObject({ visibility: 'everyone', shareLinkId: linkC.id, mentions: [] });
    // Guests of another link never see it.
    const a = await call({ cookie: anna }, 'GET', g(linkA, `/boards/${B.A}/comments?status=all`));
    expect(a.body.items.map((t: { id: string }) => t.id)).not.toContain(created.body.id);

    const [team] = await db.select().from(comment).where(eq(comment.body, 'Solo team'));
    const [forA] = await db.select().from(comment).where(eq(comment.body, 'Solo per A'));
    const [t1] = await db.select().from(comment).where(sql`${comment.body} like 'Per tutti%'`);
    const reply = await call({ cookie: carla }, 'POST', path, {
      body: 'Concordo',
      parentId: t1?.id,
    });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ parentId: t1?.id, elementId: E.img, pin: null });
    for (const body of [
      { body: 'x', parentId: team?.id },
      { body: 'x', parentId: forA?.id },
      { body: 'x', elementId: E.inner },
      { body: 'x', elementId: E.hidnote },
    ])
      expect((await call({ cookie: carla }, 'POST', path, body)).status).toBe(404);
    expect(
      (await call({ cookie: carla }, 'POST', g(linkC, `/boards/${B.A3}/comments`), { body: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (await call({ cookie: carla }, 'POST', g(linkC, `/boards/${B.QR}/comments`), { body: 'x' }))
        .status,
    ).toBe(404);
    const viewer = await open(linkV, { name: 'Vito' });
    expect(
      (
        await call({ cookie: viewer.cookie }, 'POST', g(linkV, `/boards/${B.A}/comments`), {
          body: 'x',
        })
      ).status,
    ).toBe(403);

    // Edit and delete only what you wrote.
    const edited = await call(
      { cookie: carla },
      'PATCH',
      g(linkC, `/comments/${created.body.id}`),
      { body: 'Corretto' },
    );
    expect(edited.status).toBe(200);
    expect(edited.body.body).toBe('Corretto');
    expect(edited.body.editedAt).not.toBeNull();
    const [annaReply] = await db.select().from(comment).where(eq(comment.body, 'Risposta di Anna'));
    for (const id of [t1?.id, annaReply?.id]) {
      expect(
        (await call({ cookie: carla }, 'PATCH', g(linkC, `/comments/${id}`), { body: 'x' })).status,
      ).toBe(404);
      expect((await call({ cookie: carla }, 'DELETE', g(linkC, `/comments/${id}`))).status).toBe(
        404,
      );
    }
    // Through another link, even with the right guest cookie path, nothing.
    expect(
      (
        await call({ cookie: anna }, 'PATCH', g(linkA, `/comments/${created.body.id}`), {
          body: 'x',
        })
      ).status,
    ).toBe(404);

    // A thread start with a reply stays as a placeholder; a reply goes.
    await db.insert(comment).values({
      projectId: P,
      boardId: B.A,
      elementId: E.img,
      threadId: created.body.id,
      authorId: as.owner.id,
      body: 'Visto',
      visibility: 'everyone',
    });
    expect(
      (await call({ cookie: carla }, 'DELETE', g(linkC, `/comments/${created.body.id}`))).status,
    ).toBe(204);
    const [placeholder] = await db.select().from(comment).where(eq(comment.id, created.body.id));
    expect(placeholder?.deletedAt).not.toBeNull();
    expect(placeholder?.body).toBe('');
    expect(
      (await call({ cookie: carla }, 'DELETE', g(linkC, `/comments/${reply.body.id}`))).status,
    ).toBe(204);
    expect(await db.select().from(comment).where(eq(comment.id, reply.body.id))).toEqual([]);
    expect(
      (
        await call({ cookie: carla }, 'PATCH', g(linkC, `/comments/${created.body.id}`), {
          body: 'x',
        })
      ).status,
    ).toBe(404);
  });

  it('limits guest comments per guest', async () => {
    const o = await open(linkC, { name: 'Spam' });
    const path = g(linkC, `/boards/${B.A}/comments`);
    for (let i = 0; i < 30; i++)
      expect((await call({ cookie: o.cookie }, 'POST', path, { body: `n${i}` })).status).toBe(201);
    expect((await call({ cookie: o.cookie }, 'POST', path, { body: 'troppi' })).status).toBe(429);
    await db.delete(comment).where(eq(comment.shareLinkId, linkC.id));
  });

  // Reviews --------------------------------------------------------------------------------

  it('takes review decisions per link, withdrawn only by their author', async () => {
    const path = (link: Link, id: string) => g(link, `/boards/${B.A}/elements/${id}/review`);
    expect(
      (await call({ cookie: carla }, 'PUT', path(linkC, E.img), { status: 'approved' })).status,
    ).toBe(403);
    expect(
      (await call({ cookie: anna }, 'PUT', path(linkA, E.img), { status: 'in_review' })).status,
    ).toBe(400);
    expect(
      (await call({ cookie: anna }, 'PUT', path(linkA, E.inner), { status: 'approved' })).status,
    ).toBe(404);
    expect(
      (
        await call({ cookie: anna }, 'PUT', g(linkA, `/boards/${B.A2}/elements/${E.img}/review`), {
          status: 'approved',
        })
      ).status,
    ).toBe(404);
    // Nothing to withdraw yet.
    expect(
      (await call({ cookie: anna }, 'PUT', path(linkA, E.img), { status: 'none' })).status,
    ).toBe(403);

    const approved = await call({ cookie: anna }, 'PUT', path(linkA, E.img), {
      status: 'approved',
      note: 'Bella',
    });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      elementId: E.img,
      status: 'approved',
      note: 'Bella',
      changedBy: { kind: 'guest', name: 'Anna', isYou: true },
    });
    // Another guest of the same link sees it, and cannot withdraw it; a guest of another link
    // never sees it.
    const brunoSnap = await call({ cookie: bruno }, 'GET', g(linkA, `/boards/${B.A}`));
    expect(brunoSnap.body.reviews).toEqual([
      { ...approved.body, changedBy: { kind: 'guest', name: 'Anna', isYou: false } },
    ]);
    expect(
      (await call({ cookie: bruno }, 'PUT', path(linkA, E.img), { status: 'none' })).status,
    ).toBe(403);
    const carlaSnap = await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}`));
    expect(carlaSnap.body.reviews).toEqual([]);

    // The team asks for review later: everyone sees the team's status, without its note.
    await db.insert(elementReview).values({
      boardId: B.A,
      elementId: E.img,
      projectId: P,
      status: 'in_review',
      note: 'Nota interna',
      changedBy: as.owner.id,
      requestedBy: as.owner.id,
      changedAt: new Date(Date.now() + 1000),
    });
    const teamView = {
      status: 'in_review',
      note: null,
      changedBy: { kind: 'team', name: 'Owner', isYou: false },
    };
    expect(
      (await call({ cookie: carla }, 'GET', g(linkC, `/boards/${B.A}`))).body.reviews,
    ).toMatchObject([teamView]);
    expect(
      (await call({ cookie: anna }, 'GET', g(linkA, `/boards/${B.A}`))).body.reviews,
    ).toMatchObject([teamView]);
    // Anna's decision is older than what she sees: not hers to withdraw.
    expect(
      (await call({ cookie: anna }, 'PUT', path(linkA, E.img), { status: 'none' })).status,
    ).toBe(403);

    await new Promise((r) => setTimeout(r, 1100));
    const changes = await call({ cookie: bruno }, 'PUT', path(linkA, E.img), {
      status: 'changes_requested',
    });
    expect(changes.body).toMatchObject({
      status: 'changes_requested',
      note: null,
      changedBy: { name: 'Bruno', isYou: true },
    });
    const withdrawn = await call({ cookie: bruno }, 'PUT', path(linkA, E.img), {
      status: 'none',
      note: 'ignored',
    });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body).toMatchObject(teamView);

    // Without a team status, a withdrawal answers the guest's own `none`.
    await call({ cookie: anna }, 'PUT', path(linkA, E.frame), { status: 'approved' });
    const none = await call({ cookie: anna }, 'PUT', path(linkA, E.frame), { status: 'none' });
    expect(none.body).toMatchObject({
      elementId: E.frame,
      status: 'none',
      changedBy: { name: 'Anna', isYou: true },
    });
    expect(
      (await call({ cookie: anna }, 'GET', g(linkA, `/boards/${B.A}`))).body.reviews.map(
        (r: { elementId: string }) => r.elementId,
      ),
    ).toEqual([E.img]);

    const events = await db
      .select()
      .from(elementReviewEvent)
      .where(eq(elementReviewEvent.shareLinkId, linkA.id));
    expect(events.map((e) => [e.previous, e.status])).toEqual(
      expect.arrayContaining([
        ['none', 'approved'],
        ['approved', 'changes_requested'],
        ['changes_requested', 'none'],
      ]),
    );
    expect(events.every((e) => e.userId === null && e.guestId !== null)).toBe(true);
    const unnamed = await open(linkA);
    const nameless = await call({ cookie: unnamed.cookie }, 'PUT', path(linkA, E.img), {
      status: 'approved',
    });
    expect(nameless.body.error.details).toEqual({ reason: 'name_required' });
  });

  // Proofing --------------------------------------------------------------------------------

  it('takes picks and stars on pictures, and sums them up for the team', async () => {
    const path = (link: Link, id: string) => g(link, `/boards/${B.A}/elements/${id}/pick`);
    expect(
      (await call({ cookie: carla }, 'PUT', path(linkC, E.img), { pick: 'picked' })).status,
    ).toBe(403);
    expect(
      (await call({ cookie: anna }, 'PUT', path(linkA, E.note), { pick: 'picked' })).status,
    ).toBe(400);
    expect(
      (await call({ cookie: anna }, 'PUT', path(linkA, E.inner), { pick: 'picked' })).status,
    ).toBe(404);
    expect(
      (
        await call({ cookie: anna }, 'PUT', g(linkA, `/boards/${B.A2}/elements/${E.img}/pick`), {
          pick: 'picked',
        })
      ).status,
    ).toBe(404);
    expect((await call({ cookie: anna }, 'PUT', path(linkA, E.img), {})).status).toBe(400);
    expect((await call({ cookie: anna }, 'PUT', path(linkA, E.img), { stars: 6 })).status).toBe(
      400,
    );

    const picked = await call({ cookie: anna }, 'PUT', path(linkA, E.img), {
      pick: 'picked',
      stars: 4,
    });
    expect(picked.status).toBe(200);
    expect(picked.body).toMatchObject({ boardId: B.A, elementId: E.img, pick: 'picked', stars: 4 });
    const starOnly = await call({ cookie: anna }, 'PUT', path(linkA, E.img), { stars: 5 });
    expect(starOnly.body).toMatchObject({ pick: 'picked', stars: 5 });
    await call({ cookie: anna }, 'PUT', path(linkA, E.frame), { pick: 'rejected' });
    await call({ cookie: bruno }, 'PUT', path(linkA, E.img), { stars: 2 });
    await call({ cookie: bruno }, 'PUT', path(linkA, E.frame), { pick: 'picked' });
    const cleared = await call({ cookie: bruno }, 'PUT', path(linkA, E.frame), { pick: null });
    expect(cleared.body).toMatchObject({ pick: null, stars: null });

    const snap = await call({ cookie: anna }, 'GET', g(linkA, `/boards/${B.A}`));
    expect(
      snap.body.picks.map((p: { elementId: string; pick: string }) => [p.elementId, p.pick]),
    ).toEqual([
      [E.frame, 'rejected'],
      [E.img, 'picked'],
    ]);

    const res = await call('editor', 'GET', `/api/v1/share-links/${linkA.id}/picks`);
    expect(res.status).toBe(200);
    expect(res.body.guests.map((g: { name: string }) => g.name)).toEqual(
      expect.arrayContaining(['Anna', 'Bruno']),
    );
    const img = res.body.items.find((i: { elementId: string }) => i.elementId === E.img);
    expect(img).toMatchObject({
      boardId: B.A,
      assetId: X.x1,
      filename: 'x1.jpg',
      picked: 1,
      rejected: 0,
      starsAverage: 3.5,
      starsCount: 2,
    });
    expect(img.byGuest).toHaveLength(2);
    const frame = res.body.items.find((i: { elementId: string }) => i.elementId === E.frame);
    expect(frame).toMatchObject({
      picked: 0,
      rejected: 1,
      starsCount: 0,
      starsAverage: null,
      filename: 'x3.jpg',
    });
    expect((await call('viewer', 'GET', `/api/v1/share-links/${linkA.id}/picks`)).status).toBe(403);
    expect((await call('outsider', 'GET', `/api/v1/share-links/${linkA.id}/picks`)).status).toBe(
      404,
    );
  });

  it('limits guest writes per guest', async () => {
    const o = await open(linkV);
    for (let i = 0; i < 60; i++)
      expect(
        (await call({ cookie: o.cookie }, 'PATCH', g(linkV, '/session'), { name: `N${i}` })).status,
      ).toBe(200);
    expect(
      (await call({ cookie: o.cookie }, 'PATCH', g(linkV, '/session'), { name: 'Basta' })).status,
    ).toBe(429);
  });

  it('limits previews per address', async () => {
    const where = { 'x-forwarded-for': '10.40.0.1' };
    for (let i = 0; i < 60; i++)
      await call(null, 'GET', `/api/v1/guest/by-token/${linkC.token}`, undefined, where);
    expect(
      (await call(null, 'GET', `/api/v1/guest/by-token/${linkC.token}`, undefined, where)).status,
    ).toBe(429);
  });
});
