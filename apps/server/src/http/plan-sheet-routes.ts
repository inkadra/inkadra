import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { listElements, type ScheduledDay } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { PdfImage } from '@inkadra/print/pdf';
import {
  API_PREFIX,
  ElementRef,
  GuestPlanSheetQuery,
  Id,
  PlanSheetQuery,
  z,
} from '@inkadra/shared';
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as Y from 'yjs';
import { requireBoardRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import { VERSION } from '../config.ts';
import type { Database } from '../db/client.ts';
import { asset, assetVariant, boardDoc, user } from '../db/schema.ts';
import {
  guestSheetSource,
  memberSheetSource,
  planSheetLayout,
  SHEET_PICTURE_PIXELS,
  type SheetAsk,
  type SheetSource,
  sheetFileName,
  sheetFonts,
  sheetLanguage,
  sheetPdf,
  sheetPicture,
} from '../plan-sheet.ts';
import { daysOfBoard } from '../production.ts';
import type { Storage } from '../storage.ts';
import { contentDisposition, fileHeaders, isThumbnail } from './assets-routes.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import type { GuestContext } from './guest-context.ts';
import { RateLimiter } from './link-previews.ts';

/** The set plan's sheet as a PDF (decision 0122): a member's route and a guest's. */

/** Sheets one account or guest may ask for in a minute. */
const SHEETS_PER_MINUTE = 10;
/** Sheets this process renders at once; a third is told to come back. */
const MAX_RUNNING_SHEETS = 2;
/** Seconds a client waits when the server is busy. */
const BUSY_RETRY_SECONDS = 5;
/** A render stops after this long. */
const RENDER_TIMEOUT_MS = 20_000;

const PlanParams = z.object({ boardId: Id, planId: ElementRef });

interface Deps {
  db: Database;
  auth: Auth;
  storage: Storage;
}

/** Whether `If-None-Match` names the tag. */
function matchesEtag(header: string | undefined, version: string) {
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, '').replace(/^"|"$/g, ''))
    .some((t) => t === version || t === '*');
}

/** A thumbnail the sheet prints: the asset, the variant chosen and its row's version. */
interface Picture {
  assetId: string;
  storageKey: string;
  revision: string;
}

export function createPlanSheets(deps: Deps) {
  const { db, storage } = deps;
  const sheets = new RateLimiter(SHEETS_PER_MINUTE, 60_000, 'plan-sheet-routes:sheets');
  let running = 0;

  /**
   * The thumbnails of the pictures on the sheet, as the web picks them (`variantFor`): the
   * smallest at least 2048 px wide, else the largest, of ready files of the project only; a
   * guest's only among those the link shows.
   */
  async function pictures(
    ids: readonly string[],
    projectId: string,
    allowed: ReadonlySet<string> | null,
  ): Promise<Picture[]> {
    const wanted = ids.filter((id) => Id.safeParse(id).success && (!allowed || allowed.has(id)));
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ id: asset.id, kind: asset.kind, track: asset.track })
      .from(asset)
      .where(
        and(inArray(asset.id, wanted), eq(asset.projectId, projectId), eq(asset.status, 'ready')),
      );
    if (rows.length === 0) return [];
    const variants = await db
      .select({ ...getTableColumns(assetVariant), revision: sql<string>`xmin::text` })
      .from(assetVariant)
      .where(
        inArray(
          assetVariant.assetId,
          rows.map((r) => r.id),
        ),
      );
    const out: Picture[] = [];
    for (const id of wanted) {
      const row = rows.find((r) => r.id === id);
      const own = variants.filter((v) => v.assetId === id && isThumbnail(v));
      // As the web: pictures, and the map under a GPX file's route.
      if (!row || (row.kind !== 'image' && !(row.track && own.length > 0))) continue;
      const sorted = own.sort((a, b) => a.width - b.width);
      const chosen = sorted.find((v) => v.width >= SHEET_PICTURE_PIXELS) ?? sorted.at(-1);
      if (chosen)
        out.push({ assetId: id, storageKey: chosen.storageKey, revision: chosen.revision });
    }
    return out;
  }

  /**
   * Lays out, tags and renders a sheet once the caller's access is checked: the limits of
   * decision 0122, then a 304 for a tag the client has, else the PDF.
   */
  async function send(
    req: FastifyRequest,
    reply: FastifyReply,
    sheet: {
      /** Who is counted against the limit of 10 a minute. */
      who: string;
      boardId: string;
      projectId: string;
      source: SheetSource;
      ask: SheetAsk;
      /** What the tag is made of besides the sheet: the document's and the link's versions. */
      versions: unknown[];
      /** For guests: the files the link shows. */
      allowed: ReadonlySet<string> | null;
    },
  ) {
    // No such plan, a card that is not one, or one this audience cannot see: 404, before limits.
    if (sheet.source.cards.get(sheet.ask.planId)?.type !== 'plan')
      throw new HttpError('not_found', 'Set plan not found.');
    if (running >= MAX_RUNNING_SHEETS)
      throw new HttpError(
        'rate_limited',
        'The server is busy with other sheets: try again in a few seconds.',
        { reason: 'busy' },
        BUSY_RETRY_SECONDS,
      );
    await sheets.require(sheet.who, 'Too many sheets: wait a minute.');
    running += 1;
    const signal = AbortSignal.timeout(RENDER_TIMEOUT_MS);
    try {
      const { measure } = await sheetFonts();
      const layout = planSheetLayout(sheet.source, sheet.ask, measure);
      const chosen = await pictures(layout.pictures, sheet.projectId, sheet.allowed);
      const { ask } = sheet;
      const etag = createHash('sha256')
        .update(
          JSON.stringify([
            VERSION,
            sheet.boardId,
            ask.planId,
            ask.setups,
            ask.include ? [...ask.include].sort() : null,
            ask.language,
            ask.audience,
            // "Day N" follows the schedule, which the document's version does not.
            sheet.source.days,
            chosen,
            ...sheet.versions,
          ]),
        )
        .digest('hex');
      fileHeaders(reply, etag);
      // Access is checked on every request, so a copy is checked before it is used again.
      reply.header('cache-control', 'private, no-cache');
      reply.header('x-content-type-options', 'nosniff');
      if (matchesEtag(req.headers['if-none-match'], etag)) return reply.status(304).send();
      const images = new Map<string, PdfImage>();
      for (const picture of chosen) {
        signal.throwIfAborted();
        const img = await storage
          .read(picture.storageKey)
          .then(buffer)
          .then((bytes) => sheetPicture(bytes))
          .catch(() => null);
        if (img) images.set(picture.assetId, img);
      }
      const pdf = await sheetPdf(layout, images, ask.language, signal);
      reply.header('content-type', 'application/pdf');
      reply.header(
        'content-disposition',
        contentDisposition('attachment', sheetFileName(layout.title)),
      );
      return reply.send(Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength));
    } catch (err) {
      if (signal.aborted && !(err instanceof HttpError)) {
        req.log.error(
          { boardId: sheet.boardId, planId: sheet.ask.planId },
          'set plan sheet timed out',
        );
        throw new HttpError('internal', 'The sheet took too long to make.');
      }
      throw err;
    } finally {
      running -= 1;
    }
  }

  /** The stored document's version, for the tag. */
  async function docStamp(boardId: string) {
    const [row] = await db
      .select({ updatedAt: boardDoc.updatedAt })
      .from(boardDoc)
      .where(eq(boardDoc.boardId, boardId));
    return row?.updatedAt.getTime() ?? null;
  }

  return {
    /** A member's sheet: every card for the team with "Day N", the guests' cards for clients. */
    async member(req: FastifyRequest, reply: FastifyReply) {
      const actor = await requireActor(deps.auth, req, db);
      const { boardId, planId } = PlanParams.parse(req.params);
      const access = await requireBoardRole(db, actor, boardId, 'viewer');
      const query = PlanSheetQuery.parse(req.query ?? {});
      const [account] = await db
        .select({ locale: user.locale })
        .from(user)
        .where(eq(user.id, actor.id));
      const [row] = await db
        .select({ state: boardDoc.state, updatedAt: boardDoc.updatedAt })
        .from(boardDoc)
        .where(eq(boardDoc.boardId, boardId));
      let elements: Element[] = [];
      if (row) {
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, row.state);
          elements = listElements(doc);
        } finally {
          doc.destroy();
        }
      }
      const team = query.audience === 'team';
      // The schedule's days as it shows them to this member (decision 0092): dates and blocks,
      // the Production board's when the project has one (decision 0123).
      const days: ScheduledDay[] = team
        ? await daysOfBoard(db, actor, access.board.projectId, boardId)
        : [];
      return send(req, reply, {
        who: `user:${actor.id}`,
        boardId,
        projectId: access.board.projectId,
        source: memberSheetSource(elements, query.audience, days),
        ask: {
          planId,
          setups: query.setups,
          include: query.include,
          language: sheetLanguage(query.lang, account?.locale, req.headers['accept-language']),
          audience: query.audience,
        },
        versions: [row?.updatedAt.getTime() ?? null],
        allowed: null,
      });
    },

    /**
     * A guest's sheet, once the link and the board are checked: the cards the link shows as
     * guests receive them, the board's labels, never "Day N" (decisions 0111, 0122).
     */
    async guest(req: FastifyRequest, reply: FastifyReply, ctx: GuestContext, boardId: string) {
      const { planId } = PlanParams.parse(req.params);
      const shown = ctx.shown.get(boardId) ?? [];
      // A plan hidden from guests is not shown: 404, as any card guests cannot see.
      if (shown.find((el) => el.id === planId)?.type !== 'plan')
        throw new HttpError('not_found', 'Card not found.');
      const query = GuestPlanSheetQuery.parse(req.query ?? {});
      const view = ctx.views.get(boardId);
      if (!view) throw new HttpError('not_found', 'Card not found.');
      return send(req, reply, {
        who: `guest:${ctx.guest.id}`,
        boardId,
        projectId: ctx.link.projectId,
        source: guestSheetSource(view, shown),
        ask: {
          planId,
          setups: query.setups,
          include: query.include,
          language: sheetLanguage(query.lang, null, req.headers['accept-language']),
          audience: 'client',
        },
        versions: [await docStamp(boardId), ctx.link.updatedAt.getTime()],
        allowed: ctx.assets.shown,
      });
    },
  };
}

export type PlanSheets = ReturnType<typeof createPlanSheets>;

export function registerPlanSheetRoutes(app: FastifyInstance, sheets: PlanSheets) {
  app.get(`${API_PREFIX}/boards/:boardId/plans/:planId/sheet`, (req, reply) =>
    sheets.member(req, reply),
  );
}
