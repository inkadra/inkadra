// SPDX-License-Identifier: AGPL-3.0-only
import {
  castAppearances,
  formatDuration,
  frameLabels,
  listElements,
  type Rect,
  storyboardOf,
  totalDurationMs,
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
import type { BoardStore } from '../store.ts';
import { paperAccent, type Theme } from '../theme.ts';
import {
  type Audience,
  type BoardSource,
  collectBoard,
  type ExportScope,
  exportable,
} from './board-model.ts';
import { type CardContext, cardHeight, type Palette } from './board-render.ts';
import type { ExportCache } from './cache.ts';
import { commentEntries } from './comments.ts';
import {
  boardPage,
  commentPages,
  type DocInfo,
  type ExportKind,
  finish,
  type Section,
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
  assetMeta,
  closeImages,
  decodeImage,
  IMAGE_CONCURRENCY,
  type ImageMode,
  type LoadedImage,
  loadAssetImage,
  pool,
} from './images.ts';
import { type FramesPerPage, type Orientation, type PaperSize, pngScales } from './layout.ts';
import { noteBlocks } from './note-text.ts';
import type { Op, Page } from './pages.ts';
import {
  calendarDate,
  callSheetSections,
  kickoffSections,
  loadPlanning,
  type Planning,
} from './planning.ts';
import { renderPngPages } from './render-canvas.ts';
import { renderPdf } from './render-pdf.ts';
import { logoUrl, teamPdf } from './settings.ts';
import { missingGlyphs } from './text.ts';
import { zipBlobs } from './zip.ts';

export type ExportFormat = 'pdf' | 'png';
export type ExportWhat = 'board' | 'selection' | 'visible' | 'storyboard' | 'shotlist';

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
  /** PDF for the team: the kickoff summary after the title page. */
  kickoffSummary: boolean;
  /** PDF for the team: the call sheet of every shooting day, at the end. */
  callSheet: boolean;
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
}

export interface ExportProgress {
  phase: 'pictures' | 'pages';
  done: number;
  total: number;
}

export interface BuildOptions {
  /** Only the pictures of the first pages, decoded and kept in `env.cache`. */
  preview?: boolean;
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

function thumbnailPixels(req: ExportRequest, preview: boolean): number {
  if (preview) return 512;
  if (req.what === 'shotlist') return 512;
  if (req.what === 'storyboard') return req.framesPerPage <= 2 ? 2048 : 1024;
  return 2048;
}

export function kindOf(what: ExportWhat): ExportKind {
  return what === 'storyboard' || what === 'shotlist' ? what : 'board';
}

/** Lays out every page; with `preview`, loads only the pictures of the first pages. */
export async function buildPages(
  req: ExportRequest,
  env: ExportEnv,
  { preview = false, signal, onProgress }: BuildOptions = {},
): Promise<BuiltPages> {
  const { store, t } = env;
  const fonts = await loadFonts(req.theme?.headingFont);
  signal?.throwIfAborted();
  const images = new Map<string, LoadedImage>();
  const mode: ImageMode = preview || req.format === 'png' ? 'bitmap' : 'pdf';
  const names = preview ? env.cache.names : new Map<string, string>();
  const tracks = new Map<string, AssetTrack>();
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
  const seconds = (ms: number | undefined) => (ms ? `${Math.round(ms / 100) / 10} s` : '');
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
        seconds(frame.durationMs),
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
  let summary = '';
  const shownIds = new Set<string>();

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
    content = [boardPage(req.format === 'png' ? 'fit' : setup, items, region ?? empty, ctx)];
  } else {
    const shots: Shot[] = [];
    for (const group of groupsAll) {
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
          duration: seconds(frame.durationMs),
          status: team ? t(`film.status.${getFrameStatus(frame)}`) : undefined,
        });
      }
    }
    const sceneCount = new Set(shots.map((s) => s.scene?.id).filter(Boolean)).size;
    summary = [
      t('film.total', {
        count: shots.length,
        duration: formatDuration(totalDurationMs(shots.map((s) => s.frame))),
      }),
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

  // Kickoff summary first, call sheets last: shooting days and people come from the server.
  const withSummary = req.kickoffSummary && teamPdf(req);
  const withSheets = req.callSheet && teamPdf(req);
  if (withSummary || withSheets) {
    const fetchPlanning = (): Promise<Planning> =>
      env.scope
        ? loadPlanning(env.scope.projectId, env.scope.boardId)
        : Promise.resolve({ days: [], members: [] });
    const planning = preview
      ? await env.cache.once('planning', fetchPlanning)
      : await fetchPlanning();
    signal?.throwIfAborted();
    if (withSummary) {
      const todos = all.flatMap((raw) => {
        const el = exportable(raw, lookup, filter);
        return el?.type === 'todo' ? [el] : [];
      });
      const sections: Section[] = kickoffSections(planning, todos, t, env.language);
      content.unshift(...sectionPages(setup, t('export.kickoff.title'), sections, ctx));
    }
    if (withSheets) {
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
  }

  const info: DocInfo = {
    projectName: env.projectName,
    boardTitle: env.boardTitle,
    date: dateFormat.format(new Date()),
    kind,
    kindLabel: kind === 'board' ? t('export.kindBoard') : t(`film.views.${kind}`),
    summary,
    logo: logo ? { key: 'logo', width: logo.width, height: logo.height } : undefined,
    accent: req.theme ? paperAccent(req.theme.color) : undefined,
  };
  const withTitle = req.titlePage && req.format === 'pdf';
  const pages = finish(
    withTitle ? [titlePage(setup, info, ctx, words), ...content] : content,
    info,
    ctx,
    words,
    withTitle,
  );
  for (const page of pages) fallbackHeadings(page.ops, fonts.headingCovers);

  // Pictures of the pages that will be drawn (all of them, or the first for the preview).
  const needed = new Set<string>();
  for (const page of preview ? pages.slice(0, 2) : pages) collectKeys(page.ops, needed);
  needed.delete('logo');
  try {
    await load(needed);
  } catch (err) {
    // Aborted: an export frees what it loaded; the preview's pictures stay in the cache.
    if (!preview) closeImages(images.values());
    throw err;
  }
  return { pages, images, fonts, missing: missingGlyphs(pages, fonts.covers) };
}

function flatten(p: { el: Element; children?: unknown[] }): Element[] {
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

/** The finished file and the name to download it under. */
export async function exportFile(
  req: ExportRequest,
  env: ExportEnv,
  options: Omit<BuildOptions, 'preview'> = {},
): Promise<{ blob: Blob; name: string }> {
  const { signal, onProgress } = options;
  const { pages, images, fonts } = await buildPages(req, env, options);
  const base = (env.boardTitle || env.projectName || 'inkadra')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  const pageProgress = (done: number) =>
    onProgress?.({ phase: 'pages', done, total: pages.length });
  try {
    if (req.format === 'png') {
      // One image per page: stacking them squeezed a long storyboard into an unreadable strip.
      const blobs = await renderPngPages(pages, pngScales(pages).scales, images, {
        ...(signal ? { signal } : {}),
        onPage: pageProgress,
        heading: fonts.headingFamily,
      });
      if (blobs.length === 1) return { blob: blobs[0] as Blob, name: `${base}.png` };
      const blob = await zipBlobs(
        blobs.map((b, n) => ({ blob: b, name: `${base}-${String(n + 1).padStart(3, '0')}.png` })),
      );
      return { blob, name: `${base}.zip` };
    }
    const bytes = await renderPdf(
      pages,
      fonts.bytes,
      images,
      {
        title: env.boardTitle || env.projectName,
        author: env.projectName,
        subject:
          kindOf(req.what) === 'board'
            ? env.t('export.kindBoard')
            : env.t(`film.views.${kindOf(req.what)}`),
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
