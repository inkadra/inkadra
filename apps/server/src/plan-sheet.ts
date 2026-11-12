import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  frameLabels,
  PLAN_WORDS_EN,
  type PlanElement,
  planTitle,
  roomSizeText,
  type ScheduledDay,
  SHEET_WORDS_EN,
  storyboardOf,
  variantFamily,
  variantView,
  type Words,
  wordsFrom,
} from '@inkadra/canvas-core';
import { PLAN_WORDS_DE, SHEET_WORDS_DE } from '@inkadra/canvas-core/plan-words/de';
import { PLAN_WORDS_ES, SHEET_WORDS_ES } from '@inkadra/canvas-core/plan-words/es';
import { PLAN_WORDS_FR, SHEET_WORDS_FR } from '@inkadra/canvas-core/plan-words/fr';
import { PLAN_WORDS_IT, SHEET_WORDS_IT } from '@inkadra/canvas-core/plan-words/it';
import { PLAN_WORDS_PT, SHEET_WORDS_PT } from '@inkadra/canvas-core/plan-words/pt';
import { Element } from '@inkadra/doc-schema';
import {
  type Audience,
  audienceCards,
  type FontWeight,
  greyPixels,
  type Measure,
  type Op,
  type Page,
  type PlanSheetInclude,
  planSheetInputOf,
  planSheetPages,
  sheetInclude,
} from '@inkadra/print';
import { measureFrom } from '@inkadra/print/measure';
import { type PdfImage, renderPdf } from '@inkadra/print/pdf';
import { PlanSheetLanguage, PlanSheetPart } from '@inkadra/shared';
import { light } from '@inkadra/ui/tokens';
import sharp from 'sharp';
import { HttpError } from './http/errors.ts';
import { type BoardView, guestElement } from './share-links.ts';

/**
 * The set plan's sheet as a PDF on the server (decision 0122): the web export's pipeline, from the
 * same packages, on the cards a member or a guest may see. The routes are in
 * `http/plan-sheet-routes.ts`.
 */

/** Setups one sheet prints at most; a larger family is exported with `setups=this`. */
export const MAX_SHEET_SETUPS = 20;
/** Thumbnail width the sheet's pictures use, as the web export (`EXPORT_PIXELS`). */
export const SHEET_PICTURE_PIXELS = 2048;
/** Pixels sharp decodes at most from one thumbnail. */
const MAX_PICTURE_PIXELS = 4096 * 4096;

const CATALOGUES: Record<PlanSheetLanguage, object> = {
  en: { ...PLAN_WORDS_EN, ...SHEET_WORDS_EN },
  it: { ...PLAN_WORDS_IT, ...SHEET_WORDS_IT },
  es: { ...PLAN_WORDS_ES, ...SHEET_WORDS_ES },
  de: { ...PLAN_WORDS_DE, ...SHEET_WORDS_DE },
  fr: { ...PLAN_WORDS_FR, ...SHEET_WORDS_FR },
  pt: { ...PLAN_WORDS_PT, ...SHEET_WORDS_PT },
};

/** The sheet's words in `language`, English where a word is missing (as the app's fallback). */
export function sheetWords(language: PlanSheetLanguage): Words {
  return wordsFrom(
    language,
    language === 'en' ? [CATALOGUES.en] : [CATALOGUES[language], CATALOGUES.en],
  );
}

/** One of the six languages for a tag ("it", "pt-BR"), else undefined. */
function appLanguage(tag: string | null | undefined): PlanSheetLanguage | undefined {
  const parsed = PlanSheetLanguage.safeParse(tag?.trim().split(/[-_]/)[0]?.toLowerCase());
  return parsed.success ? parsed.data : undefined;
}

/**
 * The language of the sheet (decision 0122): the query's, then the account's, then the first of
 * the six in `Accept-Language` by preference, then English.
 */
export function sheetLanguage(
  asked: PlanSheetLanguage | undefined,
  account: string | null | undefined,
  acceptLanguage: string | undefined,
): PlanSheetLanguage {
  if (asked) return asked;
  const own = appLanguage(account);
  if (own) return own;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .slice(0, 20)
    .map((part, index) => {
      const [tag = '', ...params] = part.split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { tag, q: q === undefined ? 1 : Number(q), index };
    })
    .filter((item) => item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const language = appLanguage(tag);
    if (language) return language;
  }
  return 'en';
}

/** What the sheet is drawn from: the cards its audience may see, by id. */
export interface SheetSource {
  cards: ReadonlyMap<string, Element>;
  /** The storyboard's shot labels, of the whole board (as guests see them). */
  labels: ReadonlyMap<string, string>;
  /** The board's shooting days; none for guests. */
  days: readonly ScheduledDay[];
}

/**
 * A member's source: the cards of the whole board for the team, those guests see for a client
 * copy (`audienceCards`, as the web export), the labels of the whole board, and the days.
 */
export function memberSheetSource(
  elements: readonly Element[],
  audience: Audience,
  days: readonly ScheduledDay[],
): SheetSource {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const cards = audienceCards(elements, (id) => byId.get(id), {
    audience,
    hideGuestHidden: audience === 'client',
  });
  return { cards, labels: frameLabels(storyboardOf(elements)), days };
}

/**
 * A guest's source: the cards the link shows (`shown`), as guests receive them (`guestElement`
 * drops a plan's links to cards they cannot see, decision 0111), the board's labels, no days.
 */
export function guestSheetSource(view: BoardView, shown: readonly Element[]): SheetSource {
  const cards = new Map<string, Element>();
  for (const el of shown) {
    const parsed = Element.safeParse(guestElement(view, el));
    if (parsed.success) cards.set(parsed.data.id, parsed.data);
  }
  return { cards, labels: view.labels, days: [] };
}

/** What a client asked for, its query read and its language resolved. */
export interface SheetAsk {
  planId: string;
  setups: 'this' | 'all';
  /** The parts to print; undefined: those the plan saved. */
  include: ReadonlySet<PlanSheetPart> | undefined;
  language: PlanSheetLanguage;
  audience: Audience;
}

export interface SheetLayout {
  pages: Page[];
  /** The PDF's title and file name: "Set plan · Bancone". */
  title: string;
  t: Words;
  /** Asset ids of the pictures on the pages. */
  pictures: string[];
}

/** The parts of the query as the sheet reads them. */
function includeOf(parts: ReadonlySet<PlanSheetPart>): PlanSheetInclude {
  return Object.fromEntries(
    PlanSheetPart.options.map((p) => [p, parts.has(p)]),
  ) as unknown as PlanSheetInclude;
}

/** Asset ids of the `image` operations, inside clips too. */
function pictureKeys(pages: readonly Page[]): string[] {
  const keys = new Set<string>();
  const walk = (ops: readonly Op[]) => {
    for (const op of ops) {
      if (op.kind === 'image') keys.add(op.key);
      else if (op.kind === 'clip') walk(op.ops);
    }
  };
  for (const page of pages) walk(page.ops);
  return [...keys];
}

/**
 * The pages of the sheet as the web's "PDF" lays them out: the plan and, with `setups=all`, its
 * family (base first); each setup as drawn over its base. 404 when the plan is not among the
 * cards, 400 for a family of more than 20 setups.
 */
export function planSheetLayout(source: SheetSource, ask: SheetAsk, measure: Measure): SheetLayout {
  const { cards } = source;
  const plan = cards.get(ask.planId);
  if (plan?.type !== 'plan') throw new HttpError('not_found', 'Set plan not found.');
  const family = variantFamily(cards.values(), plan);
  const planIds = ask.setups === 'all' ? family.map((p) => p.id) : [plan.id];
  if (planIds.length > MAX_SHEET_SETUPS)
    throw new HttpError(
      'bad_request',
      `This plan has ${planIds.length} setups, more than ${MAX_SHEET_SETUPS} on one sheet: export it with setups=this.`,
    );
  const base = plan.variantOf ? cards.get(plan.variantOf) : undefined;
  const baseOf = base?.type === 'plan' ? base : undefined;
  // The background belongs to the base's Set: a setup prints its base's (decision 0110).
  const include = ask.include ? includeOf(ask.include) : sheetInclude(baseOf ?? plan);
  const t = sheetWords(ask.language);
  const input = planSheetInputOf({
    cards,
    labels: source.labels,
    planIds,
    area: null,
    include,
    t,
    locale: ask.language,
    days: source.days,
    audience: ask.audience,
  });
  const pages = planSheetPages(input, {
    measure,
    colors: light,
    language: ask.language,
    roomSize: (length, scale, overall) => roomSizeText(length, scale, overall, t, ask.language),
    cards,
  });
  // Named as the plan is shown: a setup with its base's title (decision 0117).
  const shown: PlanElement = baseOf ? variantView(plan, baseOf) : plan;
  return { pages, title: planTitle(t, shown), t, pictures: pictureKeys(pages) };
}

/** The web's file name of the export: its title without the characters files cannot have. */
export function sheetFileName(title: string): string {
  return `${(title || 'inkadra').replace(/[\\/:*?"<>|]/g, '_').trim()}.pdf`;
}

// Fonts ----------------------------------------------------------------------------------

const require = createRequire(import.meta.url);
/** The files of Inter the web's `fonts.ts` loads (Latin Extended and Cyrillic, decision 0038). */
const INTER = {
  400: '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
  500: '@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
  600: '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
  700: '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
} as const;

export interface SheetFonts {
  bytes: Record<FontWeight, Uint8Array>;
  measure: Measure;
}

let fonts: Promise<SheetFonts> | null = null;

/** Inter, read once per process, with its measure; headings in Inter 600 as on the web. */
export function sheetFonts(): Promise<SheetFonts> {
  fonts ??= Promise.all(
    ([400, 500, 600, 700] as const).map(
      async (w) => [w, new Uint8Array(await readFile(require.resolve(INTER[w])))] as const,
    ),
  )
    .then((entries) => {
      const inter = Object.fromEntries(entries) as Record<400 | 500 | 600 | 700, Uint8Array>;
      const bytes = { ...inter, heading: inter[600] };
      return { bytes, measure: measureFrom(bytes) };
    })
    .catch((err: unknown) => {
      fonts = null;
      throw err;
    });
  return fonts;
}

// Pictures -------------------------------------------------------------------------------

/**
 * A thumbnail as the PDF takes it, as the web's `decodeImage`: on white, then JPEG at 90.
 * Null when it cannot be read: the sheet goes without the picture, as on the web.
 */
export async function sheetPicture(bytes: Uint8Array): Promise<PdfImage | null> {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: MAX_PICTURE_PIXELS })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, bytes: new Uint8Array(data), type: 'jpeg' };
  } catch {
    return null;
  }
}

/** The raw RGBA pixels of a picture in greys, with the shared `greyPixels` (R = G = B). */
export async function greyRaw(bytes: Uint8Array) {
  const { data, info } = await sharp(bytes, { limitInputPixels: MAX_PICTURE_PIXELS })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  greyPixels(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength));
  return { data, width: info.width, height: info.height };
}

/** The grey copy of a picture the PDF asks for (`renderPdf`'s `grey`), as JPEG at 90. */
export async function greyPicture(img: PdfImage): Promise<PdfImage | null> {
  if (!img.bytes) return null;
  try {
    const { data, width, height } = await greyRaw(img.bytes);
    const out = await sharp(data, { raw: { width, height, channels: 4 } })
      .removeAlpha()
      .jpeg({ quality: 90 })
      .toBuffer();
    return { ...img, bytes: new Uint8Array(out), type: 'jpeg' };
  } catch {
    return null;
  }
}

/** The PDF of the laid-out sheet, with its pictures (missing ones left out). */
export async function sheetPdf(
  layout: SheetLayout,
  images: ReadonlyMap<string, PdfImage>,
  language: PlanSheetLanguage,
  signal?: AbortSignal,
  grey: (img: PdfImage) => Promise<PdfImage | null> = greyPicture,
): Promise<Uint8Array> {
  const { bytes } = await sheetFonts();
  return renderPdf(
    layout.pages,
    bytes,
    images,
    { title: layout.title, author: '', subject: layout.t('export.kindBoard'), language },
    { grey, ...(signal ? { signal } : {}) },
  );
}
