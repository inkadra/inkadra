// SPDX-License-Identifier: AGPL-3.0-only
import {
  castAppearances,
  frameLabels,
  listElements,
  type Rect,
  storyboardOf,
} from '@inkadra/canvas-core';
import { aspectValue, type Element, getBoardAspect, hiddenFromGuests } from '@inkadra/doc-schema';
import type { Asset, AssetTrack, Board, CommentThread, ShotCatalogKey } from '@inkadra/shared';
import { light } from '@inkadra/ui/tokens';
import type { TFunction } from 'i18next';
import { getClassifications, shotText } from '../../lib/classifications.ts';
import { DEFAULT_ASPECT } from '../film/aspect.ts';
import {
  characterSceneCount,
  characterSubtitle,
  loadCastAppearances,
} from '../film/cast-appearances.ts';
import { getFrameStatus, isApproved } from '../film/film-status.ts';
import { croppedRotatedSize } from '../image-crop.ts';
import type { BoardStore } from '../store.ts';
import { paperAccent, type Theme } from '../theme.ts';
import {
  type Audience,
  type BoardSource,
  collectBoard,
  type ExportScope,
  exportable,
  type Placed,
} from './board-model.ts';
import {
  body,
  type CardContext,
  cardHeight,
  drawBoard,
  framePicture,
  type Palette,
  transformOps,
} from './board-render.ts';
import type { ExportCache } from './cache.ts';
import { commentEntries } from './comments.ts';
import {
  boardPage,
  commentPages,
  type DocInfo,
  type ExportKind,
  finish,
  SHOT_COLUMNS,
  type Shot,
  sectionPages,
  shotListPages,
  storyboardPages,
  titlePage,
  type Words,
} from './compose.ts';
import { fallbackHeadings, loadFonts } from './fonts.ts';
import {
  type ImageOptions,
  imageNames,
  imagePages,
  manyMode,
  ORIGINAL_IMAGE,
} from './image-format.ts';
import {
  assetMeta,
  closeImages,
  decodeImage,
  IMAGE_CONCURRENCY,
  type ImageMode,
  type LoadedImage,
  loadAssetImage,
  pool,
  variantFor,
} from './images.ts';
import type { FramesPerPage, Orientation, PaperSize } from './layout.ts';
import { noteBlocks } from './note-text.ts';
import type { Op, Page } from './pages.ts';
import { calendarDate, callSheetSections, loadPlanning, type Planning } from './planning.ts';
import { renderImages } from './render-canvas.ts';
import { renderPdf } from './render-pdf.ts';
import { chosenScenes, type Department, type SceneChoice, withoutOmitted } from './scene-choice.ts';
import { sceneSheetPages, sceneSheets } from './scene-sheets.ts';
import { logoUrl, teamPdf } from './settings.ts';
import { missingGlyphs } from './text.ts';
import { zipBlobs } from './zip.ts';

export type ExportFormat = 'pdf' | 'png' | 'jpeg';
export type ExportWhat =
  | 'board'
  | 'selection'
  | 'visible'
  | 'storyboard'
  | 'shotlist'
  | 'scenesheets';

export interface ExportRequest {
  format: ExportFormat;
  what: ExportWhat;
  paper: PaperSize;
  orientation: Orientation;
  framesPerPage: FramesPerPage;
  titlePage: boolean;
  /** The project's logo (decision 0039), or null. */
  logo: Asset | null;
  /** The project's theme (decision 0057); left out, Inter and no accent. */
  theme?: Theme | undefined;
  comments: boolean;
  audience: Audience;
  hideGuestHidden: boolean;
  /** Storyboard and shot list: only frames approved in review. */
  approvedOnly: boolean;
  /** PDF for the team: the call sheet of every shooting day, at the end. */
  callSheet: boolean;
  /** PNG and JPEG: the shape of the picture; left out, "Original". */
  image?: ImageOptions | undefined;
  /** Scene sheets (decision 0083): the department; left out, everything. */
  department?: Department | undefined;
  /** Scene sheets: which scenes; left out, all of them. */
  scenes?: SceneChoice | undefined;
  /** Scene sheets: no sheet and no continuity line for omitted scenes; left out, true. */
  leaveOutOmitted?: boolean | undefined;
}

export interface ExportEnv {
  store: BoardStore;
  selection: ReadonlySet<string>;
  /** The part of the board on screen, in board units. */
  visible: Rect | null;
  projectName: string;
  boardTitle: string;
  boards: readonly Board[] | null;
  /** Where the board is, to count the scenes of characters on its other boards too. */
  scope?: { projectId: string; boardId: string } | undefined;
  threads: readonly CommentThread[];
  /** Review status of the cards (decision 0013), for "approved frames only". */
  reviews?: ReadonlyMap<string, { status: string }> | undefined;
  t: TFunction;
  language: string;
  /** Pictures of the preview, kept while the dialog is open. */
  cache: ExportCache;
}

export interface BuiltPages {
  pages: Page[];
  images: Map<string, LoadedImage>;
  fonts: Awaited<ReturnType<typeof loadFonts>>;
  /** Characters of the content the embedded font cannot draw, a few at most. */
  missing: string[];
  /** Pictures that have no thumbnail yet: they print as an empty box. */
  notReady: number;
  /** Scene sheets: how many pages they fill. */
  sheets: number;
}

export interface ExportProgress {
  /** `files`: the original files of a selection, counted in bytes. */
  phase: 'pictures' | 'pages' | 'files';
  done: number;
  total: number;
}

export interface BuildOptions {
  /** Only the pictures of the first pages, decoded and kept in `env.cache`. */
  preview?: boolean;
  /** With `preview`: the page shown, when it is not one of the first. */
  previewPage?: number;
  /** With `preview`: how many of the first pages are shown; left out, two. */
  previewCount?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

/** Colours of the printed page: always the light theme, whatever the app shows. */
const PALETTE: Palette = light;

async function logoImage(asset: Asset, mode: ImageMode, signal?: AbortSignal) {
  try {
    const res = await fetch(logoUrl(asset), {
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return null;
    return await decodeImage(await res.blob(), mode, true);
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

/** Longest thumbnail an export uses. */
const EXPORT_PIXELS = 2048;

function thumbnailPixels(req: ExportRequest, preview: boolean): number {
  if (preview) return 512;
  if (req.what === 'shotlist' || req.what === 'scenesheets') return 512;
  if (req.what === 'storyboard') return req.framesPerPage <= 2 ? EXPORT_PIXELS : 1024;
  return EXPORT_PIXELS;
}

export function kindOf(what: ExportWhat): ExportKind {
  return what === 'storyboard' || what === 'shotlist' || what === 'scenesheets' ? what : 'board';
}

/** What the title page and the PDF's subject call the content. */
function kindLabel(kind: ExportKind, t: TFunction): string {
  if (kind === 'board') return t('export.kindBoard');
  if (kind === 'scenesheets') return t('export.whatScenesheets');
  return t(`film.views.${kind}`);
}

/** Lays out every page; with `preview`, loads only the pictures of the first pages. */
export async function buildPages(
  req: ExportRequest,
  env: ExportEnv,
  { preview = false, previewPage, previewCount = 2, signal, onProgress }: BuildOptions = {},
): Promise<BuiltPages> {
  const { store, t } = env;
  const fonts = await loadFonts(req.theme?.headingFont);
  signal?.throwIfAborted();
  const images = new Map<string, LoadedImage>();
  const mode: ImageMode = preview || req.format !== 'pdf' ? 'bitmap' : 'pdf';
  const names = preview ? env.cache.names : new Map<string, string>();
  const tracks = new Map<string, AssetTrack>();
  const exportSizes = new Map<string, { width: number; height: number }>();
  const notReady = new Set<string>();
  // Loads pictures into `images`: from the dialog's cache for the preview, else afresh.
  const load = async (ids: Iterable<string>) => {
    const todo = [...ids].filter((id) => !images.has(id));
    let done = 0;
    if (!preview && todo.length > 0) onProgress?.({ phase: 'pictures', done, total: todo.length });
    await pool(
      todo,
      IMAGE_CONCURRENCY,
      async (id) => {
        const meta = await assetMeta(id);
        if (meta) names.set(id, meta.filename);
        if (meta?.track) tracks.set(id, meta.track);
        // A GPX file's preview is the map under its route.
        if (meta?.kind === 'image' || (meta?.track && meta.variants.length > 0)) {
          const img = preview
            ? await env.cache.image(meta, pixels, signal)
            : await loadAssetImage(meta, pixels, mode, signal);
          if (img) images.set(id, img);
          else notReady.add(id);
          const variant = variantFor(meta, EXPORT_PIXELS);
          if (variant) exportSizes.set(id, variant);
        }
        done += 1;
        if (!preview) onProgress?.({ phase: 'pictures', done, total: todo.length });
      },
      signal,
    );
  };
  const snapshot = store.getSnapshot();
  const all = listElements(store.doc);
  const lookup = (id: string) => snapshot.byId.get(id);
  const filter = {
    audience: req.audience,
    hideGuestHidden: req.hideGuestHidden || req.audience === 'client',
  };
  const team = req.audience === 'team';
  const boardAspect = getBoardAspect(store.doc) ?? DEFAULT_ASPECT;
  const groupsAll = storyboardOf(all);
  // What a client export shows: only frames it may see, and nothing from other boards.
  const cast = team
    ? [
        ...castAppearances(all),
        ...(env.scope ? await loadCastAppearances(env.scope.projectId, env.scope.boardId) : []),
      ]
    : castAppearances(all.filter((el) => !hiddenFromGuests(el.id, lookup)));
  // Shot labels come from the whole board, as guests see them, before anything is left out.
  const labels = frameLabels(groupsAll);
  const preset = (catalog: ShotCatalogKey, value: string | undefined) =>
    shotText(getClassifications(), catalog, value, t);
  const slugline = (scene: Extract<Element, { type: 'scene' }>) =>
    [
      scene.setting && t(`film.scene.settings.${scene.setting}`),
      scene.location?.toUpperCase(),
      scene.time && `– ${t(`film.scene.times.${scene.time}`)}`,
    ]
      .filter(Boolean)
      .join(' ');
  const pixels = thumbnailPixels(req, preview);
  const ctx: CardContext = {
    measure: fonts.measure,
    colors: PALETTE,
    noteBlocks: (id) => noteBlocks(store.map(id)?.get('body')),
    image: (assetId) => {
      if (!assetId) return null;
      const img = images.get(assetId);
      return { key: assetId, info: img ?? { width: 4, height: 3 } };
    },
    fileName: (assetId) => names.get(assetId) ?? t('export.file'),
    track: (assetId) => tracks.get(assetId) ?? null,
    boardTitle: (boardId) => env.boards?.find((b) => b.id === boardId)?.title ?? t('export.board'),
    frameLabel: (id) => labels.get(id) ?? '',
    frameAspect: (frame) => aspectValue(frame.aspect ?? boardAspect),
    // A client or guest export leaves out a hidden base: its variants print without its Set.
    element: (id) => {
      const el = lookup(id);
      return el ? (exportable(el, lookup, filter) ?? undefined) : undefined;
    },
    frameMeta: (frame) =>
      [
        preset('shotSizes', frame.shot),
        preset('shotAngles', frame.angle),
        preset('shotMovements', frame.movement),
        frame.lens,
      ]
        .filter(Boolean)
        .join(' · '),
    slugline,
    characterLine: (el) => characterSubtitle(el, t),
    storyMeta: (el) => {
      // A character counts the same scenes here as on its card.
      const scenes =
        el.type === 'character' ? characterSceneCount(el, cast) : (el.scenes?.length ?? 0);
      return [
        el.type === 'character' ? el.actor : el.setting && t(`film.scene.settings.${el.setting}`),
        scenes > 0 ? t('story.sceneCount', { count: scenes }) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    },
    words: { board: t('export.board'), file: t('export.file'), plan: t('board.plan.name') },
  };

  const dateFormat = new Intl.DateTimeFormat(env.language, { dateStyle: 'long' });
  const kind = kindOf(req.what);
  const words: Words = {
    pageOf: (n, total) => t('export.pageOf', { n, total }),
    madeWith: t('export.madeWith'),
    scene: t('export.scene'),
    noFrames: req.approvedOnly ? t('export.noApprovedFrames') : t('export.noFrames'),
    comments: t('export.commentsTitle'),
    onBoard: t('export.onBoard'),
    onCard: (label) => t('export.onCard', { label }),
    removedCard: t('export.removedCard'),
    dialogue: t('film.frame.dialogue'),
    notes: t('film.frame.notes'),
    columns: Object.fromEntries(
      SHOT_COLUMNS.map((key) => [key, t(`export.columns.${key}`)]),
    ) as Words['columns'],
  };

  // A 16:9 page is always a landscape slide.
  const setup = {
    paper: req.paper,
    orientation: req.paper === 'slide' ? ('landscape' as const) : req.orientation,
  };
  const logo = req.logo ? await logoImage(req.logo, mode, signal) : null;
  if (logo) images.set('logo', logo);
  let content: Page[] = [];
  // A picture in a social format, or a card by itself, has no running header and footer.
  let bare = false;
  let summary = '';
  let sheetCount = 0;
  const shownIds = new Set<string>();
  // Shooting days come from the server, once per preview.
  const fetchPlanning = (): Promise<Planning> =>
    env.scope ? loadPlanning(env.scope.boardId) : Promise.resolve({ days: [] });
  const planningOnce = async () => {
    const planning = preview
      ? await env.cache.once('planning', fetchPlanning)
      : await fetchPlanning();
    signal?.throwIfAborted();
    return planning;
  };

  if (kind === 'board') {
    const scope: ExportScope =
      req.what === 'selection'
        ? { kind: 'selection', ids: env.selection }
        : req.what === 'visible' && env.visible
          ? { kind: 'visible', rect: env.visible }
          : { kind: 'board' };
    const source: BoardSource = {
      byId: snapshot.byId,
      canvas: snapshot.canvas,
      columns: snapshot.columns,
      heightOf: (el) => store.heightOf(el),
      nestedHeight: (el, w) => cardHeight(el, w, ctx),
    };
    // Pictures first: their proportions set the height of cards stacked in columns.
    const first = collectBoard(source, scope, filter);
    await load(assetIdsOf(first.items.flatMap(flatten)));
    const { items, region } = collectBoard(source, scope, filter);
    for (const item of items.flatMap(flatten)) shownIds.add(item.id);
    const count = items
      .flatMap(flatten)
      .filter((el) => el.type !== 'arrow' && el.type !== 'column' && el.type !== 'scene').length;
    summary = t('export.cards', { count });
    const empty = { x: 0, y: 0, w: 800, h: 500 };
    const asImage = req.format !== 'pdf';
    const image = req.image ?? ORIGINAL_IMAGE;
    const ids = req.what === 'selection' ? env.selection : null;
    if (asImage && ids && (ids.size === 1 || manyMode(image) === 'each')) {
      bare = true;
      const cards = selectedCards(source, ids, filter);
      await load(assetIdsOf(cards.flatMap(flatten)));
      for (const card of cards) for (const el of flatten(card)) shownIds.add(el.id);
      content = cards.map((card) =>
        cardPage(card, ctx, image.band, req.format === 'jpeg', exportSizes),
      );
    } else if (asImage && image.aspect !== 'original') {
      bare = true;
      if (region) content = [compositionPage(items, region, ctx)];
    } else if (asImage && items.length === 0) {
      bare = true;
    } else {
      content = [boardPage(asImage ? 'fit' : setup, items, region ?? empty, ctx)];
    }
  } else if (kind === 'scenesheets') {
    // The storyboard as this export may show it: scenes and frames left out for clients go, and
    // the scenes the script left out unless asked for (decision 0082).
    const kept = req.leaveOutOmitted === false ? groupsAll : withoutOmitted(groupsAll);
    const groups = kept.flatMap((group) => {
      const scene = group.scene ? exportable(group.scene, lookup, filter) : null;
      if (group.scene && scene?.type !== 'scene') return [];
      const frames = group.frames.flatMap((raw) => {
        const frame = exportable(raw, lookup, filter);
        return frame?.type === 'frame' ? [frame] : [];
      });
      return [{ scene: scene?.type === 'scene' ? scene : null, frames }];
    });
    const elements = all.flatMap((raw) => {
      if (
        raw.type !== 'character' &&
        raw.type !== 'location' &&
        raw.type !== 'plan' &&
        raw.type !== 'todo'
      )
        return [];
      const el = exportable(raw, lookup, filter);
      return el ? [el] : [];
    });
    const choice = req.scenes ?? 'all';
    // Clients get no schedule: it holds the production's call times, cast and notes.
    const { days } =
      team || choice.startsWith('day:') ? await planningOnce() : { days: [] as Planning['days'] };
    const scenes = chosenScenes(groups, choice, env.selection, days, snapshot.byId);
    const department = req.department ?? 'everything';
    const sheets = sceneSheets({
      scenes,
      groups,
      elements,
      days: team ? days : [],
      byId: snapshot.byId,
      shot: (frame, scene) => ({
        frame,
        label: labels.get(frame.id) ?? '',
        scene,
        size: preset('shotSizes', frame.shot),
        angle: preset('shotAngles', frame.angle),
        movement: preset('shotMovements', frame.movement),
      }),
      text: {
        project: env.projectName || env.boardTitle,
        slugline,
        time: (scene) =>
          [
            scene.setting && t(`film.scene.settings.${scene.setting}`),
            scene.time && t(`film.scene.times.${scene.time}`),
          ]
            .filter(Boolean)
            .join(' · '),
        day: (n, date) =>
          `${t('export.sheets.day', { n })} · ${calendarDate(date, env.language, 'short')}`,
        dayOf: (n, total, list) => t('export.sheets.dayOf', { n, total, scenes: list }),
        continuity: (name, previous, next) =>
          previous && next
            ? t('export.sheets.continuityBoth', { name, previous, next })
            : previous
              ? t('export.sheets.continuityPrevious', { name, previous })
              : t('export.sheets.continuityNext', { name, next }),
      },
    });
    for (const scene of scenes) shownIds.add(scene.id);
    for (const sheet of sheets) for (const shot of sheet.shots) shownIds.add(shot.frame.id);
    content = sceneSheetPages(setup, sheets, department, ctx, {
      department: t(`export.sheets.departments.${department}.name`),
      footer: `Inkadra · ${team ? t('export.audienceTeam') : t('export.audienceClient')}`,
      pageOf: (n, total) => t('export.sheets.pageOf', { n, total }),
      none: t('export.sheets.none'),
      call: t('export.sheets.call'),
      location: t('export.sheets.location'),
      time: t('export.sheets.time'),
      cast: t('export.sheets.cast'),
      frames: t('export.sheets.frames'),
      characters: t('export.sheets.characters'),
      inScene: t('export.sheets.inScene'),
      playedBy: (actor) => t('export.sheets.playedBy', { actor }),
      continuity: t('export.sheets.continuity'),
      setPlan: t('board.plan.name'),
      frameNotes: t('export.sheets.frameNotes'),
      light: t('export.sheets.light'),
      shootingDay: t('export.sheets.shootingDay'),
      needed: t('export.sheets.needed'),
      notes: t('export.sheets.notes'),
      production: t('export.sheets.departments.production.name'),
      columns: {
        frame: t('export.sheets.frame'),
        number: '#',
        size: t('export.columns.size'),
        angle: t('export.columns.angle'),
        movement: t('export.columns.movement'),
        lens: t('export.columns.lens'),
        notes: t('export.sheets.notes'),
      },
    });
    sheetCount = content.length;
    summary = t('export.sheets.count', { count: sheets.length });
  } else {
    const shots: Shot[] = [];
    for (const group of groupsAll) {
      // Scenes the script left out stay out of exports (decision 0082).
      if (group.scene?.omitted) continue;
      const scene = group.scene
        ? (exportable(group.scene, lookup, filter) as typeof group.scene)
        : null;
      if (group.scene && !scene) continue;
      for (const raw of group.frames) {
        const frame = exportable(raw, lookup, filter);
        if (frame?.type !== 'frame') continue;
        // The raw frame: a client export drops the approval flag with the other production fields.
        if (req.approvedOnly && !isApproved(raw, env.reviews ?? new Map())) continue;
        shownIds.add(frame.id);
        if (scene) shownIds.add(scene.id);
        shots.push({
          frame,
          label: labels.get(frame.id) ?? '',
          scene,
          size: preset('shotSizes', frame.shot),
          angle: preset('shotAngles', frame.angle),
          movement: preset('shotMovements', frame.movement),
          status: team ? t(`film.status.${getFrameStatus(frame)}`) : undefined,
        });
      }
    }
    const sceneCount = new Set(shots.map((s) => s.scene?.id).filter(Boolean)).size;
    summary = [
      t('film.total', { count: shots.length }),
      sceneCount ? t('export.scenes', { count: sceneCount }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    content =
      kind === 'storyboard'
        ? storyboardPages(setup, shots, req.framesPerPage, ctx, words, team)
        : shotListPages(setup, shots, ctx, words, team);
  }

  if (req.comments && req.format === 'pdf') {
    const entries = commentEntries(env.threads, {
      audience: req.audience,
      shown: shownIds,
      exists: (id) => snapshot.byId.has(id),
      label: (id) => {
        const el = snapshot.byId.get(id);
        return el?.type === 'frame' ? (labels.get(el.id) ?? '') : t(`board.types.${el?.type}`);
      },
      date: (iso) => dateFormat.format(new Date(iso)),
      words: {
        onBoard: words.onBoard,
        onCard: words.onCard,
        removedCard: words.removedCard,
        deleted: t('comments.deleted'),
        deletedAuthor: t('comments.deletedAuthor'),
      },
    });
    if (entries.length) content.push(...commentPages(setup, entries, ctx, words));
  }

  // Call sheets last: shooting days come from the server.
  if (req.callSheet && teamPdf(req)) {
    const planning = await planningOnce();
    planning.days.forEach((day, i) => {
      const heading = [
        t('export.callSheetTitle'),
        calendarDate(day.date, env.language, 'long'),
        t('callSheet.dayOf', { n: i + 1, total: planning.days.length }),
      ].join(' · ');
      content.push(
        ...sectionPages(
          setup,
          heading,
          callSheetSections(day, (id) => labels.get(id), t),
          ctx,
        ),
      );
    });
  }

  const info: DocInfo = {
    projectName: env.projectName,
    boardTitle: env.boardTitle,
    date: dateFormat.format(new Date()),
    kind,
    kindLabel: kindLabel(kind, t),
    summary,
    logo: logo ? { key: 'logo', width: logo.width, height: logo.height } : undefined,
    accent: req.theme ? paperAccent(req.theme.color) : undefined,
  };
  const withTitle = req.titlePage && req.format === 'pdf';
  const pages = bare
    ? content
    : finish(
        withTitle ? [titlePage(setup, info, ctx, words), ...content] : content,
        info,
        ctx,
        words,
        withTitle,
      );
  for (const page of pages) fallbackHeadings(page.ops, fonts.headingCovers);

  // Pictures of the pages that will be drawn (all of them, or the first for the preview).
  const needed = new Set<string>();
  const shown =
    preview && previewPage !== undefined
      ? pages.slice(previewPage, previewPage + 1)
      : preview
        ? pages.slice(0, previewCount)
        : pages;
  for (const page of shown) collectKeys(page.ops, needed);
  needed.delete('logo');
  try {
    await load(needed);
  } catch (err) {
    // Aborted: an export frees what it loaded; the preview's pictures stay in the cache.
    if (!preview) closeImages(images.values());
    throw err;
  }
  return {
    pages,
    images,
    fonts,
    missing: missingGlyphs(pages, fonts.covers),
    notReady: notReady.size,
    sheets: sheetCount,
  };
}

/** Space around a card without a picture, on the bands' colour. */
const CARD_MARGIN = 24;
/** Drawn when a frame has only a drawing, or a picture has no thumbnail yet. */
const UNLOADED_WIDTH = 1600;

/** The cards the selection names, each by itself; a card inside a column or scene too. */
export function selectedCards(
  source: BoardSource,
  ids: ReadonlySet<string>,
  filter: { audience: Audience; hideGuestHidden: boolean },
): Placed[] {
  const lookup = (id: string) => source.byId.get(id);
  const nested = [...ids].flatMap((id) => {
    const raw = lookup(id);
    return raw && raw.parent !== null ? [raw] : [];
  });
  const top = new Set([...ids].filter((id) => lookup(id)?.parent === null));
  const { items } = collectBoard(source, { kind: 'selection', ids: top }, filter);
  const inside = nested.flatMap((raw): Placed[] => {
    const el = exportable(raw, lookup, filter);
    if (!el) return [];
    const h = el.h ?? source.nestedHeight?.(el, el.w) ?? source.heightOf(el);
    return [{ el, x: el.x, y: el.y, w: el.w, h }];
  });
  return [...items.filter((p) => p.el.type !== 'arrow'), ...inside];
}

/**
 * One card as its own picture: an image or a frame without its caption, at the pixels of the
 * thumbnail; any other card as it prints, with a margin of the bands' colour.
 */
export function cardPage(
  card: Placed,
  ctx: CardContext,
  colour: string,
  jpeg: boolean,
  exportSizes: ReadonlyMap<string, { width: number; height: number }>,
): Page {
  const { el } = card;
  if (el.type === 'image') {
    const size = el.assetId ? exportSizes.get(el.assetId) : undefined;
    const { width, height } = croppedRotatedSize(
      size?.width ?? UNLOADED_WIDTH,
      size?.height ?? (UNLOADED_WIDTH * 3) / 4,
      el.crop,
      el.rotation,
    );
    // Under a picture with transparency: nothing in a PNG, the bands' colour in a JPEG.
    const under = jpeg ? colour : 'transparent';
    const ops = body(
      { el: { ...el, caption: undefined }, x: 0, y: 0, w: width, h: height },
      { ...ctx, colors: { ...ctx.colors, 'surface-2': under } },
    );
    return { width, height, ops, background: jpeg || !size ? colour : null, maxScale: 1 };
  }
  if (el.type === 'frame') {
    const size = el.assetId ? exportSizes.get(el.assetId) : undefined;
    const width = size?.width ?? UNLOADED_WIDTH;
    const height = width / ctx.frameAspect(el);
    // Its first operation is the picture; the rest is the rounded outline of a tile.
    const [picture] = framePicture(el, { x: 0, y: 0, w: width, h: height }, ctx);
    const ops: Op[] = picture?.kind === 'clip' ? [{ ...picture, radius: 0 }] : [];
    return { width, height, ops, background: colour, ...(size ? { maxScale: 1 } : {}) };
  }
  return {
    width: card.w + CARD_MARGIN * 2,
    height: card.h + CARD_MARGIN * 2,
    background: colour,
    ops: transformOps(drawBoard([card], ctx), 1, CARD_MARGIN - card.x, CARD_MARGIN - card.y),
  };
}

/** Several cards as one picture on the light paper of a board page, without its frame. */
function compositionPage(items: readonly Placed[], region: Rect, ctx: CardContext): Page {
  return {
    width: region.w,
    height: region.h,
    background: ctx.colors['bg-canvas'],
    ops: [
      { kind: 'rect', x: 0, y: 0, w: region.w, h: region.h, fill: ctx.colors['bg-canvas'] },
      ...transformOps(drawBoard(items, ctx), 1, -region.x, -region.y),
    ],
  };
}

export function flatten(p: { el: Element; children?: unknown[] }): Element[] {
  const kids = (p.children ?? []) as Array<{ el: Element; children?: unknown[] }>;
  return [p.el, ...kids.flatMap(flatten)];
}

function assetIdsOf(elements: readonly Element[]): Set<string> {
  const ids = new Set<string>();
  for (const el of elements) {
    if (el.type === 'image' || el.type === 'file' || el.type === 'frame') {
      if (el.assetId) ids.add(el.assetId);
    }
    if ((el.type === 'link' || el.type === 'map') && el.imageAssetId) ids.add(el.imageAssetId);
  }
  return ids;
}

function collectKeys(ops: readonly Op[], into: Set<string>) {
  for (const op of ops) {
    if (op.kind === 'image') into.add(op.key);
    if (op.kind === 'clip') collectKeys(op.ops, into);
  }
}

/** What an export's files are called, without the extension. */
export function exportBaseName(env: Pick<ExportEnv, 'boardTitle' | 'projectName'>): string {
  return (env.boardTitle || env.projectName || 'inkadra').replace(/[\\/:*?"<>|]/g, '_').trim();
}

/** The finished file and the name to download it under. */
export async function exportFile(
  req: ExportRequest,
  env: ExportEnv,
  options: Omit<BuildOptions, 'preview'> = {},
): Promise<{ blob: Blob; name: string }> {
  const { signal, onProgress } = options;
  const { pages, images, fonts } = await buildPages(req, env, options);
  const base = exportBaseName(env);
  const pageProgress = (done: number) =>
    onProgress?.({ phase: 'pages', done, total: pages.length });
  try {
    if (req.format !== 'pdf') {
      const out = imagePages(pages, req.image ?? ORIGINAL_IMAGE);
      // One image per page: stacking them squeezed a long storyboard into an unreadable strip.
      const blobs = await renderImages(out.pages, out.scales, images, {
        ...(signal ? { signal } : {}),
        onPage: pageProgress,
        heading: fonts.headingFamily,
        format: req.format,
      });
      const names = imageNames(base, blobs.length, req.format);
      if (blobs.length === 1) return { blob: blobs[0] as Blob, name: names[0] as string };
      const blob = await zipBlobs(blobs.map((b, n) => ({ blob: b, name: names[n] as string })));
      return { blob, name: `${base}.zip` };
    }
    const bytes = await renderPdf(
      pages,
      fonts.bytes,
      images,
      {
        title: env.boardTitle || env.projectName,
        author: env.projectName,
        subject: kindLabel(kindOf(req.what), env.t),
        language: env.language,
      },
      { ...(signal ? { signal } : {}), onPage: pageProgress },
    );
    return {
      blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      name: `${base}.pdf`,
    };
  } finally {
    closeImages(images.values());
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
