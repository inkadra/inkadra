import {
  type Alignment,
  type ArrowElement,
  addScene,
  alignRects,
  applyTemplate,
  arrowEnds,
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
  duplicateElements,
  fitRect,
  frameLabels,
  type Guide,
  inflate,
  intersects,
  isContainer,
  listElements,
  MIN_WIDTH,
  moveArrows,
  moveIntoParent,
  moveToCanvas,
  moveToUnsorted,
  nextZoomStep,
  type Point,
  pasteElements,
  type Rect,
  rectFromPoints,
  refreshArrows,
  screenToWorld,
  segmentBox,
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
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import * as Y from 'yjs';
import { useSession } from '../lib/session.tsx';
import { accessNotices } from './access-notices.ts';
import { ArrowLayer } from './arrows.tsx';
import { canRenameBoard, createBoard } from './boards.ts';
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
  Toast,
  Toolbar,
  type ToolType,
  UnsortedDrawer,
  UploadPanel,
  ZoomControls,
} from './chrome.tsx';
import { decodeClipboard, encodeClipboard } from './clipboard.ts';
import type { BoardConnection } from './connection.ts';
import { BoardContext, type BoardContextValue } from './context.ts';
import { useBoardAspect } from './film/aspect.ts';
import { DrawingEditor } from './film/DrawingEditor.tsx';
import { FramePanel } from './film/FramePanel.tsx';
import { toggleGuestHidden } from './guest-visibility.tsx';
import { fillLinkPreview, webUrl } from './links.ts';
import { fillFragment, isEmpty } from './note.tsx';
import { PresenceLayer } from './PresenceLayer.tsx';
import { type Peer, useLocalPresence } from './presence.ts';
import { openComments } from './review-store.ts';
import { commandFor, isTyping } from './shortcuts.ts';
import { LOCAL } from './store.ts';
import { TagPopover } from './tags.tsx';
import { startUpload } from './uploads.ts';
import { MediaViewer } from './viewer.tsx';
import { loadViewport, saveViewport } from './viewport.ts';

const DRAG_THRESHOLD = 3;
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
  | { kind: 'resize'; id: string; edge: 'e' | 'w'; start: Point; x: number; w: number }
  | { kind: 'arrow'; start: Point; fromId: string | null };

interface Overlay {
  offset?: { dx: number; dy: number };
  moving?: Set<string>;
  ghost?: { element: Element; x: number; y: number; w: number };
  guides?: Guide[];
  marquee?: Rect;
  drop?: { kind: 'column'; id: string; index: number; line: Rect } | { kind: 'unsorted' };
  resize?: { id: string; x: number; w: number };
  arrow?: { a: Point; b: Point };
}

const NO_OVERLAY: Overlay = {};
const EMPTY_SET: ReadonlySet<string> = new Set();

export interface CanvasProps {
  conn: BoardConnection;
  projectId: string;
  boardId: string;
  userId: string;
  boards: Board[] | null;
  canEdit: boolean;
  preview?: boolean;
  initialSelection?: ReadonlySet<string>;
  peers: Peer[];
  onOpenBoard: (boardId: string) => void;
  /** Told whenever the selection changes. */
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  /** Opens an image, file or frame in a view of the page's own; return false for the default. */
  onOpen?: (el: Element) => boolean;
}

/**
 * Keys belong to an open dialog, also to a modal one whose focused button was disabled
 * while a request runs: then Escape reaches the dialog instead of the canvas.
 */
const insideDialog = () =>
  !!document.activeElement?.closest('dialog[open]') || !!document.querySelector('dialog:modal');

export function Canvas({
  conn,
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
}: CanvasProps) {
  const { t } = useTranslation();
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
      const { a, b } = arrowEnds(el, cardRect);
      return segmentBox(a, b);
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
  const [tool, setTool] = useState<CanvasTool>('select');
  /** Frame whose details panel is open, frame being drawn, image or video in the viewer. */
  const [framePanel, setFramePanel] = useState<string | null>(null);
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
  const [menu, setMenu] = useState<{ x: number; y: number; at: Point } | null>(null);
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
    (id: string | null) => {
      const previous = editingRef.current;
      editingRef.current = id;
      setEditingState(id);
      if (previous === id) return;
      noteEditor.current = null;
      if (!id) pendingText.current = null;
      // A note left empty disappears, as on paper. Not an undo step of its own.
      const body = previous ? store.map(previous)?.get('body') : null;
      if (previous && body instanceof Y.XmlFragment && isEmpty(body))
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

  // First visit: fit the content once the document has arrived.
  useEffect(() => {
    if (fitted.current || conn.status !== 'synced' || size.w === 0) return;
    fitted.current = true;
    const bounds = boundsOf(snap.canvas.map(liveRect));
    if (bounds) setViewport(fitRect(bounds, size.w, size.h));
  }, [conn.status, size, snap, liveRect, setViewport]);

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

  // Drop selection entries that were deleted (here or by someone else).
  useEffect(() => {
    setSelection((sel) => {
      if ([...sel].every((id) => snap.byId.has(id))) return sel;
      return new Set([...sel].filter((id) => snap.byId.has(id)));
    });
    if (editing && !snap.byId.has(editing)) setEditing(null);
  }, [snap, editing, setEditing]);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = rootRef.current?.getBoundingClientRect();
    return screenToWorld(vp.current, { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) });
  }, []);

  /** A free spot near the middle of the view, so new cards do not land on each other. */
  const center = useCallback(
    (w = 240): Point => {
      const c = screenToWorld(vp.current, { x: size.w / 2, y: size.h / 2 });
      const at = { x: c.x - w / 2, y: c.y - 60 };
      const rects = store.getSnapshot().canvas.map((e) => store.rectOf(e));
      for (let i = 0; i < 12; i++) {
        const probe = { x: at.x, y: at.y, w, h: 120 };
        if (!rects.some((r) => intersects(inflate(r, 12), probe))) break;
        at.x += 32;
        at.y += 32;
      }
      return at;
    },
    [size, store],
  );

  // Edits ---------------------------------------------------------------------

  const select = useCallback((ids: Iterable<string>) => setSelection(new Set(ids)), []);

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
        case 'storyboard': {
          const story = type === 'storyboard';
          try {
            const board = await createBoard(
              projectId,
              boardId,
              story ? t('board.types.storyboard') : t('board.board.untitled'),
              story ? 'storyboard' : 'board',
            );
            created = createElement(doc, 'board', pos, { boardId: board.id }, opts);
          } catch {
            setToast({
              text: story ? t('board.errors.storyboardCreate') : t('board.errors.boardCreate'),
              undo: false,
            });
            return;
          }
          break;
        }
        case 'frame':
          created = createElement(doc, 'frame', pos, {}, opts);
          select([created.id]);
          setFramePanel(created.id);
          return;
        case 'scene':
          created = addScene(doc, {}, opts, pos);
          break;
      }
      if (created) {
        select([created.id]);
        setEditing(created.id);
      }
    },
    [readOnly, center, userId, store, doc, projectId, boardId, t, select, setEditing],
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
    store.undo.stopCapturing();
    const ids = duplicateElements(doc, [...selection], { x: 24, y: 24 }, { userId, origin: LOCAL });
    select(ids);
  }, [readOnly, selection, store, doc, userId, select]);

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
        if (bounds) setViewport(fitRect(bounds, size.w, size.h, 64, to === 'selection' ? 2 : 1));
      }
    },
    [size, selection, snap, liveRect, setViewport],
  );

  const openElement = useCallback(
    (el: Element) => {
      if (el.type === 'board') onOpenBoard(el.boardId);
      else if (onOpen?.(el)) return;
      else if (el.type === 'link') {
        const href = webUrl(el.url);
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
      } else if (el.type === 'image' || el.type === 'file') {
        setViewing(el.id);
      } else if (el.type === 'frame') {
        select([el.id]);
        setFramePanel(el.id);
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

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    const elNode = target.closest<HTMLElement>('[data-el]');
    if (!elNode && target.closest('[data-chrome]')) return;
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
      const from = elNode ? snap.byId.get(elNode.dataset.el ?? '') : undefined;
      const fromId = from && from.parent === null && from.type !== 'arrow' ? from.id : null;
      gesture.current = { kind: 'arrow', start: screenToWorld(vp.current, p), fromId };
      rootRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (!elNode) {
      if (editing) setEditing(null);
      const base = e.shiftKey ? new Set(selection) : new Set<string>();
      if (!e.shiftKey) setSelection(EMPTY_SET);
      gesture.current = { kind: 'marquee', start: screenToWorld(vp.current, p), base };
      rootRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const id = elNode.dataset.el as string;
    const el = snap.byId.get(id);
    if (!el) return;
    const interactive = target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [data-no-drag]',
    );
    if (editing === id && interactive) return;
    if (editing && editing !== id) setEditing(null);

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
    if (handle === 'e' || handle === 'w') {
      gesture.current = { kind: 'resize', id, edge: handle, start: p, x: el.x, w: el.w };
      rootRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const ids = [...next].filter((i) => !snap.byId.get(i)?.locked);
    if (!ids.includes(id)) return;
    const r = elNode.getBoundingClientRect();
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
      const dx = (p.x - g.start.x) / v.zoom;
      const w = Math.max(MIN_WIDTH, Math.round(g.edge === 'e' ? g.w + dx : g.w - dx));
      const x = g.edge === 'e' ? g.x : g.x + (g.w - w);
      setOverlay({ resize: { id: g.id, x, w } });
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
    const g = gesture.current;
    gesture.current = null;
    if (rootRef.current?.hasPointerCapture(e.pointerId)) {
      rootRef.current.releasePointerCapture(e.pointerId);
    }
    const o = overlayRef.current;
    setOverlay(NO_OVERLAY);
    if (!g) return;
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
      const { x, w } = o.resize;
      doc.transact(() => {
        updateElement(doc, g.id, { x, w }, LOCAL);
        refreshArrows(doc, arrowsOf(), [g.id], cardRect, LOCAL);
      }, LOCAL);
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
    const elNode = target.closest<HTMLElement>('[data-el]');
    if (!elNode) {
      if (target.closest('[data-chrome]') || readOnly) return;
      const at = toWorld(e.clientX, e.clientY);
      void add('note', { x: at.x - 20, y: at.y - 20 });
      return;
    }
    const el = snap.byId.get(elNode.dataset.el as string);
    if (el && editing !== el.id) openElement(el);
  }

  function onContextMenu(e: ReactMouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('[data-chrome]') && !target.closest('[data-el]')) return;
    if (isTyping(target)) return;
    e.preventDefault();
    const id = target.closest<HTMLElement>('[data-el]')?.dataset.el;
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
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setViewport]);

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  // Keyboard --------------------------------------------------------------------
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (insideDialog()) return;
    // A menu or the version banner already handled this Escape; a preview has nothing to clear.
    if (e.key === 'Escape' && (e.defaultPrevented || preview)) return;
    if (e.key === ' ' && !isTyping(e.target)) {
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
        else if (editing) setEditing(null);
        else setSelection(EMPTY_SET);
        break;
      case 'edit':
        if (single) openElement(single);
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
  const ctx = useMemo<BoardContextValue>(
    () => ({
      store,
      readOnly,
      projectId,
      boardId,
      userId,
      boards,
      scale,
      editing,
      setEditing,
      openBoard: onOpenBoard,
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
      editing,
      setEditing,
      onOpenBoard,
      setNoteEditor,
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
    const out = new Map<string, { a: Point; b: Point }>();
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
      out.set(arrow.id, arrowEnds({ from: shift(arrow.from), to: shift(arrow.to) }, shifted));
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
  const drawnFrame = frameOf(drawing);
  const viewedEl = viewing ? snap.byId.get(viewing) : undefined;
  const viewed = viewedEl?.type === 'image' || viewedEl?.type === 'file' ? viewedEl : null;
  const closeViewer = useCallback(() => setViewing(null), []);

  const addTemplate = (id: TemplateId) => {
    if (readOnly) return;
    store.undo.stopCapturing();
    const ids = applyTemplate(
      doc,
      id,
      center(1000),
      {
        moodboard: {
          refs: t('templates.moodboard.refs'),
          light: t('templates.moodboard.light'),
          locations: t('templates.moodboard.locations'),
          palette: t('templates.moodboard.palette'),
        },
        storyboard: { scene: t('templates.storyboard.scene') },
        production: {
          todo: t('templates.production.todo'),
          doing: t('templates.production.doing'),
          done: t('templates.production.done'),
        },
      },
      { userId, origin: LOCAL },
    );
    store.undo.stopCapturing();
    select(ids);
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
    return [
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
      ...(single &&
      (single.type === 'image' || single.type === 'file') &&
      !readOnly &&
      !single.locked
        ? [{ label: t('board.caption.edit'), action: () => setEditing(single.id) }]
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
        ? [{ label: t('comments.open'), action: () => openComments({ elementId: single.id }) }]
        : []),
      ...(readOnly
        ? []
        : [
            ...(selectedEls.some((e) => e.type !== 'arrow')
              ? [
                  {
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
              label: t('board.menu.tags'),
              action: () => setTagging({ x: menu.x, y: menu.y, ids: [...selection] }),
            },
            { label: t('board.menu.duplicate'), shortcut: '⌘D', action: duplicate },
            {
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
            { divider: true },
            { label: t('board.menu.delete'), shortcut: '⌫', danger: true, action: removeSelection },
          ]),
    ] as MenuItem[];
  }, [
    menu,
    selection,
    selectedEls,
    boards,
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

  return (
    <BoardContext.Provider value={ctx}>
      <div
        ref={rootRef}
        className={[
          'canvas',
          tool === 'hand' || spaceDown.current ? 'canvas--hand' : '',
          tool === 'arrow' ? 'canvas--arrow' : '',
          gesture.current?.kind === 'pan' ? 'canvas--panning' : '',
        ].join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => presence.cursor(null)}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDragLeave={() => setDropHint(false)}
        onDrop={onDrop}
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
            <span className="ink-muted">{t('board.empty.body')}</span>
            <span className="canvas__templates-title">{t('board.empty.templates')}</span>
            <div className="canvas__templates" data-chrome>
              {TEMPLATE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="canvas__template"
                  onClick={() => addTemplate(id)}
                >
                  <span className="canvas__template-name">{t(`templates.${id}.name`)}</span>
                  <span className="ink-muted">{t(`templates.${id}.body`)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!overlay.offset && !overlay.marquee && selectionBox && !menu && (
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
            onMore={(x, y) => setMenu({ x, y, at: screenToWorld(vp.current, { x, y }) })}
            onColor={(color) => {
              for (const el of selectedEls) {
                if (el.type === 'note') updateElement(doc, el.id, { color }, LOCAL);
              }
            }}
            onTags={(x, y) => setTagging({ x, y, ids: [...selection] })}
            extra={
              selectedEls.every((e) => e.type === 'arrow') && (
                <>
                  <BarButton
                    icon="minus"
                    label={t('board.arrow.dashed')}
                    active={selectedEls.every((e) => e.type === 'arrow' && e.line === 'dashed')}
                    onClick={() => {
                      const dashed = !selectedEls.every(
                        (e) => e.type === 'arrow' && e.line === 'dashed',
                      );
                      updateElements(
                        doc,
                        selectedEls.map((e) => ({
                          id: e.id,
                          patch: { line: dashed ? 'dashed' : undefined },
                        })),
                        LOCAL,
                      );
                    }}
                  />
                  <BarButton
                    icon="arrow"
                    label={t('board.arrow.heads')}
                    onClick={() => {
                      const first = selectedEls[0];
                      const now = first?.type === 'arrow' ? (first.heads ?? 'end') : 'end';
                      const heads = now === 'end' ? 'both' : now === 'both' ? 'none' : undefined;
                      updateElements(
                        doc,
                        selectedEls.map((e) => ({ id: e.id, patch: { heads } })),
                        LOCAL,
                      );
                    }}
                  />
                </>
              )
            }
          />
        )}
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
        {panelFrame && (
          <div className="canvas__panel">
            <FramePanel
              store={store}
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
        {drawnFrame && (
          <DrawingEditor
            store={store}
            frame={drawnFrame}
            label={labels.get(drawnFrame.id) ?? ''}
            boardAspect={boardAspect}
            readOnly={readOnly}
            onClose={() => setDrawing(null)}
          />
        )}
        {viewed && (
          <MediaViewer
            store={store}
            element={viewed}
            projectId={projectId}
            userId={userId}
            readOnly={readOnly}
            onClose={closeViewer}
          />
        )}

        {menu && menuItems.length > 0 && (
          <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
        )}

        <UnsortedDrawer
          ref={unsortedRef}
          items={snap.unsorted}
          open={unsortedOpen}
          onToggle={() => setUnsortedOpen((o) => !o)}
          selection={selection}
          dropping={overlay.drop?.kind === 'unsorted'}
          draggingIds={draggingNested}
        />
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
        {!readOnly && <Toolbar tool={tool} onTool={setTool} onAdd={(type) => void add(type)} />}
        <UploadPanel />
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
