import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addVariant, listElements, type PlanElement, updateElement } from '@inkadra/canvas-core';
import {
  bigPlanFixture,
  type PlanSheetFixture,
  planSheetFixture,
  planSheetFixtureFull,
} from '@inkadra/canvas-core/fixtures/plan-sheet';
import type { Op, Page } from '@inkadra/print';
import { PLAN_SHEET_PDF_CAPABILITY } from '@inkadra/shared';
import fontkit from '@pdf-lib/fontkit';
import { sql } from 'drizzle-orm';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, assetVariant, boardDoc, shootingDay } from '../db/schema.ts';
import {
  greyPicture,
  greyRaw,
  guestSheetSource,
  memberSheetSource,
  planSheetLayout,
  type SheetAsk,
  type SheetLayout,
  type SheetSource,
  sheetFonts,
  sheetLanguage,
  sheetPdf,
  sheetPicture,
  sheetWords,
} from '../plan-sheet.ts';
import { linkElements, viewOf } from '../share-links.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

/** The set plan's sheet from the server (decision 0122). */

const golden = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../web/src/board/export/golden/${name}`, import.meta.url)),
    'utf8',
  );

/** Numbers to a thousandth of a point, as the web's golden files. */
const rounded = (_key: string, value: unknown) =>
  typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;

/** The pages as the web's goldens write them (`plan-sheet-node.fixture.ts`'s `sheetText`). */
function sheetText(pages: readonly Page[]): string {
  const lines: string[] = [];
  const walk = (ops: readonly Op[], indent: string) => {
    for (const op of ops) {
      if (op.kind === 'clip') {
        const { ops: inside, ...box } = op;
        lines.push(indent + JSON.stringify(box, rounded));
        walk(inside, `${indent}  `);
      } else lines.push(indent + JSON.stringify(op, rounded));
    }
  };
  pages.forEach((page, n) => {
    const { ops, ...rest } = page;
    lines.push(`page ${n + 1} ${JSON.stringify(rest, rounded)}`);
    walk(ops, '  ');
  });
  return `${lines.join('\n')}\n`;
}

/** What a guest of a link on the fixture's board gets: the server's own guest view. */
function guestSource(fixture: PlanSheetFixture): SheetSource {
  const view = viewOf(fixture.doc);
  return guestSheetSource(view, linkElements(view, new Map([['board', {}]])));
}

const ask = (fixture: PlanSheetFixture, over: Partial<SheetAsk> = {}): SheetAsk => ({
  planId: fixture.planIds[0],
  setups: 'all',
  include: undefined,
  language: 'en',
  audience: 'team',
  ...over,
});

/** The text of each page as pdf.js reads it, as the web's tests do. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  return pages.join('\n');
}

/** The pictures embedded in a PDF: their dictionary and their (JPEG) bytes. */
function pdfPictures(pdf: PDFDocument) {
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, obj]) =>
      obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
        ? [obj]
        : [],
    );
}

/** Every pixel of a JPEG read back in RGB has R = G = B. */
async function allGrey(jpeg: Uint8Array) {
  const { data, info } = await sharp(jpeg)
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(3);
  for (let i = 0; i < data.length; i += 3)
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) return false;
  return true;
}

const red = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 60 } } });

describe('the sheet laid out by the server (parity with the web, decision 0122)', () => {
  describe.each([
    ['team', 'en'],
    ['team', 'it'],
    ['guest', 'en'],
    ['guest', 'it'],
  ] as const)('for the %s in %s', (who, language) => {
    it("is the web export's golden list of drawing operations", async () => {
      const fixture = planSheetFixture();
      const source =
        who === 'team'
          ? memberSheetSource(listElements(fixture.doc), 'team', fixture.days)
          : guestSource(fixture);
      const { measure } = await sheetFonts();
      const layout = planSheetLayout(
        source,
        ask(fixture, { language, audience: who === 'team' ? 'team' : 'client' }),
        measure,
      );
      expect(layout.pages).toHaveLength(3);
      expect(sheetText(layout.pages)).toBe(golden(`plan-sheet-${who}-${language}.txt`));
    });
  });

  it("gives a member's client copy the guests' sheet, whatever days it is given", async () => {
    const fixture = planSheetFixture();
    const { measure } = await sheetFonts();
    const layout = planSheetLayout(
      memberSheetSource(listElements(fixture.doc), 'client', fixture.days),
      ask(fixture, { audience: 'client' }),
      measure,
    );
    expect(sheetText(layout.pages)).toBe(golden('plan-sheet-guest-en.txt'));
  });

  it('prints only this setup, and the parts asked for', async () => {
    const fixture = planSheetFixture();
    const { measure } = await sheetFonts();
    const source = memberSheetSource(listElements(fixture.doc), 'team', fixture.days);
    const one = planSheetLayout(source, ask(fixture, { setups: 'this' }), measure);
    expect(one.pages).toHaveLength(1);
    expect(one.title).toBe('Set plan · Bancone');
    const texts = (layout: SheetLayout) =>
      JSON.stringify(layout.pages)
        .match(/"text":"[^"]*"/g)
        ?.join('\n') ?? '';
    const bare = planSheetLayout(source, ask(fixture, { include: new Set() }), measure);
    // No "Date and scene": no scene in the heading, no day at the foot.
    expect(texts(bare)).not.toContain('Day 2');
    expect(texts(bare)).not.toContain('SCENE 2');
    // A setup is named with its base's title.
    const setup = planSheetLayout(source, ask(fixture, { planId: fixture.planIds[1] }), measure);
    expect(setup.title).toBe('Set plan · Bancone · Controcampo');
  });
});

describe('the words and the language of the sheet', () => {
  it('reads the query, then the account, then Accept-Language, then English', () => {
    expect(sheetLanguage('de', 'it', 'fr')).toBe('de');
    expect(sheetLanguage(undefined, 'it', 'fr')).toBe('it');
    expect(sheetLanguage(undefined, 'pt-BR', undefined)).toBe('pt');
    expect(sheetLanguage(undefined, 'ja', 'ja-JP, es;q=0.4, fr;q=0.8')).toBe('fr');
    expect(sheetLanguage(undefined, null, 'it;q=0, de-CH')).toBe('de');
    expect(sheetLanguage(undefined, null, 'ja, zh')).toBe('en');
    expect(sheetLanguage(undefined, null, undefined)).toBe('en');
  });

  it('writes the sheet in each language, with the English words where one lacks them', () => {
    expect(sheetWords('it')('board.plan.sheet.day', { n: 3 })).toBe('Giorno 3');
    expect(sheetWords('en')('film.scene.times.night')).toBe('NIGHT');
    expect(sheetWords('fr')('export.kindBoard')).toBeTruthy();
  });
});

describe('the pictures and the fonts of the PDF', () => {
  it('greys pixels as the web does (its golden), alpha kept', async () => {
    // The web golden's 4 × 4 picture: primaries, mixes, greys, the rounding edges, four alphas.
    const rgba = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [128, 128, 128, 255],
      [255, 255, 0, 200],
      [0, 255, 255, 128],
      [255, 0, 255, 64],
      [1, 2, 3, 0],
      [200, 100, 50, 255],
      [50, 100, 200, 255],
      [17, 34, 51, 255],
      [254, 1, 127, 255],
      [3, 3, 2, 255],
      [157, 184, 242, 255],
    ].flat();
    const png = await sharp(Buffer.from(rgba), { raw: { width: 4, height: 4, channels: 4 } })
      .png()
      .toBuffer();
    const { data } = await greyRaw(png);
    const rows = Array.from({ length: 4 }, (_, r) =>
      Array.from({ length: 4 }, (_, c) => {
        const i = (r * 4 + c) * 4;
        return Array.from(data.subarray(i, i + 4)).join(',');
      }).join(' '),
    );
    expect(`${rows.join('\n')}\n`).toBe(golden('grey-pixels.txt'));
  });

  it('embeds a grey background through the grey provider, R = G = B', async () => {
    const fixture = planSheetFixtureFull();
    const { measure } = await sheetFonts();
    const layout = planSheetLayout(
      memberSheetSource(listElements(fixture.doc), 'team', fixture.days),
      ask(fixture, { setups: 'this' }),
      measure,
    );
    expect(layout.pictures).toEqual([fixture.backgroundId]);
    const picture = await sheetPicture(await red(48, 32).webp().toBuffer());
    expect(picture).toMatchObject({ width: 48, height: 32, type: 'jpeg' });
    const grey = vi.fn(greyPicture);
    const bytes = await sheetPdf(
      layout,
      new Map([[fixture.backgroundId, picture as NonNullable<typeof picture>]]),
      'en',
      undefined,
      grey,
    );
    expect(grey).toHaveBeenCalledTimes(1);
    const pictures = pdfPictures(await PDFDocument.load(bytes));
    expect(pictures).toHaveLength(1);
    const [embedded] = pictures as [PDFRawStream];
    expect(embedded.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(await allGrey(embedded.getContents())).toBe(true);
    // The picture given was red: the grey one is what is embedded.
    expect(await allGrey(picture?.bytes as Uint8Array)).toBe(false);
  });

  it('leaves out a picture it cannot read', async () => {
    expect(await sheetPicture(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await greyPicture({ width: 1, height: 1, bytes: new Uint8Array([1]) })).toBeNull();
  });

  it('embeds Inter subsets whose glyphs keep their outlines, Polish and Cyrillic too', async () => {
    // The fontkit patch (patches/, decision 0038): unpatched, most letters print blank.
    const text = 'Przez okno, łagodne światło · Свет из окна, мягкий · NOTES';
    const page: Page = {
      width: 400,
      height: 100,
      ops: [
        { kind: 'text', text, x: 10, y: 20, size: 10, weight: 400, color: '#202020' },
        { kind: 'text', text, x: 10, y: 60, size: 10, weight: 600, color: '#202020' },
      ],
    };
    const layout: SheetLayout = {
      pages: [page],
      title: 'Fonts',
      t: sheetWords('en'),
      pictures: [],
    };
    const pdf = await PDFDocument.load(await sheetPdf(layout, new Map(), 'en'));
    const { bytes: fonts } = await sheetFonts();
    const source = { Regular: fonts[400], SemiBold: fonts[600] };
    const checked: string[] = [];
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('FontDescriptor'))
        continue;
      const name = /^\/Inter-(\w+)-\d+$/.exec(String(obj.get(PDFName.of('FontName'))))?.[1];
      if (name !== 'Regular' && name !== 'SemiBold') continue;
      const program = obj.lookup(PDFName.of('FontFile2'));
      if (!(program instanceof PDFRawStream)) throw new Error(`No font program for ${name}`);
      const subset = fontkit.create(Buffer.from(decodePDFRawStream(program).decode()));
      const whole = fontkit.create(Buffer.from(source[name]));
      const used = [...new Set(whole.layout(text).glyphs.map((g) => g.id))];
      const outline = (glyph: { path: { toSVG(): string } }) => glyph.path.toSVG();
      expect(used.map((_, n) => outline(subset.getGlyph(n + 1)))).toEqual(
        used.map((id) => outline(whole.getGlyph(id))),
      );
      expect(used.filter((id) => outline(whole.getGlyph(id)) !== '').length).toBeGreaterThan(30);
      checked.push(name);
    }
    expect(checked.sort()).toEqual(['Regular', 'SemiBold']);
  });

  // The measure of decision 0122: `PLAN_SHEET_BENCH=1` prints it.
  it.runIf(process.env.PLAN_SHEET_BENCH)(
    'renders a full plan of 300 icons and 3 setups with a 2048 px picture',
    async () => {
      const fixture = bigPlanFixture(300);
      const plan = listElements(fixture.doc).find((el) => el.id === fixture.planIds[0]);
      updateElement(fixture.doc, fixture.planIds[0], {
        background: { assetId: fixture.backgroundId, grey: true },
      });
      const photo = await sharp({
        create: {
          width: 2048,
          height: 1365,
          channels: 3,
          noise: { type: 'gaussian', mean: 128, sigma: 40 },
        },
      })
        .webp()
        .toBuffer();
      expect(plan?.type).toBe('plan');
      await sheetFonts();
      const runs: Array<{ ms: number; rss: number; heap: number }> = [];
      for (let n = 0; n < 5; n++) {
        global.gc?.();
        const before = process.memoryUsage();
        let peak = before.rss;
        const timer = setInterval(() => {
          peak = Math.max(peak, process.memoryUsage().rss);
        }, 5);
        const start = performance.now();
        const { measure } = await sheetFonts();
        const layout = planSheetLayout(
          memberSheetSource(listElements(fixture.doc), 'team', fixture.days),
          ask(fixture, {
            include: new Set([
              'legend',
              'kit',
              'power',
              'notes',
              'scale',
              'background',
              'dateScene',
              'grid',
            ]),
          }),
          measure,
        );
        const picture = await sheetPicture(photo);
        const bytes = await sheetPdf(
          layout,
          new Map(picture ? [[fixture.backgroundId, picture]] : []),
          'en',
        );
        const ms = performance.now() - start;
        clearInterval(timer);
        peak = Math.max(peak, process.memoryUsage().rss);
        expect(layout.pages).toHaveLength(3);
        expect(bytes.byteLength).toBeGreaterThan(10_000);
        runs.push({
          ms: Math.round(ms),
          rss: Math.round((peak - before.rss) / 2 ** 20),
          heap: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
        });
      }
      console.log(`plan sheet bench (ms, peak rss delta MiB, heap MiB): ${JSON.stringify(runs)}`);
    },
    120_000,
  );
});

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe.skipIf(!url)('the sheet routes (needs DATABASE_URL)', () => {
  const env = {
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  };
  const config = loadConfig(env);
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  const deps = testDeps(db, log);
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  let projectId = '';
  let rootBoardId = '';
  let boardId = '';
  let fixture: PlanSheetFixture;
  let pictureId = '';

  async function signUp(name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
    });
    people[name] = {
      cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
      id: res.json().user.id,
    };
  }

  function request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    as: string | { cookie: string } | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    const cookie = typeof as === 'string' ? people[as]?.cookie : as?.cookie;
    return app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...(cookie ? { cookie } : {}), origin: config.PUBLIC_URL, ...headers },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }

  const sheetPath = (planId: string, query = '', board = boardId) =>
    `/boards/${board}/plans/${planId}/sheet${query}`;

  async function newBoard(title: string) {
    const created = await request('POST', `/projects/${projectId}/boards`, 'owner', {
      parentBoardId: rootBoardId,
      title,
    });
    expect(created.statusCode).toBe(201);
    return created.json().id as string;
  }

  async function saveDoc(board: string, doc: Y.Doc) {
    const state = Y.encodeStateAsUpdate(doc);
    await db
      .insert(boardDoc)
      .values({ boardId: board, state, schemaVersion: 3, size: state.byteLength })
      .onConflictDoUpdate({
        target: boardDoc.boardId,
        set: { state, size: state.byteLength, updatedAt: new Date() },
      });
  }

  /** A ready picture with a 512 and a 2048 px thumbnail, the one the sheet picks. */
  async function makePicture() {
    const [row] = await db
      .insert(asset)
      .values({
        projectId,
        kind: 'image',
        mime: 'image/png',
        filename: 'floor.png',
        size: 10,
        storageKey: 'originals/floor.png',
        status: 'ready',
        width: 3000,
        height: 2000,
      })
      .returning();
    const id = row?.id as string;
    for (const [size, width, height] of [
      ['512', 512, 341],
      ['2048', 2048, 1365],
    ] as const) {
      const key = `variants/${id}/${size}.webp`;
      await deps.storage.write(key, await red(width, height).webp().toBuffer(), 'image/webp');
      await db.insert(assetVariant).values({ assetId: id, size, width, height, storageKey: key });
    }
    return id;
  }

  /** A share link of the board and a guest session on it. */
  async function guestOn(board: string) {
    const link = await request('POST', `/boards/${board}/share-links`, 'owner', {});
    expect(link.statusCode).toBe(201);
    const id = link.json().id as string;
    const token = (link.json().url as string).split('/s/')[1] as string;
    const session = await request('POST', `/guest/links/${id}/session`, null, { token });
    expect(session.statusCode).toBeLessThan(300);
    const cookie = String(session.headers['set-cookie']).split(';')[0] ?? '';
    return { id, cookie };
  }

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth, log, ...deps });
    for (const name of ['owner', 'viewer', 'stranger', 'limited', 'busy1', 'busy2', 'busy3'])
      await signUp(name);
    const project = await request('POST', '/projects', 'owner', { name: 'Diner' });
    projectId = project.json().id;
    rootBoardId = project.json().rootBoardId;
    for (const name of ['viewer', 'limited', 'busy1', 'busy2', 'busy3'])
      await request('PUT', `/projects/${projectId}/members/${people[name]?.id}`, 'owner', {
        role: 'viewer',
      });
    boardId = await newBoard('Diner');
    pictureId = await makePicture();
    fixture = planSheetFixtureFull();
    const base = listElements(fixture.doc).find(
      (el) => el.id === fixture.planIds[0],
    ) as PlanElement;
    updateElement(fixture.doc, base.id, {
      background: { ...base.background, assetId: pictureId },
    });
    await saveDoc(boardId, fixture.doc);
    for (const day of fixture.days)
      await db.insert(shootingDay).values({
        projectId,
        boardId,
        date: day.date,
        callTime: '08:00',
        location: '',
        notes: '',
        blocks: day.blocks.map((b) => ({
          id: randomUUID(),
          type: b.shotId ? ('shot' as const) : ('note' as const),
          title: '',
          start: null,
          duration: 30,
          shotId: b.shotId,
          cast: [],
          departments: [],
        })),
      });
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('advertises the capability', async () => {
    const res = await request('GET', '/instance/version', 'viewer');
    expect(res.json().capabilities).toContain(PLAN_SHEET_PDF_CAPABILITY);
  });

  it("gives a viewer the team's sheet: every card, Day N, the picture in greys", async () => {
    const res = await request('GET', sheetPath(fixture.planIds[0]), 'viewer');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="Set plan _ Bancone.pdf"; filename*=UTF-8''${encodeURIComponent('Set plan · Bancone.pdf')}`,
    );
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    const bytes = new Uint8Array(res.rawPayload);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getTitle()).toBe('Set plan · Bancone');
    const text = await pdfText(bytes);
    expect(text).toContain(fixture.hiddenName);
    expect(text).toContain('Day 2');
    // The 2048 px thumbnail, in greys as the plan says.
    const pictures = pdfPictures(pdf);
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.dict.get(PDFName.of('Width'))?.toString()).toBe('2048');
    expect(await allGrey((pictures[0] as PDFRawStream).getContents())).toBe(true);
  });

  it('writes the client copy without hidden cards nor days, in the language asked', async () => {
    const res = await request(
      'GET',
      sheetPath(fixture.planIds[0], '?audience=client&lang=it'),
      'viewer',
    );
    expect(res.statusCode).toBe(200);
    const text = await pdfText(new Uint8Array(res.rawPayload));
    for (const word of fixture.hiddenName.split(' ')) expect(text).not.toContain(word);
    expect(text).not.toMatch(/Giorno \d|Day \d/);
    expect(text.toLowerCase()).toContain('pianta del set');
    // Accept-Language, without a query or an account language.
    const de = await request(
      'GET',
      sheetPath(fixture.planIds[0], '?setups=this'),
      'viewer',
      undefined,
      {
        'accept-language': 'ja, de-CH;q=0.9',
      },
    );
    expect(await pdfText(new Uint8Array(de.rawPayload))).toContain('Tag 2');
  });

  it('answers 304 to the tag it gave, until the document changes', async () => {
    const path = sheetPath(fixture.planIds[1], '?setups=this&include=legend,%20kit,,scale');
    const first = await request('GET', path, 'viewer');
    expect(first.statusCode).toBe(200);
    const etag = String(first.headers.etag);
    const again = await request('GET', path, 'viewer', undefined, { 'if-none-match': etag });
    expect(again.statusCode).toBe(304);
    expect(again.headers.etag).toBe(etag);
    expect(again.headers['cache-control']).toBe('private, no-cache');
    // Another language is another sheet.
    const other = await request('GET', `${path}&lang=fr`, 'viewer', undefined, {
      'if-none-match': etag,
    });
    expect(other.statusCode).toBe(200);
    await saveDoc(boardId, fixture.doc);
    const changed = await request('GET', path, 'viewer', undefined, { 'if-none-match': etag });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
    // Access is checked on every request, 304 included.
    const stranger = await request('GET', path, 'stranger', undefined, { 'if-none-match': etag });
    expect(stranger.statusCode).toBe(404);
  });

  it('answers 404 to what a member cannot see and 401 without a session', async () => {
    const scene = listElements(fixture.doc).find((el) => el.type === 'scene');
    expect((await request('GET', sheetPath(fixture.planIds[0]), 'stranger')).statusCode).toBe(404);
    expect((await request('GET', sheetPath(fixture.planIds[0]), null)).statusCode).toBe(401);
    expect((await request('GET', sheetPath('noSuchPlan123'), 'viewer')).statusCode).toBe(404);
    expect((await request('GET', sheetPath(scene?.id ?? ''), 'viewer')).statusCode).toBe(404);
    const empty = await newBoard('Empty');
    expect(
      (await request('GET', sheetPath(fixture.planIds[0], '', empty), 'viewer')).statusCode,
    ).toBe(404);
  });

  it('answers 400 to an unknown part or language and to more than 20 setups', async () => {
    const base = fixture.planIds[0];
    const bad = await request('GET', sheetPath(base, '?include=legend,cats'), 'viewer');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('bad_request');
    expect((await request('GET', sheetPath(base, '?lang=ja'), 'viewer')).statusCode).toBe(400);
    expect((await request('GET', sheetPath(base, '?setups=some'), 'viewer')).statusCode).toBe(400);
    // Unknown parameters are ignored.
    expect(
      (await request('GET', sheetPath(base, '?setups=this&area=1,2,3,4'), 'viewer')).statusCode,
    ).toBe(200);
    const big = planSheetFixture();
    const plan = listElements(big.doc).find((el) => el.id === big.planIds[0]) as PlanElement;
    for (let n = 0; n < 19; n++) addVariant(big.doc, plan, `Setup ${n}`, { userId: null });
    const board = await newBoard('Big family');
    await saveDoc(board, big.doc);
    const many = await request('GET', sheetPath(big.planIds[0], '', board), 'viewer');
    expect(many.statusCode).toBe(400);
    expect(many.json().error.message).toContain('setups=this');
    expect(
      (await request('GET', sheetPath(big.planIds[0], '?setups=this', board), 'viewer')).statusCode,
    ).toBe(200);
  });

  it('gives a guest the client copy: no hidden card, no day, whatever is asked', async () => {
    const guest = await guestOn(boardId);
    const path = `/guest/links/${guest.id}/boards/${boardId}/plans/${fixture.planIds[0]}/sheet`;
    const res = await request('GET', `${path}?audience=team`, guest);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    const bytes = new Uint8Array(res.rawPayload);
    const text = await pdfText(bytes);
    expect(text).toContain('Setup 1 · Base');
    for (const word of fixture.hiddenName.split(' ')) expect(text).not.toContain(word);
    expect(text).not.toMatch(/Day \d/);
    // The picture the link shows, in greys.
    const pictures = pdfPictures(await PDFDocument.load(bytes));
    expect(pictures).toHaveLength(1);
    const etag = String(res.headers.etag);
    expect(
      (await request('GET', path, guest, undefined, { 'if-none-match': etag })).statusCode,
    ).toBe(304);
    expect((await request('GET', path, null)).statusCode).toBe(401);
    expect(
      (
        await request(
          'GET',
          `/guest/links/${guest.id}/boards/${randomUUID()}/plans/${fixture.planIds[0]}/sheet`,
          guest,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('answers 404 to a guest for a plan hidden from guests', async () => {
    const hidden = planSheetFixture();
    updateElement(hidden.doc, hidden.planIds[2], { guestHidden: true });
    const board = await newBoard('Hidden setup');
    await saveDoc(board, hidden.doc);
    const guest = await guestOn(board);
    const path = (id: string) => `/guest/links/${guest.id}/boards/${board}/plans/${id}/sheet`;
    expect((await request('GET', path(hidden.planIds[2]), guest)).statusCode).toBe(404);
    // The family the guest sees has two setups.
    const res = await request('GET', path(hidden.planIds[0]), guest);
    expect(res.statusCode).toBe(200);
    expect((await PDFDocument.load(new Uint8Array(res.rawPayload))).getPageCount()).toBe(2);
  });

  it('lets one account make 10 sheets a minute', async () => {
    const path = sheetPath(fixture.planIds[0], '?setups=this');
    const first = await request('GET', path, 'limited');
    const etag = String(first.headers.etag);
    for (let n = 1; n < 10; n++)
      expect(
        (await request('GET', path, 'limited', undefined, { 'if-none-match': etag })).statusCode,
      ).toBe(304);
    const refused = await request('GET', path, 'limited');
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    // Others are not counted with it.
    expect((await request('GET', path, 'viewer')).statusCode).toBe(200);
  });

  it('renders 2 sheets at once and tells a third to come back', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = deps.storage.read.bind(deps.storage);
    const spy = vi.spyOn(deps.storage, 'read').mockImplementation(async (key, range) => {
      await gate;
      return read(key, range);
    });
    try {
      const path = sheetPath(fixture.planIds[0], '?setups=this');
      const one = request('GET', path, 'busy1');
      const two = request('GET', path, 'busy2');
      await expect.poll(() => spy.mock.calls.length, { timeout: 10_000 }).toBe(2);
      const third = await request('GET', path, 'busy3');
      expect(third.statusCode).toBe(429);
      expect(third.json().error).toMatchObject({
        code: 'rate_limited',
        details: { reason: 'busy' },
      });
      expect(third.headers['retry-after']).toBe('5');
      release();
      expect((await one).statusCode).toBe(200);
      expect((await two).statusCode).toBe(200);
      expect((await request('GET', path, 'busy3')).statusCode).toBe(200);
    } finally {
      release();
      spy.mockRestore();
    }
  });

  it('reads the account language when the query has none', async () => {
    await request('PATCH', '/me', 'owner', { locale: 'es' });
    const res = await request(
      'GET',
      sheetPath(fixture.planIds[0], '?setups=this'),
      'owner',
      undefined,
      {
        'accept-language': 'it',
      },
    );
    expect(res.statusCode).toBe(200);
    expect((await pdfText(new Uint8Array(res.rawPayload))).toLowerCase()).toContain(
      sheetWords('es')('board.plan.name').toLowerCase(),
    );
  });
});
