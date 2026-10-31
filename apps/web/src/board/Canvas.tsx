import {
  type Alignment,
  type ArrowElement,
  type ArrowGeometry,
  addScene,
  alignRects,
  applyTemplate,
  arrowBox,
  arrowEnds,
  arrowGeometry,
  boundsOf,
  bringToFront,
  centerOn,
  containsPoint,
  copyElements,
  createArrow,
  createElement,
  DEFAULT_WIDTH,
  deleteElements,
  distributeRects,
  dropIndex,
  fitRect,
  frameLabels,
  type Guide,
  inflate,
  intersects,
  isContainer,
  listElements,
  moveArrows,
  moveIntoParent,
  moveToCanvas,
  moveToUnsorted,
  nextZoomStep,
  type Point,
  pasteElements,
  pinchViewport,
  type Rect,
  type ResizeCorner,
  type ResizeOptions,
  rectFromPoints,
  refreshArrows,
  resizeFromCorner,
  screenToWorld,
  sendToBack,
  snapRect,
  storyboardOf,
  TEMPLATE_IDS,
  type TemplateId,
  updateElement,
  updateElements,
  type Viewport,
  visibleWorld,
  worldToScreen,
  zoomAt,
} from '@inkadra/canvas-core';
import { type Element, UNSORTED } from '@inkadra/doc-schema';
import type { Board } from '@inkadra/shared';
import type { Editor } from '@tiptap/react';
import {
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import * as Y from 'yjs';
import { addActions, useRegisterActions } from '../commands/actions.ts';
import { canvasActions, duplicateInStore } from '../commands/board-actions.ts';
import { useSession } from '../lib/session.tsx';
import { queueSeeds } from '../routes/seed-queue.tsx';
import { accessNotices } from './access-notices.ts';
import { ArrowLayer, ArrowStyleButtons, onArrowStyleButton } from './arrows.tsx';
import { canRenameBoard, createBoard, setBoardCover } from './boards.ts';
import {
  type CanvasTemplate,
  createCanvasBoards,
  isStoryboardTemplate,
} from './canvas-templates.ts';
import { Card } from './cards.tsx';
import {
  BarButton,
  type CanvasTool,
  CommandPalette,
  ContextBar,
  ContextMenu,
  type MenuItem,
  Minimap,
  TOOL_MIME,
  TOOLS,
  Toast,
  Toolbar,
  type ToolType,
  UnsortedDrawer,
  UploadPanel,
  ZoomControls,
} from './chrome.tsx';
import { decodeClipboard, encodeClipboard } from './clipboard.ts';
import type { BoardConnection } from './connection.ts';
import { BoardContext, type BoardContextValue, GuestModeContext, LARGE_BOARD } from './context.ts';
import { useBoardAspect } from './film/aspect.ts';
import { DrawingEditor } from './film/DrawingEditor.tsx';
import { FramePanel } from './film/FramePanel.tsx';
import { StoryCardPanel } from './film/StoryCardPanel.tsx';
import { createScreenplayStoryboard } from './film/screenplay/new-storyboard.ts';
import type { ImportPlan } from './film/screenplay/plan.ts';
import { ScreenplayImportDialog } from './film/screenplay/ScreenplayImportDialog.tsx';
import { viewableInOrder } from './gallery.ts';
import { toggleGuestHidden } from './guest-visibility.tsx';
import { ImageCropToolbar, restoreOriginalImage } from './ImageCropEditor.tsx';
import { hasImageTransform } from './image-crop.ts';
import { fillLinkPreview, webUrl } from './links.ts';
import { NoteSideSheet } from './NoteSideSheet.tsx';
import { fillFragment, isEmpty } from './note.tsx';
import { PresenceLayer } from './PresenceLayer.tsx';
import { type Peer, useLocalPresence } from './presence.ts';
import { canvasElementId, ResizeHandles } from './ResizeHandles.tsx';
import { openComments } from './review-store.ts';
import { canSpacePan, commandFor, insideDialog, isMac, isTyping } from './shortcuts.ts';
import { LOCAL } from './store.ts';
import { TagPopover } from './tags.tsx';
import { templateLabels, templateRect } from './templates.ts';
import { startUpload } from './uploads.ts';
import { MediaViewer } from './viewer.tsx';
import { loadViewport, saveViewport } from './viewport.ts';
import { isVideoLink } from './youtube.ts';

const DRAG_THRESHOLD = 3;
/** Controls inside cards, which take the pointer instead of the canvas. */
const INTERACTIVE = 'input, textarea, select, button, a, [contenteditable="true"], [data-no-drag]';
const SNAP_PX = 6;
/** Extra world around the screen that stays rendered, so short pans show no gaps. */
const OVERSCAN_PX = 400;
/** Below this zoom, text is too small to read: cards are drawn as plain shapes. */
const FAR_ZOOM = 0.3;
const DOT_GRID = 22;

/** On-screen spacing of the background dots: the grid doubles as you zoom out, never denser than 16px. */
function dotSpacing(zoom: number): number {
  let step = DOT_GRID * zoom;
  while (step < 16) step *= 2;
  return step;
}
/**
 * The dotted background, moved with a transform: panning repaints nothing, the dots are
 * redrawn only when the zoom changes their spacing.
 */
function Dots({ viewport }: { viewport: Viewport }) {
  const step = dotSpacing(viewport.zoom);
  const mod = (n: number) => ((n % step) + step) % step;
  const x = mod(-viewport.x * viewport.zoom) - step;
  const y = mod(-viewport.y * viewport.zoom) - step;
  return (
    <div
      className="canvas__dots"
      aria-hidden="true"
      style={{ backgroundSize: `${step}px ${step}px`, transform: `translate(${x}px, ${y}px)` }}
    />
  );
}
/** How long after the first fit measured heights may still fit the board again. */
const REFIT_MS = 2000;

/** How long the world stays on its own compositor layer after the viewport last moved. */
const SETTLE_MS = 160;

type Gesture =
  | { kind: 'pan'; last: Point }
  | {
      kind: 'move';
      start: Point;
      started: boolean;
      ids: string[];
      anchor: string;
      /** Pointer offset inside the anchor card, in world units (for cards leaving a column). */
      grab: Point;
      clickOnly: string | null;
    }
  | { kind: 'marquee'; start: Point; base: Set<string> }
  | {
      kind: 'resize';
      id: string;
      corner: ResizeCorner;
      start: Point;
      rect: Rect;
      options: ResizeOptions;
    }
  | { kind: 'arrow'; start: Point; fromId: string | null };

/** Two fingers on the canvas: where they and the view were when this pair began. */
interface Pinch {
  ids: readonly [number, number];
  from: readonly [Point, Point];
  viewport: Viewport;
}

interface Overlay {
  offset?: { dx: number; dy: number };
  moving?: Set<string>;
  ghost?: { element: Element; x: number; y: number; w: number };
  guides?: Guide[];
  marquee?: Rect;
  drop?: { kind: 'column'; id: string; index: number; line: Rect } | { kind: 'unsorted' };
  resize?: Rect & { id: string };
  arrow?: { a: Point; b: Point };
}

const NO_OVERLAY: Overlay = {};
const EMPTY_SET: ReadonlySet<string> = new Set();

export interface CanvasProps {
  conn: BoardConnection;
  /** Board titles from the project root to this board, shown in the note side sheet. */
  breadcrumb?: string[];
  projectId: string;
  boardId: string;
  userId: string;
  boards: Board[] | null;
  canEdit: boolean;
  preview?: boolean;
  initialSelection?: ReadonlySet<string>;
  peers: Peer[];
  onOpenBoard: (boardId: string, template?: 'storyboard') => void;
  /** Told whenever the selection changes. */
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  /** Opens an image, file or frame in a view of the page's own; return false for the default. */
  onOpen?: (el: Element) => boolean;
  /** Opens the export dialog on the selection. */
  onExportSelection?: () => void;
  /** Filled with a reader of the part of the board on screen, for the export dialog. */
  visibleRef?: { current: (() => Rect | null) | null };
}

export function Canvas({
  conn,
  breadcrumb,
  projectId,
  boardId,
  userId,
  boards,
  canEdit,
  preview = false,
  initialSelection = EMPTY_SET,
  peers,
  onOpenBoard,
  onSelectionChange,
  onOpen,
  onExportSelection,
  visibleRef,
}: CanvasProps) {
  const { t } = useTranslation();
  const guest = useContext(GuestModeContext);
  const { instance } = useSession();
  const { store } = conn;
  const doc = store.doc;
  const readOnly = conn.readOnly || !canEdit;
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const sizeVersion = useSyncExternalStore(store.subscribeSizes, store.getSizeVersion);

  /** Rect of a card on the canvas, where arrows attach; null for cards inside a column. */
  const cardRect = useCallback(
    (id: string): Rect | null => {
      const el = store.getSnapshot().byId.get(id);
      return el && el.parent === null && el.type !== 'arrow' ? store.rectOf(el) : null;
    },
    [store],
  );
  /** Rect of any element on the canvas; an arrow's comes from where its ends are now. */
  const liveRect = useCallback(
    (el: Element): Rect => {
      if (el.type !== 'arrow') return store.rectOf(el);
      return arrowBox(arrowGeometry(el, cardRect));
    },
    [store, cardRect],
  );
  const arrowsOf = useCallback(
    (ids?: readonly string[]) =>
      store
        .getSnapshot()
        .canvas.filter(
          (e): e is ArrowElement => e.type === 'arrow' && (!ids || ids.includes(e.id)),
        ),
    [store],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingImageAt = useRef<Point | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [viewport, setViewportState] = useState<Viewport>(
    () => (preview ? null : loadViewport(boardId)) ?? { x: -40, y: -40, zoom: 1 },
  );
  const vp = useRef(viewport);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fitted = useRef(!preview && loadViewport(boardId) !== null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(initialSelection);
  const [editing, setEditingState] = useState<string | null>(null);
  const [cropping, setCropping] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool>('select');
  /** Frame whose details panel is open, frame being drawn, image or video in the viewer. */
  const [framePanel, setFramePanel] = useState<string | null>(null);
  /** Character or location card whose side sheet is open. */
  const [storyPanel, setStoryPanel] = useState<string | null>(null);
  const [noteSheet, setNoteSheet] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [tagging, setTagging] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const boardAspect = useBoardAspect(doc);
  const [params, setParams] = useSearchParams();
  const [overlay, setOverlayState] = useState<Overlay>(NO_OVERLAY);
  // The pointer-up handler reads the overlay of the last move, which may not be rendered yet.
  const overlayRef = useRef<Overlay>(NO_OVERLAY);
  const setOverlay = useCallback((o: Overlay) => {
    overlayRef.current = o;
    setOverlayState(o);
  }, []);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    at: Point;
    fromToolbar?: boolean;
  } | null>(null);
  const [palette, setPalette] = useState(false);
  const [linkDraft, setLinkDraft] = useState<{ at: Point } | null>(null);
  const [unsortedOpen, setUnsortedOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo: boolean } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const [dropHint, setDropHint] = useState(false);
  const noteEditor = useRef<Editor | null>(null);
  const [, setEditorVersion] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  const spaceDown = useRef(false);
  const lastPointer = useRef<Point | null>(null);
  /** Fingers on the canvas, by pointer id, in screen coordinates. */
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<Pinch | null>(null);
  /** Frame that draws the pinch at the fingers' latest positions. */
  const pinchFrame = useRef<number | undefined>(undefined);
  /** Fingers on the toolbar, a menu or a control: they work there and never join a pinch. */
  const touchesOutside = useRef(new Set<number>());
  /** Set once two fingers touched: the one left after a pinch starts nothing until all lift. */
  const touchHeld = useRef(false);
  /** Selection when the first finger landed, restored if a second one turns it into a pinch. */
  const touchSelection = useRef<ReadonlySet<string>>(EMPTY_SET);
  const unsortedRef = useRef<HTMLDivElement>(null);

  const setViewport = useCallback(
    (next: Viewport | ((v: Viewport) => Viewport)) => {
      const value = typeof next === 'function' ? next(vp.current) : next;
      vp.current = value;
      setViewportState(value);
      if (!preview) saveViewport(boardId, value);
      // While the view moves the world and the dots are composited, so a pan only shifts pixels; once it
      // settles the layer goes away and the cards are drawn sharp at the new zoom.
      rootRef.current?.classList.add('canvas--moving');
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(
        () => rootRef.current?.classList.remove('canvas--moving'),
        SETTLE_MS,
      );
    },
    [boardId, preview],
  );

  const editingRef = useRef<string | null>(null);
  /** Keys typed between creating a note and its editor taking focus. */
  const pendingText = useRef<string | null>(null);

  const setEditing = useCallback(
    (id: string | null, keepEmpty = false) => {
      const previous = editingRef.current;
      editingRef.current = id;
      setEditingState(id);
      // One editor per note: its side sheet and the inline editor share the same document.
      if (id) setNoteSheet(null);
      if (previous === id) return;
      noteEditor.current = null;
      if (!id) pendingText.current = null;
      // A note left empty disappears, as on paper. Not an undo step of its own.
      const body = previous ? store.map(previous)?.get('body') : null;
      if (previous && !keepEmpty && body instanceof Y.XmlFragment && isEmpty(body))
        deleteElements(doc, [previous]);
    },
    [store, doc],
  );

  const setNoteEditor = useCallback((editor: Editor | null) => {
    noteEditor.current = editor;
    setEditorVersion((n) => n + 1);
    if (!editor) return;
    editor.on('transaction', () => setEditorVersion((n) => n + 1));
    // Focus now rather than on the editor's own deferred autofocus, so no key falls in between.
    editor.commands.focus('end');
    if (pendingText.current) editor.commands.insertContent(pendingText.current);
    pendingText.current = null;
  }, []);

  // Container size ------------------------------------------------------------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** Viewport fitting a rect in the part of the canvas above the toolbar, which floats over it. */
  const fitView = useCallback(
    (r: Rect, padding?: number, maxZoom?: number) => {
      const root = rootRef.current?.getBoundingClientRect();
      const bar = rootRef.current?.querySelector('.toolbar')?.getBoundingClientRect();
      const below = root && bar?.height ? Math.max(0, root.bottom - bar.top) : 0;
      return fitRect(r, size.w, size.h - below, padding, maxZoom);
    },
    [size],
  );

  // First visit: fit the content once the document has arrived.
  const autoFit = useRef<{ view: Viewport; until: number } | null>(null);
  useEffect(() => {
    if (fitted.current || conn.status !== 'synced' || size.w === 0) return;
    fitted.current = true;
    const bounds = boundsOf(snap.canvas.map(liveRect));
    if (!bounds) return;
    const view = fitView(bounds);
    setViewport(view);
    autoFit.current = { view, until: performance.now() + REFIT_MS };
  }, [conn.status, size, snap, liveRect, setViewport, fitView]);

  // Any touch, click or key on the board ends the first-visit fit: a card growing under the
  // pointer while someone writes must not zoom the view away.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = () => {
      autoFit.current = null;
    };
    root.addEventListener('pointerdown', stop, true);
    root.addEventListener('keydown', stop, true);
    root.addEventListener('wheel', stop, { capture: true, passive: true });
    return () => {
      root.removeEventListener('pointerdown', stop, true);
      root.removeEventListener('keydown', stop, true);
      root.removeEventListener('wheel', stop, true);
    };
  }, []);

  // Columns and scenes are only as tall as estimated until they are drawn and measured: fit again as
  // their heights arrive, unless the view has been moved since.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sizeVersion invalidates measured heights
  useEffect(() => {
    const fit = autoFit.current;
    if (!fit) return;
    if (vp.current !== fit.view || performance.now() > fit.until) {
      autoFit.current = null;
      return;
    }
    const bounds = boundsOf(store.getSnapshot().canvas.map(liveRect));
    if (!bounds) return;
    const view = fitView(bounds);
    if (view.x === fit.view.x && view.y === fit.view.y && view.zoom === fit.view.zoom) return;
    setViewport(view);
    autoFit.current = { view, until: fit.until };
  }, [sizeVersion, store, liveRect, setViewport, fitView]);

  // Others see where we point, what we selected and which card we write in.
  const presence = useLocalPresence(preview ? null : conn.provider);

  // A role change while the board is open: leave the note being written and say why, and
  // publish presence again so the server stamps the new role for the others right away.
  const [nextAccessNotice] = useState(accessNotices);
  useEffect(() => {
    const notice = nextAccessNotice(conn);
    if (!notice) return;
    if (notice.readOnly) setEditing(null);
    presence.flush();
    setToast({
      text: t(notice.readOnly ? 'board.access.readOnly' : 'board.access.editable'),
      undo: false,
    });
  }, [conn, nextAccessNotice, presence, setEditing, t]);
  useEffect(() => {
    presence.selection([...selection], editing);
  }, [presence, selection, editing]);

  useEffect(() => {
    onSelectionChange?.(selection);
  }, [selection, onSelectionChange]);

  useEffect(() => {
    if (!visibleRef) return;
    visibleRef.current = () =>
      size.w > 0 && size.h > 0 ? visibleWorld(vp.current, size.w, size.h) : null;
    return () => {
      visibleRef.current = null;
    };
  }, [visibleRef, size]);

  // Drop selection entries that were deleted (here or by someone else).
  useEffect(() => {
    setSelection((sel) => {
      if ([...sel].every((id) => snap.byId.has(id))) return sel;
      return new Set([...sel].filter((id) => snap.byId.has(id)));
    });
    if (editing && !snap.byId.has(editing)) setEditing(null);
    if (
      cropping &&
      (readOnly ||
        !selection.has(cropping) ||
        snap.byId.get(cropping)?.type !== 'image' ||
        snap.byId.get(cropping)?.locked)
    ) {
      setCropping(null);
    }
    if (noteSheet && !snap.byId.has(noteSheet)) setNoteSheet(null);
  }, [snap, editing, setEditing, cropping, readOnly, selection, noteSheet]);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = rootRef.current?.getBoundingClientRect();
    return screenToWorld(vp.current, { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) });
  }, []);

  /** A free spot near the middle of the view, so new cards do not land on each other. */
  const center = useCallback(
    (w = 240): Point => {
      const c = screenToWorld(vp.current, { x: size.w / 2, y: size.h / 2 });
      const start = { x: c.x - w / 2, y: c.y - 60 };
      const rects = store.getSnapshot().canvas.map(liveRect);
      const free = (x: number, y: number) =>
        !rects.some((r) => intersects(inflate(r, 12), { x, y, w, h: 120 }));
      // Down and to the right first, as cards cascade…
      for (let i = 0; i < 12; i++) {
        const at = { x: start.x + i * 32, y: start.y + i * 32 };
        if (free(at.x, at.y)) return at;
      }
      // …then the nearest free spot in growing rings, so a crowded middle never stacks cards.
      for (let ring = 1; ring <= 40; ring++) {
        let best: Point | undefined;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = -ring; i <= ring; i++) {
          for (const [dx, dy] of [
            [i, -ring],
            [i, ring],
            [-ring, i],
            [ring, i],
          ] as const) {
            const at = { x: start.x + dx * 32, y: start.y + dy * 32 };
            const distance = dx * dx + dy * dy;
            if (distance < bestDistance && free(at.x, at.y)) {
              best = at;
              bestDistance = distance;
            }
          }
        }
        if (best) return best;
      }
      return start;
    },
    [size, store, liveRect],
  );

  // Edits ---------------------------------------------------------------------

  const select = useCallback((ids: Iterable<string>) => setSelection(new Set(ids)), []);

  /** A board card from the Canvas menu; templates are laid out in the background. */
  const insertCanvas = useCallback(
    async (template: CanvasTemplate, at?: Point) => {
      if (readOnly) return;
      const pos = at ?? center(DEFAULT_WIDTH.board);
      try {
        const { board, jobs } = await createCanvasBoards(projectId, boardId, template, t, userId);
        store.undo.stopCapturing();
        const card = createElement(
          doc,
          'board',
          pos,
          { boardId: board.id },
          { userId, origin: LOCAL },
        );
        queueSeeds(jobs);
        select([card.id]);
        setEditing(card.id);
      } catch {
        setToast({
          text: t(
            isStoryboardTemplate(template)
              ? 'board.errors.storyboardCreate'
              : 'board.errors.boardCreate',
          ),
          undo: false,
        });
      }
    },
    [readOnly, center, t, projectId, boardId, userId, store, doc, select, setEditing],
  );

  const [importingScript, setImportingScript] = useState(false);
  /** A storyboard card from a screenplay: the board is filled in the background, like a template. */
  const insertScreenplay = useCallback(
    async (plan: ImportPlan) => {
      if (readOnly) return;
      const board = await createScreenplayStoryboard(
        projectId,
        boardId,
        plan,
        t('screenplay.untitled'),
        userId,
      );
      store.undo.stopCapturing();
      const card = createElement(
        doc,
        'board',
        center(DEFAULT_WIDTH.board),
        { boardId: board.id },
        { userId, origin: LOCAL },
      );
      select([card.id]);
    },
    [readOnly, projectId, boardId, t, userId, store, doc, center, select],
  );

  const add = useCallback(
    async (type: ToolType, at?: Point) => {
      if (readOnly) return;
      const pos = at ?? center(DEFAULT_WIDTH[type as Element['type']] ?? 240);
      const opts = { userId, origin: LOCAL };
      store.undo.stopCapturing();
      let created: Element | null = null;
      switch (type) {
        case 'note':
          created = createElement(doc, 'note', pos, {}, opts);
          pendingText.current = '';
          break;
        case 'todo':
          created = createElement(doc, 'todo', pos, { items: [] }, opts);
          break;
        case 'column':
          created = createElement(doc, 'column', pos, { title: '' }, opts);
          break;
        case 'color':
          created = createElement(doc, 'color', pos, { hex: '#808086' }, opts);
          break;
        case 'link':
          setLinkDraft({ at: pos });
          return;
        case 'image':
          pendingImageAt.current = pos;
          fileInput.current?.click();
          return;
        case 'board':
        case 'storyboard':
          // The same as choosing Board or Storyboard in the Canvas menu.
          return insertCanvas(type, pos);
        case 'frame':
          created = createElement(doc, 'frame', pos, {}, opts);
          select([created.id]);
          setFramePanel(created.id);
          return;
        case 'scene':
          created = addScene(doc, {}, opts, pos);
          break;
        case 'character':
        case 'location':
          // Named in the side sheet, which opens on the new card.
          created = createElement(doc, type, pos, { name: '' }, opts);
          select([created.id]);
          setStoryPanel(created.id);
          return;
      }
      if (created) {
        select([created.id]);
        setEditing(created.id);
      }
    },
    [readOnly, center, userId, store, doc, select, setEditing, insertCanvas],
  );

  const uploadFiles = useCallback(
    (files: File[], at: Point) => {
      if (readOnly) return;
      const max = instance?.limits.uploadMaxBytes ?? 0;
      const tooBig = max > 0 ? files.filter((f) => f.size > max) : [];
      if (tooBig.length > 0) {
        setToast({ text: t('board.errors.tooBig', { name: tooBig[0]?.name }), undo: false });
      }
      files
        .filter((f) => !tooBig.includes(f))
        .forEach((file, i) => {
          const pos = { x: at.x + i * 24, y: at.y + i * 24 };
          const type = file.type.startsWith('image/') ? 'image' : 'file';
          startUpload({
            file,
            projectId,
            boardId,
            onAsset: (assetId) => {
              // Resuming an upload from an earlier attempt: its card is already on the board.
              const card = listElements(doc).find(
                (e) => (e.type === 'image' || e.type === 'file') && e.assetId === assetId,
              );
              if (card) {
                if (i === 0) select([card.id]);
                return;
              }
              const el = createElement(doc, type, pos, { assetId }, { userId, origin: LOCAL });
              store.undo.stopCapturing();
              if (i === 0) select([el.id]);
            },
            onFailed: (assetId) => {
              if (!assetId)
                setToast({ text: t('board.errors.upload', { name: file.name }), undo: false });
            },
          });
        });
    },
    [readOnly, projectId, boardId, doc, userId, store, select, t, instance],
  );

  const addText = useCallback(
    (text: string, at: Point) => {
      const trimmed = text.trim();
      if (!trimmed || readOnly) return;
      const opts = { userId, origin: LOCAL };
      if (/^https?:\/\/\S+$/i.test(trimmed)) {
        const el = createElement(doc, 'link', at, { url: trimmed }, opts);
        select([el.id]);
        void fillLinkPreview(doc, el.id, projectId, boardId, trimmed);
        return;
      }
      const el = createElement(doc, 'note', at, {}, opts);
      doc.transact(() => {
        const body = store.map(el.id)?.get('body');
        if (body instanceof Y.XmlFragment) fillFragment(body, trimmed);
      }, LOCAL);
      select([el.id]);
    },
    [readOnly, userId, doc, store, select, projectId, boardId],
  );

  const removeSelection = useCallback(() => {
    if (readOnly || selection.size === 0) return;
    const count = selection.size;
    store.undo.stopCapturing();
    deleteElements(doc, selection, LOCAL);
    setSelection(EMPTY_SET);
    setToast({ text: t('board.deleted', { count }), undo: true });
  }, [readOnly, selection, store, doc, t]);

  const duplicate = useCallback(() => {
    if (readOnly || selection.size === 0) return;
    select(duplicateInStore(store, selection, userId));
  }, [readOnly, selection, store, userId, select]);

  const onlySelected = selection.size === 1 ? [...selection][0] : undefined;
  useRegisterActions(
    canvasActions({
      readOnly,
      guest,
      framePanelOpen: !!framePanel,
      selection,
      selectedFrame:
        onlySelected && snap.byId.get(onlySelected)?.type === 'frame' ? onlySelected : null,
      add: addActions(
        TOOLS,
        (type) => t('board.palette.add', { type: t(`board.types.${type}`) }),
        (type) => {
          void add(type);
        },
      ),
      duplicate,
      store,
      t,
      duplicateHint: `${isMac() ? '⌘' : 'Ctrl+'}D`,
    }),
  );

  const toggleLock = useCallback(() => {
    if (readOnly || selection.size === 0) return;
    const els = [...selection].map((id) => snap.byId.get(id)).filter((e) => e !== undefined);
    const lock = els.some((e) => !e.locked);
    updateElements(
      doc,
      els.map((e) => ({ id: e.id, patch: { locked: lock ? true : undefined } })),
      LOCAL,
    );
  }, [readOnly, selection, snap, doc]);

  const align = useCallback(
    (how: Alignment | 'distribute') => {
      const els = [...selection]
        .map((id) => snap.byId.get(id))
        .filter((e): e is Element => !!e && e.parent === null && !e.locked && e.type !== 'arrow');
      const rects = els.map((e) => store.rectOf(e));
      const next = how === 'distribute' ? distributeRects(rects) : alignRects(rects, how);
      doc.transact(() => {
        updateElements(
          doc,
          els.map((e, i) => ({
            id: e.id,
            patch: { x: Math.round(next[i]?.x ?? e.x), y: Math.round(next[i]?.y ?? e.y) },
          })),
          LOCAL,
        );
        refreshArrows(
          doc,
          arrowsOf(),
          els.map((e) => e.id),
          cardRect,
          LOCAL,
        );
      }, LOCAL);
    },
    [selection, snap, store, doc, arrowsOf, cardRect],
  );

  const groupIntoColumn = useCallback(() => {
    const els = [...selection]
      .map((id) => snap.byId.get(id))
      .filter(
        (e): e is Element => !!e && e.parent === null && !isContainer(e) && e.type !== 'arrow',
      );
    const bounds = boundsOf(els.map((e) => store.rectOf(e)));
    if (!bounds) return;
    store.undo.stopCapturing();
    doc.transact(() => {
      const col = createElement(
        doc,
        'column',
        { x: bounds.x, y: bounds.y },
        { title: '' },
        { userId, origin: LOCAL },
      );
      const ordered = [...els].sort((a, b) => a.y - b.y || a.x - b.x).map((e) => e.id);
      moveIntoParent(doc, ordered, col.id, 0, LOCAL);
      select([col.id]);
      setEditing(col.id);
    }, LOCAL);
  }, [selection, snap, store, doc, userId, select, setEditing]);

  const zoomTo = useCallback(
    (to: 'in' | 'out' | 'reset' | 'fit' | 'selection') => {
      const mid = { x: size.w / 2, y: size.h / 2 };
      if (to === 'in' || to === 'out') {
        setViewport((v) => zoomAt(v, mid, nextZoomStep(v.zoom, to === 'in' ? 1 : -1)));
      } else if (to === 'reset') {
        setViewport((v) => zoomAt(v, mid, 1));
      } else {
        const els =
          to === 'selection'
            ? [...selection].map((id) => snap.byId.get(id)).filter((e) => e?.parent === null)
            : snap.canvas;
        const bounds = boundsOf(els.filter((e) => e !== undefined).map(liveRect));
        if (bounds) setViewport(fitView(bounds, 64, to === 'selection' ? 2 : 1));
      }
    },
    [size, selection, snap, liveRect, setViewport, fitView],
  );

  const openElement = useCallback(
    (el: Element) => {
      if (el.type === 'board') onOpenBoard(el.boardId);
      else if (onOpen?.(el)) return;
      else if (el.type === 'link') {
        if (isVideoLink(el.url)) {
          setViewing(el.id);
          return;
        }
        const href = webUrl(el.url);
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
      } else if (el.type === 'image' || el.type === 'file') {
        setViewing(el.id);
      } else if (el.type === 'frame') {
        select([el.id]);
        setStoryPanel(null);
        setFramePanel(el.id);
      } else if (el.type === 'character' || el.type === 'location') {
        select([el.id]);
        setFramePanel(null);
        setStoryPanel(el.id);
      } else if (el.type === 'note') {
        select([el.id]);
        // The sheet takes over the note's document: leave inline editing first.
        setEditing(null, editingRef.current === el.id);
        setNoteSheet(el.id);
      } else if (!readOnly) {
        select([el.id]);
        setEditing(el.id);
      }
    },
    [onOpenBoard, onOpen, readOnly, select, setEditing],
  );

  // Pointer gestures ----------------------------------------------------------

  function screenPoint(e: { clientX: number; clientY: number }): Point {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }

  /** Whether a finger here may join a pinch: on the board or a card, not on chrome or a control. */
  function pinchable(target: HTMLElement): boolean {
    if (target.closest(`${INTERACTIVE}, [data-play-link]`)) return false;
    return !!canvasElementId(target) || !target.closest('[data-chrome]');
  }

  /**
   * The two most recent fingers, which a pinch follows from the current view: a third finger
   * takes over from the oldest, and lifting one of the pair with two others down continues with
   * those two.
   */
  function pinchPair(): Pinch | null {
    const [a, b] = [...touches.current].slice(-2);
    return a && b ? { ids: [a[0], b[0]], from: [a[1], b[1]], viewport: vp.current } : null;
  }

  /** Moves the view to where the pair's fingers are now; once per frame however many moves. */
  function drawPinch() {
    if (pinchFrame.current !== undefined) cancelAnimationFrame(pinchFrame.current);
    pinchFrame.current = undefined;
    const p = pinch.current;
    const a = p && touches.current.get(p.ids[0]);
    const b = p && touches.current.get(p.ids[1]);
    if (p && a && b) setViewport(pinchViewport(p.viewport, p.from, [a, b]));
  }

  /**
   * Tracks fingers; returns true when the touch belongs to a two-finger gesture, which pans and
   * zooms the view instead of what one finger does, or to a control while fingers are on the
   * board.
   */
  function touchDown(e: ReactPointerEvent<HTMLDivElement>): boolean {
    if (e.pointerType !== 'touch') return false;
    // The first finger of a new touch: anything left from a lost pointerup is stale.
    if (e.isPrimary) {
      touches.current.clear();
      touchesOutside.current.clear();
      pinch.current = null;
      drawPinch();
      touchHeld.current = false;
    }
    if (!pinchable(e.target as HTMLElement)) {
      // A lone finger on a control does what a mouse does there.
      if (touches.current.size === 0) return false;
      // With fingers on the board the control handles it as usual; the canvas leaves them alone.
      touchesOutside.current.add(e.pointerId);
      return true;
    }
    if (touches.current.size === 0) touchSelection.current = selection;
    touches.current.set(e.pointerId, screenPoint(e));
    if (touches.current.size < 2) return touchHeld.current;
    if (pinch.current) {
      drawPinch();
      pinch.current = pinchPair();
    } else {
      startPinch();
    }
    rootRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
    return true;
  }

  function startPinch() {
    // Whatever the first finger began is dropped as if it never happened: a move or a resize only
    // lives in the overlay until it ends, a marquee changed the selection.
    const g = gesture.current;
    gesture.current = null;
    setOverlay(NO_OVERLAY);
    if (g && g.kind !== 'pan') setSelection(touchSelection.current);
    setMenu(null);
    touchHeld.current = true;
    pinch.current = pinchPair();
  }

  /** Moves a finger; returns true when the move belongs to a two-finger gesture. */
  function touchMove(e: ReactPointerEvent<HTMLDivElement>): boolean {
    if (e.pointerType !== 'touch') return false;
    if (touchesOutside.current.has(e.pointerId)) return true;
    if (!touches.current.has(e.pointerId)) return touchHeld.current;
    touches.current.set(e.pointerId, screenPoint(e));
    const p = pinch.current;
    if (!p) return touchHeld.current;
    // Fingers outside the pair only move where a later pair would start.
    if (p.ids.includes(e.pointerId) && pinchFrame.current === undefined) {
      pinchFrame.current = requestAnimationFrame(drawPinch);
    }
    return true;
  }

  /** Lifts a finger; returns true when it belonged to a two-finger gesture or a control. */
  function touchUp(e: ReactPointerEvent<HTMLDivElement>): boolean {
    if (e.pointerType !== 'touch') return false;
    if (touchesOutside.current.delete(e.pointerId)) return true;
    if (!touches.current.has(e.pointerId)) return touchHeld.current;
    if (pinch.current?.ids.includes(e.pointerId)) {
      drawPinch();
      touches.current.delete(e.pointerId);
      pinch.current = pinchPair();
    } else {
      touches.current.delete(e.pointerId);
    }
    const held = touchHeld.current;
    if (touches.current.size === 0) touchHeld.current = false;
    if (held && rootRef.current?.hasPointerCapture(e.pointerId)) {
      rootRef.current.releasePointerCapture(e.pointerId);
    }
    return held;
  }

  /** A finger whose capture the canvas lost without a pointerup leaves its gesture as on cancel. */
  function onLostPointerCapture(e: ReactPointerEvent<HTMLDivElement>) {
    // Captures lost by the cards' own elements are the browser's implicit ones, handed over here.
    if (e.target !== e.currentTarget) return;
    if (touches.current.has(e.pointerId) || touchesOutside.current.has(e.pointerId)) touchUp(e);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (touchDown(e)) return;
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-play-link]')) return;
    const targetId = canvasElementId(target);
    if (!targetId && target.closest('[data-chrome]')) return;
    setMenu(null);
    const p = screenPoint(e);
    const pan = e.button === 1 || tool === 'hand' || spaceDown.current;
    if (pan) {
      e.preventDefault();
      gesture.current = { kind: 'pan', last: p };
      rootRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'arrow' && !readOnly) {
      if (editing) setEditing(null);
      if (cropping) setCropping(null);
      const from = targetId ? snap.byId.get(targetId) : undefined;
      const fromId = from && from.parent === null && from.type !== 'arrow' ? from.id : null;
      gesture.current = { kind: 'arrow', start: screenToWorld(vp.current, p), fromId };
      rootRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (!targetId) {
      if (editing) setEditing(null);
      if (cropping) setCropping(null);
      const base = e.shiftKey ? new Set(selection) : new Set<string>();
      if (!e.shiftKey) setSelection(EMPTY_SET);
      gesture.current = { kind: 'marquee', start: screenToWorld(vp.current, p), base };
      rootRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const id = targetId;
    const el = snap.byId.get(id);
    if (!el) return;
    const interactive = target.closest(INTERACTIVE);
    if ((editing === id || cropping === id) && interactive) return;
    if (editing && editing !== id) setEditing(null);
    if (cropping && cropping !== id) setCropping(null);

    let next: Set<string>;
    let clickOnly: string | null = null;
    if (e.shiftKey) {
      next = new Set(selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else if (selection.has(id)) {
      next = new Set(selection);
      clickOnly = selection.size > 1 ? id : null;
    } else {
      next = new Set([id]);
    }
    setSelection(next);
    if (interactive || readOnly) return;

    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    if (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se') {
      if (el.locked || el.parent !== null) return;
      const rect = liveRect(el);
      const card = rootRef.current?.querySelector<HTMLElement>(
        `.card[data-el="${CSS.escape(id)}"]`,
      );
      const mediaHeight = card?.querySelector<HTMLElement>('.card__media')?.offsetHeight;
      const options: ResizeOptions =
        el.type === 'image'
          ? {
              aspectRatio: rect.w / (mediaHeight || rect.h),
              fixedHeight: mediaHeight ? Math.max(0, rect.h - mediaHeight) : 0,
            }
          : { widthOnly: el.type === 'link' };
      store.undo.stopCapturing();
      gesture.current = { kind: 'resize', id, corner: handle, start: p, rect, options };
      rootRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const ids = [...next].filter((i) => !snap.byId.get(i)?.locked);
    if (!ids.includes(id)) return;
    const r = target.closest<HTMLElement>('[data-el], [data-resize-el]')?.getBoundingClientRect();
    if (!r) return;
    gesture.current = {
      kind: 'move',
      start: p,
      started: false,
      ids,
      anchor: id,
      grab: { x: (e.clientX - r.left) / vp.current.zoom, y: (e.clientY - r.top) / vp.current.zoom },
      clickOnly,
    };
    rootRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (touchMove(e)) return;
    const p = screenPoint(e);
    lastPointer.current = p;
    presence.cursor(screenToWorld(vp.current, p));
    const g = gesture.current;
    if (!g) return;
    const v = vp.current;
    if (g.kind === 'pan') {
      const dx = p.x - g.last.x;
      const dy = p.y - g.last.y;
      g.last = p;
      setViewport({ ...v, x: v.x - dx / v.zoom, y: v.y - dy / v.zoom });
      return;
    }
    if (g.kind === 'marquee') {
      const rect = rectFromPoints(g.start, screenToWorld(v, p));
      const hit = new Set(g.base);
      for (const el of snap.canvas) if (intersects(rect, liveRect(el))) hit.add(el.id);
      setSelection(hit);
      const a = worldToScreen(v, { x: rect.x, y: rect.y });
      setOverlay({ marquee: { x: a.x, y: a.y, w: rect.w * v.zoom, h: rect.h * v.zoom } });
      return;
    }
    if (g.kind === 'arrow') {
      const b = screenToWorld(v, p);
      const from = { x: g.start.x, y: g.start.y, ...(g.fromId ? { elementId: g.fromId } : {}) };
      setOverlay({ arrow: arrowEnds({ from, to: b }, cardRect) });
      return;
    }
    if (g.kind === 'resize') {
      const rect = resizeFromCorner(
        g.rect,
        g.corner,
        {
          x: (p.x - g.start.x) / v.zoom,
          y: (p.y - g.start.y) / v.zoom,
        },
        g.options,
      );
      setOverlay({ resize: { id: g.id, ...rect } });
      return;
    }
    // Move
    if (!g.started) {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_THRESHOLD) return;
      g.started = true;
      store.undo.stopCapturing();
    }
    const world = screenToWorld(v, p);
    let dx = (p.x - g.start.x) / v.zoom;
    let dy = (p.y - g.start.y) / v.zoom;
    const moving = new Set(g.ids);
    const els = g.ids.map((id) => snap.byId.get(id)).filter((x): x is Element => !!x);
    const free = els.filter((x) => x.parent === null && x.type !== 'arrow');
    const anchor = snap.byId.get(g.anchor);
    const ghost =
      anchor && anchor.parent !== null
        ? { element: anchor, x: world.x - g.grab.x, y: world.y - g.grab.y, w: anchor.w }
        : undefined;

    let drop: Overlay['drop'];
    const unsortedBox = unsortedRef.current?.getBoundingClientRect();
    const rootBox = rootRef.current?.getBoundingClientRect();
    if (
      unsortedBox &&
      e.clientX >= unsortedBox.left &&
      e.clientX <= unsortedBox.right &&
      e.clientY >= unsortedBox.top &&
      e.clientY <= unsortedBox.bottom
    ) {
      drop = { kind: 'unsorted' };
    } else if (els.some((x) => !isContainer(x) && x.type !== 'arrow')) {
      const column = [...snap.canvas]
        .reverse()
        .find(
          (c) =>
            (c.type === 'column' || c.type === 'scene') &&
            !moving.has(c.id) &&
            !c.collapsed &&
            containsPoint(store.rectOf(c), world),
        );
      const body = column
        ? rootRef.current?.querySelector<HTMLElement>(`[data-column="${column.id}"]`)
        : null;
      if (column && body && rootBox) {
        const kids = [...body.querySelectorAll<HTMLElement>(':scope > [data-el]')].map((n) =>
          n.getBoundingClientRect(),
        );
        const index = dropIndex(
          kids.map((k) => ({ top: k.top, height: k.height })),
          e.clientY,
        );
        const bodyBox = body.getBoundingClientRect();
        const y =
          index < kids.length
            ? (kids[index]?.top ?? bodyBox.top) - 4
            : kids.length
              ? (kids.at(-1)?.bottom ?? bodyBox.top) + 4
              : bodyBox.top + 4;
        drop = {
          kind: 'column',
          id: column.id,
          index,
          line: { x: bodyBox.left - rootBox.left, y: y - rootBox.top - 1, w: bodyBox.width, h: 2 },
        };
      }
    }

    let guides: Guide[] | undefined;
    if (!drop && !e.altKey && free.length > 0) {
      const bounds = boundsOf(free.map((x) => store.rectOf(x)));
      if (bounds) {
        const area = inflate(visibleWorld(v, size.w, size.h), 200 / v.zoom);
        const others = snap.canvas
          .filter((o) => !moving.has(o.id) && o.type !== 'arrow')
          .map((o) => store.rectOf(o))
          .filter((r) => intersects(r, area));
        const s = snapRect(
          { ...bounds, x: bounds.x + dx, y: bounds.y + dy },
          others,
          SNAP_PX / v.zoom,
        );
        dx += s.dx;
        dy += s.dy;
        guides = s.guides;
      }
    }
    setOverlay({ offset: { dx, dy }, moving, ghost, guides, drop });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (touchUp(e)) return;
    const g = gesture.current;
    gesture.current = null;
    if (rootRef.current?.hasPointerCapture(e.pointerId)) {
      rootRef.current.releasePointerCapture(e.pointerId);
    }
    const o = overlayRef.current;
    setOverlay(NO_OVERLAY);
    if (!g || (e.type === 'pointercancel' && g.kind === 'resize')) return;
    if (g.kind === 'arrow') {
      const end = toWorld(e.clientX, e.clientY);
      const under = (
        document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      )?.closest<HTMLElement>('[data-el]');
      const target = under ? snap.byId.get(under.dataset.el ?? '') : undefined;
      const toId =
        target && target.parent === null && target.type !== 'arrow' && target.id !== g.fromId
          ? target.id
          : null;
      const short = Math.hypot(end.x - g.start.x, end.y - g.start.y) < 12 / vp.current.zoom;
      if (short && !toId) return;
      store.undo.stopCapturing();
      const arrow = createArrow(
        doc,
        {
          x: Math.round(g.start.x),
          y: Math.round(g.start.y),
          ...(g.fromId ? { elementId: g.fromId } : {}),
        },
        { x: Math.round(end.x), y: Math.round(end.y), ...(toId ? { elementId: toId } : {}) },
        cardRect,
        {},
        { userId, origin: LOCAL },
      );
      store.undo.stopCapturing();
      select([arrow.id]);
      setTool('select');
      return;
    }
    if (g.kind === 'resize' && o.resize) {
      const current = store.getSnapshot().byId.get(g.id);
      if (!current || current.locked || readOnly || current.parent !== null) return;
      const { x, y, w, h } = o.resize;
      doc.transact(() => {
        updateElement(doc, g.id, current.type === 'link' ? { x, w } : { x, y, w, h }, LOCAL);
        // The store updates after this transaction; attached arrows need the new rect now.
        refreshArrows(
          doc,
          arrowsOf(),
          [g.id],
          (id) => (id === g.id ? { x, y, w, h } : cardRect(id)),
          LOCAL,
        );
      }, LOCAL);
      store.undo.stopCapturing();
      return;
    }
    if (g.kind !== 'move') return;
    if (!g.started) {
      if (g.clickOnly) select([g.clickOnly]);
      return;
    }
    const { dx = 0, dy = 0 } = o.offset ?? {};
    const arrows = arrowsOf(g.ids);
    const cards = g.ids.filter((id) => !arrows.some((a) => a.id === id));
    doc.transact(() => {
      if (o.drop?.kind === 'unsorted') {
        moveToUnsorted(doc, cards, LOCAL);
      } else if (o.drop?.kind === 'column') {
        moveIntoParent(doc, cards, o.drop.id, o.drop.index, LOCAL);
      } else {
        moveCards(cards, dx, dy, toWorld(e.clientX, e.clientY), g.grab);
        if (arrows.length > 0) moveArrows(doc, arrows, dx, dy, cardRect, LOCAL);
      }
      refreshArrows(doc, arrowsOf(), cards, cardRect, LOCAL);
    }, LOCAL);
    store.undo.stopCapturing();
  }

  /** Drops moved cards on the canvas; cards leaving a column or the drawer stack under the pointer. */
  function moveCards(ids: string[], dx: number, dy: number, world: Point, grab: Point) {
    let stack = 0;
    const moves = ids.flatMap((id) => {
      const el = snap.byId.get(id);
      if (!el) return [];
      if (el.parent === null) return [{ id, x: el.x + dx, y: el.y + dy }];
      const at = { id, x: world.x - grab.x, y: world.y - grab.y + stack };
      stack += store.heightOf(el) + 12;
      return [at];
    });
    moveToCanvas(doc, moves, LOCAL);
  }

  function onDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    // Pointer capture retargets the click to the canvas itself: look at what is under it.
    const target =
      (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) ??
      (e.target as HTMLElement);
    const targetId = canvasElementId(target);
    if (!targetId) {
      if (target.closest('[data-chrome]') || readOnly) return;
      const at = toWorld(e.clientX, e.clientY);
      void add('note', { x: at.x - 20, y: at.y - 20 });
      return;
    }
    const el = snap.byId.get(targetId);
    if (el && editing !== el.id) {
      openElement(el);
    }
  }

  function onContextMenu(e: ReactMouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('[data-chrome]') && !canvasElementId(target)) return;
    if (isTyping(target)) return;
    e.preventDefault();
    // A long press of the fingers of a pinch.
    if (touchHeld.current) return;
    const id = canvasElementId(target);
    if (id && !selection.has(id)) select([id]);
    if (!id) setSelection(EMPTY_SET);
    const p = screenPoint(e);
    setMenu({ x: p.x, y: p.y, at: screenToWorld(vp.current, p) });
  }

  // Wheel: scroll pans, pinch or Ctrl/⌘ + wheel zooms.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-scroll]')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
      const v = vp.current;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
        setViewport(zoomAt(v, anchor, v.zoom * factor));
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        setViewport({ ...v, x: v.x + dx / v.zoom, y: v.y + dy / v.zoom });
      }
    };
    // Older Safari zooms the page on a pinch even where touch-action is none; the canvas zooms itself.
    const noPageZoom = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', noPageZoom);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', noPageZoom);
    };
  }, [setViewport]);

  useEffect(
    () => () => {
      clearTimeout(settleTimer.current);
      if (pinchFrame.current !== undefined) cancelAnimationFrame(pinchFrame.current);
    },
    [],
  );

  // Keyboard --------------------------------------------------------------------
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (insideDialog()) return;
    // A menu or the version banner already handled this Escape; a preview has nothing to clear.
    if (e.key === 'Escape' && (e.defaultPrevented || preview)) return;
    if (e.key === ' ' && canSpacePan(e.target)) {
      spaceDown.current = e.type === 'keydown';
      if (e.type === 'keydown') e.preventDefault();
      return;
    }
    if (
      e.type === 'keydown' &&
      pendingText.current !== null &&
      !isTyping(e.target) &&
      e.key.length === 1 &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      pendingText.current += e.key;
      e.preventDefault();
      return;
    }
    const editor = noteEditor.current;
    if (
      e.type === 'keydown' &&
      editor &&
      editingRef.current &&
      !isTyping(e.target) &&
      e.key.length === 1 &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      // A key typed while the note being edited is not focused (yet): it belongs to the note.
      editor.chain().focus('end').insertContent(e.key).run();
      e.preventDefault();
      return;
    }
    if (e.type === 'keydown' && e.key === 'Escape' && editing && isTyping(e.target)) {
      // Fields inside a card: leave editing (the note editor handles its own Escape).
      (e.target as HTMLElement).blur();
      setEditing(null);
      return;
    }
    if (e.type !== 'keydown' || isTyping(e.target) || palette) return;
    const cmd = commandFor(e);
    if (!cmd) return;
    if (cmd.kind === 'edit' && onArrowStyleButton(e.target)) return;
    const single = selection.size === 1 ? snap.byId.get([...selection][0] ?? '') : undefined;
    switch (cmd.kind) {
      case 'tool':
        setTool(cmd.tool);
        break;
      case 'add':
        if (readOnly) return;
        void add(cmd.type);
        break;
      case 'palette':
        setPalette(true);
        break;
      case 'delete':
        removeSelection();
        break;
      case 'undo':
        if (readOnly) return;
        store.undo.undo();
        break;
      case 'redo':
        if (readOnly) return;
        store.undo.redo();
        break;
      case 'duplicate':
        duplicate();
        break;
      case 'selectAll':
        select(snap.canvas.map((x) => x.id));
        break;
      case 'escape':
        setMenu(null);
        if (tool === 'arrow') setTool('select');
        else if (cropping) setCropping(null);
        else if (editing) setEditing(null);
        else setSelection(EMPTY_SET);
        break;
      case 'edit':
        if (cropping) setCropping(null);
        else if (single) openElement(single);
        break;
      case 'rename':
        if (
          !readOnly &&
          single &&
          single.type === 'board' &&
          !single.locked &&
          canRenameBoard(boards?.find((b) => b.id === single.boardId))
        ) {
          setEditing(single.id);
        }
        break;
      case 'crop':
        if (!readOnly && single?.type === 'image' && !single.locked) {
          setCropping((prev) => (prev === single.id ? null : single.id));
        }
        break;
      case 'lock':
        toggleLock();
        break;
      case 'front':
        if (!readOnly) bringToFront(doc, [...selection], LOCAL);
        break;
      case 'back':
        if (!readOnly) sendToBack(doc, [...selection], LOCAL);
        break;
      case 'nudge': {
        if (readOnly) return;
        const els = [...selection]
          .map((id) => snap.byId.get(id))
          .filter((x): x is Element => !!x && x.parent === null && !x.locked);
        const cards = els.filter((x) => x.type !== 'arrow');
        doc.transact(() => {
          updateElements(
            doc,
            cards.map((x) => ({ id: x.id, patch: { x: x.x + cmd.dx, y: x.y + cmd.dy } })),
            LOCAL,
          );
          const arrows = els.filter((x): x is ArrowElement => x.type === 'arrow');
          if (arrows.length > 0) moveArrows(doc, arrows, cmd.dx, cmd.dy, cardRect, LOCAL);
          refreshArrows(
            doc,
            arrowsOf(),
            cards.map((x) => x.id),
            cardRect,
            LOCAL,
          );
        }, LOCAL);
        break;
      }
      case 'zoom':
        zoomTo(cmd.to);
        break;
      case 'help':
        setPalette(true);
        break;
    }
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
    };
  }, []);

  // Clipboard ---------------------------------------------------------------------
  const clipHandler = useRef<(e: ClipboardEvent) => void>(() => {});
  clipHandler.current = (e: ClipboardEvent) => {
    if (insideDialog()) return;
    if (isTyping(e.target) || !e.clipboardData) return;
    if (e.type === 'copy' || e.type === 'cut') {
      if (selection.size === 0) return;
      const data = copyElements(doc, [...selection]);
      encodeClipboard(e.clipboardData, data);
      e.preventDefault();
      if (e.type === 'cut' && !readOnly) deleteElements(doc, selection, LOCAL);
      return;
    }
    if (readOnly) return;
    const p = lastPointer.current ?? { x: size.w / 2, y: size.h / 2 };
    const at = screenToWorld(vp.current, p);
    const data = decodeClipboard(e.clipboardData);
    e.preventDefault();
    if (data) {
      store.undo.stopCapturing();
      select(pasteElements(doc, data, at, { userId, origin: LOCAL }));
      return;
    }
    const files = [...e.clipboardData.files];
    if (files.length > 0) {
      uploadFiles(files, at);
      return;
    }
    addText(e.clipboardData.getData('text/plain'), at);
  };
  useEffect(() => {
    const on = (e: ClipboardEvent) => clipHandler.current(e);
    document.addEventListener('copy', on);
    document.addEventListener('cut', on);
    document.addEventListener('paste', on);
    return () => {
      document.removeEventListener('copy', on);
      document.removeEventListener('cut', on);
      document.removeEventListener('paste', on);
    };
  }, []);

  // Drag and drop from the desktop, the browser and the tool bar.
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (readOnly) return;
    const types = [...e.dataTransfer.types];
    if (types.includes('Files') || types.includes(TOOL_MIME) || types.includes('text/uri-list')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (types.includes('Files')) setDropHint(true);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    setDropHint(false);
    if (readOnly) return;
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    const tool = e.dataTransfer.getData(TOOL_MIME) as ToolType | '';
    if (tool) {
      void add(tool, { x: at.x - 20, y: at.y - 20 });
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length > 0) {
      uploadFiles(files, at);
      return;
    }
    const uri = e.dataTransfer
      .getData('text/uri-list')
      .split('\n')
      .find((l) => l && !l.startsWith('#'));
    addText(uri ?? e.dataTransfer.getData('text/plain'), at);
  }

  // Rendering -------------------------------------------------------------------

  const scale = 2 ** Math.ceil(Math.log2(Math.min(4, Math.max(0.25, viewport.zoom))));
  // Kept as the same object while no label changed: every card reads the context.
  const labelsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const labels = useMemo(() => {
    const all = [...snap.byId.values()];
    const next = all.some((e) => e.type === 'frame') ? frameLabels(storyboardOf(all)) : new Map();
    const prev = labelsRef.current;
    const same = prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v);
    if (!same) labelsRef.current = next;
    return labelsRef.current;
  }, [snap]);
  const largeBoard = snap.byId.size > LARGE_BOARD;
  const ctx = useMemo<BoardContextValue>(
    () => ({
      store,
      readOnly,
      projectId,
      boardId,
      userId,
      boards,
      scale,
      largeBoard,
      editing,
      setEditing,
      cropping,
      setCropping,
      openBoard: onOpenBoard,
      openElement,
      setNoteEditor,
      frameLabels: labels,
    }),
    [
      labels,
      store,
      readOnly,
      projectId,
      boardId,
      userId,
      boards,
      scale,
      largeBoard,
      editing,
      setEditing,
      cropping,
      onOpenBoard,
      setNoteEditor,
      openElement,
    ],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: sizeVersion invalidates measured heights
  const visible = useMemo(() => {
    if (size.w === 0) return [];
    const area = inflate(visibleWorld(viewport, size.w, size.h), OVERSCAN_PX / viewport.zoom);
    return snap.canvas.filter(
      (el) =>
        el.type !== 'arrow' &&
        (selection.has(el.id) || editing === el.id || intersects(store.rectOf(el), area)),
    );
  }, [snap, viewport, size, selection, editing, store, sizeVersion]);

  const arrows = useMemo(
    () => snap.canvas.filter((e): e is ArrowElement => e.type === 'arrow'),
    [snap],
  );
  // Where each arrow is drawn now, following the cards being dragged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sizeVersion invalidates measured heights
  const arrowEndsById = useMemo(() => {
    const out = new Map<string, ArrowGeometry>();
    if (arrows.length === 0) return out;
    const { moving, offset } = overlay;
    const shifted = (id: string) => {
      const r = cardRect(id);
      return r && offset && moving?.has(id) ? { ...r, x: r.x + offset.dx, y: r.y + offset.dy } : r;
    };
    for (const arrow of arrows) {
      const moved = offset && moving?.has(arrow.id);
      const shift = (end: ArrowElement['from']) =>
        moved && !(end.elementId && cardRect(end.elementId))
          ? { ...end, x: end.x + offset.dx, y: end.y + offset.dy }
          : end;
      out.set(
        arrow.id,
        arrowGeometry({ from: shift(arrow.from), to: shift(arrow.to), path: arrow.path }, shifted),
      );
    }
    return out;
  }, [arrows, overlay, cardRect, sizeVersion]);

  const selectedEls = useMemo(
    () => [...selection].map((id) => snap.byId.get(id)).filter((e): e is Element => !!e),
    [selection, snap],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: sizeVersion invalidates measured heights
  const selectionBox = useMemo(() => {
    const free = selectedEls.filter((e) => e.parent === null);
    const b = boundsOf(free.map(liveRect));
    if (!b) return null;
    const a = worldToScreen(viewport, { x: b.x, y: b.y });
    return { x: a.x, y: a.y, w: b.w * viewport.zoom, h: b.h * viewport.zoom };
  }, [selectedEls, viewport, liveRect, sizeVersion]);

  const visibleCards = useMemo(() => snap.canvas.filter((e) => e.type !== 'arrow'), [snap]);
  const frameOf = (id: string | null) => {
    const el = id ? snap.byId.get(id) : undefined;
    return el?.type === 'frame' ? el : null;
  };
  const panelFrame = frameOf(framePanel);
  const storyCard = (() => {
    const el = storyPanel ? snap.byId.get(storyPanel) : undefined;
    return el?.type === 'character' || el?.type === 'location' ? el : undefined;
  })();
  const drawnFrame = frameOf(drawing);
  // Shooting order, for the editor's strip and onion skin; only while a drawing is open.
  const storyFrames = useMemo(
    () => (drawing ? storyboardOf([...snap.byId.values()]).flatMap((g) => g.frames) : []),
    [drawing, snap],
  );
  // Only while the viewer is open; in reading order (top to bottom, then left to right).
  const viewableElements = useMemo(
    () => (viewing ? viewableInOrder([...snap.byId.values()], guest) : []),
    [viewing, snap, guest],
  );
  const viewedEl = viewing ? snap.byId.get(viewing) : undefined;
  const viewed =
    viewedEl?.type === 'image' ||
    viewedEl?.type === 'file' ||
    (viewedEl?.type === 'link' && isVideoLink(viewedEl.url))
      ? viewedEl
      : null;
  const viewedIndex = viewed ? viewableElements.findIndex((el) => el.id === viewed.id) : -1;
  const closeViewer = useCallback(() => {
    setViewing(null);
  }, []);

  const addTemplate = async (id: TemplateId) => {
    if (readOnly) return;
    const rect = templateRect(
      id,
      screenToWorld(vp.current, { x: size.w / 2, y: size.h / 2 }),
      store.getSnapshot().canvas.map((e) => store.rectOf(e)),
    );
    if (id === 'storyboard') {
      try {
        const board = await createBoard(
          projectId,
          boardId,
          t('templates.storyboard.name'),
          'storyboard',
        );
        store.undo.stopCapturing();
        const card = createElement(
          doc,
          'board',
          rect,
          { boardId: board.id },
          { userId, origin: LOCAL },
        );
        store.undo.stopCapturing();
        select([card.id]);
        onOpenBoard(board.id, 'storyboard');
      } catch {
        setToast({ text: t('board.errors.storyboardCreate'), undo: false });
      }
      return;
    }
    store.undo.stopCapturing();
    const ids = applyTemplate(doc, id, rect, templateLabels(t), { userId, origin: LOCAL });
    store.undo.stopCapturing();
    select(ids);
    setViewport(fitRect(rect, size.w, size.h));
  };

  // A search result links to ?el=<id>: select that card and bring it into view, once.
  const focusId = params.get('el');
  useEffect(() => {
    if (preview || !focusId || conn.status !== 'synced' || size.w === 0) return;
    const el = snap.byId.get(focusId);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('el');
        return next;
      },
      { replace: true },
    );
    if (!el) return;
    const top = el.parent && snap.byId.get(el.parent);
    const target = el.parent === null ? el : top && top.parent === null ? top : null;
    select([el.id]);
    if (target) {
      const r = liveRect(target);
      setViewport(centerOn(vp.current, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, size.w, size.h));
    }
    if (el.parent === UNSORTED) setUnsortedOpen(true);
  }, [preview, focusId, conn.status, size, snap, liveRect, select, setParams, setViewport]);

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    if (selection.size === 0) {
      return readOnly
        ? []
        : [
            { label: t('board.menu.newNote'), action: () => void add('note', menu.at) },
            { label: t('board.menu.newColumn'), action: () => void add('column', menu.at) },
            {
              label: t('board.palette.add', { type: t('board.types.frame') }),
              action: () => void add('frame', menu.at),
            },
            {
              label: t('board.palette.add', { type: t('board.types.scene') }),
              action: () => void add('scene', menu.at),
            },
          ];
    }
    const locked = selectedEls.some((e) => e.locked);
    const single = selectedEls.length === 1 ? selectedEls[0] : undefined;
    const coverItem = (assetId: string): MenuItem => {
      const isCover = boards?.find((b) => b.id === boardId)?.coverAssetId === assetId;
      return {
        label: t(isCover ? 'board.menu.removeCover' : 'board.menu.setCover'),
        action: () =>
          void setBoardCover(projectId, boardId, isCover ? null : assetId).then(
            () =>
              setToast({
                text: t(isCover ? 'board.menu.coverRemoved' : 'board.menu.coverSet'),
                undo: false,
              }),
            () => setToast({ text: t('board.menu.coverFailed'), undo: false }),
          ),
      };
    };
    const items: MenuItem[] = [
      ...(single?.type === 'link' && !readOnly && !single.locked
        ? [
            {
              label: t('board.menu.refreshPreview'),
              action: () =>
                void fillLinkPreview(doc, single.id, projectId, boardId, single.url).then((ok) => {
                  if (!ok) setToast({ text: t('board.menu.refreshPreviewFailed'), undo: false });
                }),
            },
          ]
        : []),
      ...(single && (single.type === 'board' || single.type === 'link')
        ? [{ label: t('board.menu.open'), action: () => openElement(single) }]
        : []),
      ...(single &&
      single.type === 'board' &&
      !readOnly &&
      !single.locked &&
      canRenameBoard(boards?.find((b) => b.id === single.boardId))
        ? [{ label: t('board.menu.rename'), shortcut: 'F2', action: () => setEditing(single.id) }]
        : []),
      ...(single && (single.type === 'image' || single.type === 'file')
        ? [{ label: t('board.menu.viewImage'), action: () => openElement(single) }]
        : []),
      ...(single?.type === 'image' && !readOnly && !single.locked
        ? [
            {
              toolbar: true,
              label: t('board.image.cropRotate'),
              shortcut: 'X',
              action: () => setCropping(single.id),
            },
            ...(hasImageTransform(single)
              ? [
                  {
                    toolbar: true,
                    label: t('board.image.restoreOriginal'),
                    action: () => restoreOriginalImage(store, single),
                  },
                ]
              : []),
          ]
        : []),
      ...(single &&
      (single.type === 'image' || single.type === 'file') &&
      !readOnly &&
      !single.locked
        ? [{ label: t('board.caption.edit'), action: () => setEditing(single.id) }]
        : []),
      ...(single?.type === 'image' &&
      single.assetId &&
      !readOnly &&
      !preview &&
      canRenameBoard(boards?.find((b) => b.id === boardId))
        ? [coverItem(single.assetId)]
        : []),
      ...(single?.type === 'note'
        ? [{ label: t('board.menu.openDoc'), action: () => openElement(single) }]
        : []),
      ...(single?.type === 'frame'
        ? [
            { label: t('board.menu.details'), action: () => openElement(single) },
            ...(readOnly
              ? []
              : [{ label: t('board.menu.draw'), action: () => setDrawing(single.id) }]),
          ]
        : []),
      ...(single && single.type !== 'arrow' && !preview
        ? [
            {
              toolbar: true,
              label: t('comments.open'),
              action: () => openComments({ elementId: single.id }),
            },
          ]
        : []),
      ...(onExportSelection && !preview
        ? [{ label: t('export.openSelection'), action: onExportSelection }]
        : []),
      ...(readOnly
        ? []
        : [
            ...(selectedEls.some((e) => e.type !== 'arrow')
              ? [
                  {
                    toolbar: true,
                    label: t(
                      selectedEls.filter((e) => e.type !== 'arrow').every((e) => e.guestHidden)
                        ? 'guestVisibility.show'
                        : 'guestVisibility.hide',
                    ),
                    action: () => toggleGuestHidden(store, [...selection]),
                  },
                ]
              : []),
            {
              toolbar: true,
              label: t('board.menu.tags'),
              action: () => setTagging({ x: menu.x, y: menu.y, ids: [...selection] }),
            },
            { toolbar: true, label: t('board.menu.duplicate'), shortcut: '⌘D', action: duplicate },
            {
              toolbar: true,
              label: locked ? t('board.menu.unlock') : t('board.menu.lock'),
              shortcut: '⌘L',
              action: toggleLock,
            },
            {
              label: t('board.menu.front'),
              shortcut: '⌘]',
              action: () => bringToFront(doc, [...selection], LOCAL),
            },
            {
              label: t('board.menu.back'),
              shortcut: '⌘[',
              action: () => sendToBack(doc, [...selection], LOCAL),
            },
            {
              label: t('board.menu.toUnsorted'),
              action: () => moveToUnsorted(doc, [...selection], LOCAL),
            },
            ...(menu.fromToolbar ? [] : [{ divider: true as const }]),
            {
              toolbar: true,
              label: t('board.menu.delete'),
              shortcut: '⌫',
              danger: true,
              action: removeSelection,
            },
          ]),
    ];
    // These flags mark actions actually rendered by ContextBar for the same selection.
    // Standalone right-click menus keep the complete permission-filtered action list.
    return menu.fromToolbar ? items.filter((item) => !('toolbar' in item && item.toolbar)) : items;
  }, [
    menu,
    selection,
    selectedEls,
    boards,
    boardId,
    projectId,
    readOnly,
    preview,
    t,
    add,
    duplicate,
    toggleLock,
    store,
    removeSelection,
    openElement,
    doc,
    setEditing,
    onExportSelection,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sizeVersion invalidates measured heights
  const rectOf = useCallback((el: Element) => store.rectOf(el), [store, sizeVersion]);
  const draggingNested = overlay.ghost ? new Set([overlay.ghost.element.id]) : undefined;
  /** Cards with a selection outline or handles, their own or a nested card's. */
  /** Where a card someone else selected sits on the board; nested cards show their column. */
  const peerRect = (id: string) => {
    let el = snap.byId.get(id);
    if (el?.parent) el = snap.byId.get(el.parent);
    return el ? store.rectOf(el) : null;
  };

  const drawsOutline = (el: Element) =>
    selection.has(el.id) ||
    !!overlay.moving?.has(el.id) ||
    (isContainer(el) && !!snap.columns.get(el.id)?.some((c) => selection.has(c.id)));

  const croppingElement =
    !readOnly &&
    cropping &&
    selectedEls.length === 1 &&
    selectedEls[0]?.id === cropping &&
    selectedEls[0].type === 'image' &&
    !selectedEls[0].locked
      ? selectedEls[0]
      : null;

  return (
    <BoardContext.Provider value={ctx}>
      <div
        ref={rootRef}
        tabIndex={-1}
        className={[
          'canvas',
          tool === 'hand' || spaceDown.current ? 'canvas--hand' : '',
          tool === 'arrow' ? 'canvas--arrow' : '',
          gesture.current?.kind === 'pan' ? 'canvas--panning' : '',
        ].join(' ')}
        onPointerDown={outsideDialogs(onPointerDown)}
        onPointerMove={outsideDialogs(onPointerMove)}
        onPointerLeave={() => presence.cursor(null)}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onLostPointerCapture}
        onDoubleClick={outsideDialogs(onDoubleClick)}
        onContextMenu={outsideDialogs(onContextMenu)}
        onDragOver={outsideDialogs(onDragOver)}
        onDragLeave={() => setDropHint(false)}
        onDrop={outsideDialogs(onDrop)}
        data-testid="canvas"
        aria-label={t('board.canvas')}
        role="application"
      >
        <Dots viewport={viewport} />
        <div
          className={
            viewport.zoom < FAR_ZOOM ? 'canvas__world canvas__world--far' : 'canvas__world'
          }
          style={{
            transform: `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
          }}
        >
          {visible.map((el) => (
            <Card
              key={el.id}
              element={el}
              selected={selection.has(el.id)}
              offset={overlay.moving?.has(el.id) ? overlay.offset : undefined}
              resize={overlay.resize?.id === el.id ? overlay.resize : undefined}
              childrenOf={isContainer(el) ? snap.columns.get(el.id) : undefined}
              selection={isContainer(el) ? selection : undefined}
              draggingIds={isContainer(el) ? draggingNested : undefined}
              zoom={drawsOutline(el) ? viewport.zoom : undefined}
            />
          ))}
          {!readOnly &&
            !overlay.offset &&
            visible
              .filter(
                (el) =>
                  selection.has(el.id) &&
                  el.id !== cropping &&
                  !el.locked &&
                  el.parent === null &&
                  el.type !== 'arrow',
              )
              .map((el) => {
                const rect = overlay.resize?.id === el.id ? overlay.resize : liveRect(el);
                return <ResizeHandles key={el.id} id={el.id} rect={rect} zoom={viewport.zoom} />;
              })}
          <PresenceLayer peers={peers} zoom={viewport.zoom} rectOf={peerRect} />
          {overlay.ghost && (
            <div
              className="canvas__ghost"
              style={{
                left: overlay.ghost.x,
                top: overlay.ghost.y,
                width: overlay.ghost.w,
                ['--zoom' as string]: viewport.zoom,
              }}
            >
              <Card element={overlay.ghost.element} nested selected />
            </div>
          )}
          {(arrows.length > 0 || overlay.arrow) && (
            <ArrowLayer
              doc={doc}
              arrows={arrows}
              ends={arrowEndsById}
              selection={selection}
              editing={editing}
              draft={overlay.arrow}
              onDone={() => setEditing(null)}
            />
          )}
          {overlay.guides?.map((g) => (
            <span
              key={`${g.axis}-${g.at}`}
              className={`canvas__guide canvas__guide--${g.axis}`}
              style={
                g.axis === 'x'
                  ? {
                      left: g.at,
                      top: g.from,
                      height: g.to - g.from,
                      ['--zoom' as string]: viewport.zoom,
                    }
                  : {
                      top: g.at,
                      left: g.from,
                      width: g.to - g.from,
                      ['--zoom' as string]: viewport.zoom,
                    }
              }
            />
          ))}
        </div>

        {overlay.marquee && (
          <div
            className="canvas__marquee"
            style={{
              left: overlay.marquee.x,
              top: overlay.marquee.y,
              width: overlay.marquee.w,
              height: overlay.marquee.h,
            }}
          />
        )}
        {overlay.drop?.kind === 'column' && (
          <div
            className="canvas__insert"
            style={{
              left: overlay.drop.line.x,
              top: overlay.drop.line.y,
              width: overlay.drop.line.w,
            }}
          />
        )}
        {dropHint && <div className="canvas__drophint">{t('board.dropFiles')}</div>}

        {snap.canvas.length === 0 && conn.status === 'synced' && !readOnly && (
          <div className="canvas__empty">
            <span className="canvas__empty-title">{t('board.empty.title')}</span>
            {/* A finger gets its own wording, without the keyboard tip (board.css). */}
            <span className="ink-muted canvas__empty-pointer">{t('board.empty.body')}</span>
            <span className="ink-muted canvas__empty-touch">{t('board.empty.bodyTouch')}</span>
            <span className="canvas__templates-title">{t('board.empty.templates')}</span>
            <div className="canvas__templates" data-chrome>
              {TEMPLATE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="canvas__template"
                  onClick={() => void addTemplate(id)}
                >
                  <span className="canvas__template-name">{t(`templates.${id}.name`)}</span>
                  <span className="ink-muted">{t(`templates.${id}.body`)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!overlay.offset &&
          !overlay.marquee &&
          selectionBox &&
          (croppingElement ? (
            <ImageCropToolbar
              box={selectionBox}
              element={croppingElement}
              onDone={() => setCropping(null)}
            />
          ) : (
            <ContextBar
              box={selectionBox}
              elements={selectedEls}
              editor={editing ? noteEditor.current : null}
              readOnly={readOnly}
              onComments={
                !preview &&
                selectedEls.length === 1 &&
                selectedEls[0] &&
                selectedEls[0].type !== 'arrow'
                  ? openComments.bind(null, { elementId: selectedEls[0].id })
                  : undefined
              }
              onAlign={align}
              onGroup={groupIntoColumn}
              onLock={toggleLock}
              onGuestHidden={() => toggleGuestHidden(store, [...selection])}
              onDelete={removeSelection}
              onDuplicate={duplicate}
              onMore={(x, y) =>
                setMenu({ x, y, at: screenToWorld(vp.current, { x, y }), fromToolbar: true })
              }
              onColor={(color) => {
                for (const el of selectedEls) {
                  if (el.type === 'note') updateElement(doc, el.id, { color }, LOCAL);
                }
              }}
              onTags={(x, y) => setTagging({ x, y, ids: [...selection] })}
              extra={
                <>
                  {!readOnly &&
                    selectedEls.length === 1 &&
                    selectedEls[0]?.type === 'image' &&
                    !selectedEls[0].locked && (
                      <>
                        <BarButton
                          icon="crop"
                          label={t('board.image.cropRotate')}
                          active={cropping === selectedEls[0].id}
                          onClick={() =>
                            setCropping((prev) =>
                              prev === selectedEls[0]?.id ? null : (selectedEls[0]?.id ?? null),
                            )
                          }
                        />
                        {hasImageTransform(selectedEls[0]) && (
                          <BarButton
                            icon="undo"
                            label={t('board.image.restoreOriginal')}
                            onClick={() => {
                              const img = selectedEls[0];
                              if (img?.type === 'image') restoreOriginalImage(store, img);
                            }}
                          />
                        )}
                      </>
                    )}
                  {selectedEls.every((e) => e.type === 'arrow') && (
                    <ArrowStyleButtons
                      doc={doc}
                      arrows={selectedEls as ArrowElement[]}
                      rectOf={cardRect}
                      onLabel={
                        selectedEls.length === 1 && selectedEls[0] && !selectedEls[0].locked
                          ? setEditing.bind(null, selectedEls[0].id)
                          : undefined
                      }
                    />
                  )}
                </>
              }
            />
          ))}
        {tagging && (
          <TagPopover
            x={tagging.x}
            y={tagging.y}
            projectId={projectId}
            elements={tagging.ids.map((id) => snap.byId.get(id)).filter((e) => e !== undefined)}
            onChange={(changes) =>
              updateElements(
                doc,
                changes.map((c) => ({ id: c.id, patch: { tags: c.tags } })),
                LOCAL,
              )
            }
            onClose={() => setTagging(null)}
          />
        )}
        {noteSheet && (
          <NoteSideSheet
            key={noteSheet}
            breadcrumb={breadcrumb ?? [boards?.find((board) => board.id === boardId)?.title ?? '']}
            onComments={
              !guest && !preview
                ? () => {
                    setNoteSheet(null);
                    openComments({ elementId: noteSheet });
                  }
                : undefined
            }
            noteId={noteSheet}
            store={store}
            readOnly={readOnly}
            onClose={() => setNoteSheet(null)}
            onEditOnCanvas={() => {
              setEditing(noteSheet);
              setNoteSheet(null);
            }}
          />
        )}
        {panelFrame && (
          <div className="canvas__panel">
            <FramePanel
              store={store}
              userId={userId}
              frame={panelFrame}
              label={labels.get(panelFrame.id) ?? ''}
              boardAspect={boardAspect}
              projectId={projectId}
              boardId={boardId}
              readOnly={readOnly}
              onClose={() => setFramePanel(null)}
              onDraw={() => setDrawing(panelFrame.id)}
            />
          </div>
        )}
        {storyCard && !panelFrame && (
          <div className="canvas__panel">
            <StoryCardPanel
              key={storyCard.id}
              store={store}
              card={storyCard}
              projectId={projectId}
              boardId={boardId}
              readOnly={readOnly}
              onClose={() => setStoryPanel(null)}
            />
          </div>
        )}
        {drawnFrame && (
          <DrawingEditor
            store={store}
            frame={drawnFrame}
            label={labels.get(drawnFrame.id) ?? ''}
            boardAspect={boardAspect}
            readOnly={readOnly}
            userId={userId}
            projectId={projectId}
            boardId={boardId}
            frames={storyFrames}
            labels={labels}
            onPick={setDrawing}
            onClose={() => setDrawing(null)}
          />
        )}
        {/* On the body: the canvas's touch-action and gesture handlers would block pinch-zoom. */}
        {viewed &&
          createPortal(
            <MediaViewer
              store={store}
              element={viewed}
              projectId={projectId}
              userId={userId}
              readOnly={readOnly}
              onClose={closeViewer}
              gallery={
                viewableElements.length > 1 && viewedIndex >= 0
                  ? {
                      index: viewedIndex,
                      total: viewableElements.length,
                      onPrevious: () => {
                        const prev = viewableElements[viewedIndex - 1];
                        if (prev) setViewing(prev.id);
                      },
                      onNext: () => {
                        const next = viewableElements[viewedIndex + 1];
                        if (next) setViewing(next.id);
                      },
                      onSelect: (idx: number) => {
                        const target = viewableElements[idx];
                        if (target) setViewing(target.id);
                      },
                      items: viewableElements.map((el) => ({
                        id: el.id,
                        assetId: el.type === 'link' ? el.imageAssetId : el.assetId,
                        filename:
                          el.type === 'link'
                            ? el.title || el.url
                            : el.type === 'image'
                              ? el.caption
                              : 'name' in el && typeof el.name === 'string'
                                ? el.name
                                : undefined,
                        type: el.type,
                      })),
                      usedIn: [],
                    }
                  : undefined
              }
            />,
            document.body,
          )}

        {menu && menuItems.length > 0 && (
          <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
        )}

        {/* Guests don't see the unsorted tray; members and previews still do. */}
        {!guest && (
          <UnsortedDrawer
            ref={unsortedRef}
            items={snap.unsorted}
            open={unsortedOpen}
            onToggle={() => setUnsortedOpen((o) => !o)}
            selection={selection}
            dropping={overlay.drop?.kind === 'unsorted'}
            dragging={overlay.moving !== undefined}
            draggingIds={draggingNested}
          />
        )}
        <div className="canvas__corner" data-chrome>
          <Minimap
            elements={visibleCards}
            rectOf={rectOf}
            viewport={viewport}
            size={size}
            onJump={(p) => setViewport(centerOn(vp.current, p, size.w, size.h))}
          />
          <ZoomControls zoom={viewport.zoom} onZoom={zoomTo} />
        </div>
        {!readOnly && (
          <Toolbar
            tool={tool}
            onTool={setTool}
            onAdd={(type) => void add(type)}
            onCanvas={(template) => void insertCanvas(template)}
            onScreenplay={() => setImportingScript(true)}
          />
        )}
        <UploadPanel />
        {/* On the body: the dialog is the viewport's, not a card of the board. */}
        {importingScript &&
          createPortal(
            <ScreenplayImportDialog
              targets={['new']}
              onImport={insertScreenplay}
              onClose={() => setImportingScript(false)}
            />,
            document.body,
          )}
        {linkDraft && (
          <LinkDraft
            at={worldToScreen(viewport, linkDraft.at)}
            onCancel={() => setLinkDraft(null)}
            onSubmit={(url) => {
              const el = createElement(
                doc,
                'link',
                linkDraft.at,
                { url },
                { userId, origin: LOCAL },
              );
              setLinkDraft(null);
              select([el.id]);
              void fillLinkPreview(doc, el.id, projectId, boardId, url);
            }}
          />
        )}
        {palette && (
          <CommandPalette
            readOnly={readOnly}
            onClose={() => setPalette(false)}
            onAdd={(type) => void add(type)}
            onTemplate={(id) => void addTemplate(id)}
            onZoom={zoomTo}
            onUndo={() => store.undo.undo()}
            onRedo={() => store.undo.redo()}
            onToggleUnsorted={() => setUnsortedOpen((o) => !o)}
          />
        )}
        {toast && (
          <Toast
            text={toast.text}
            onUndo={toast.undo ? () => store.undo.undo() : undefined}
            onClose={closeToast}
          />
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            uploadFiles(files, pendingImageAt.current ?? center());
          }}
        />
      </div>
    </BoardContext.Provider>
  );
}

/**
 * A dialog is a child of the board in React's tree even though it sits in the top layer (or on
 * the body), so its pointer and drop events bubble up to the board: pressing Cancel would start
 * a marquee and a double click would add a note. The board leaves those events alone.
 */
function outsideDialogs<E extends { target: EventTarget }>(handler: (e: E) => void) {
  return (e: E) => {
    if ((e.target as HTMLElement).closest?.('dialog')) return;
    handler(e);
  };
}

function LinkDraft({
  at,
  onSubmit,
  onCancel,
}: {
  at: Point;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  return (
    <form
      className="canvas__linkdraft"
      style={{ left: at.x, top: at.y }}
      data-chrome
      onSubmit={(e) => {
        e.preventDefault();
        const url = /^[a-z]+:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
        const href = webUrl(url);
        if (href) onSubmit(href);
        else setError(true);
      }}
    >
      <input
        className="ink-input"
        // biome-ignore lint/a11y/noAutofocus: the field opens because the user picked the link tool
        autoFocus
        value={value}
        placeholder={t('board.link.placeholder')}
        aria-label={t('board.link.label')}
        aria-invalid={error || undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onBlur={() => !value && onCancel()}
      />
    </form>
  );
}
