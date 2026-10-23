import {
  type Alignment,
  alignRects,
  boundsOf,
  bringToFront,
  centerOn,
  containsPoint,
  copyElements,
  createElement,
  DEFAULT_WIDTH,
  deleteElements,
  distributeRects,
  dropIndex,
  duplicateElements,
  fitRect,
  type Guide,
  inflate,
  intersects,
  MIN_WIDTH,
  moveIntoParent,
  moveToCanvas,
  moveToUnsorted,
  nextZoomStep,
  type Point,
  pasteElements,
  type Rect,
  rectFromPoints,
  screenToWorld,
  sendToBack,
  snapRect,
  updateElement,
  updateElements,
  type Viewport,
  visibleWorld,
  worldToScreen,
  zoomAt,
} from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
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
import * as Y from 'yjs';
import { useSession } from '../lib/session.tsx';
import { createBoard } from './boards.ts';
import { Card } from './cards.tsx';
import {
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
import { fillLinkPreview, webUrl } from './links.ts';
import { fillFragment, isEmpty } from './note.tsx';
import { commandFor, isTyping } from './shortcuts.ts';
import { LOCAL } from './store.ts';
import { startUpload } from './uploads.ts';
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
  | { kind: 'resize'; id: string; edge: 'e' | 'w'; start: Point; x: number; w: number };

interface Overlay {
  offset?: { dx: number; dy: number };
  moving?: Set<string>;
  ghost?: { element: Element; x: number; y: number; w: number };
  guides?: Guide[];
  marquee?: Rect;
  drop?: { kind: 'column'; id: string; index: number; line: Rect } | { kind: 'unsorted' };
  resize?: { id: string; x: number; w: number };
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
  onOpenBoard: (boardId: string) => void;
}

export function Canvas({
  conn,
  projectId,
  boardId,
  userId,
  boards,
  canEdit,
  onOpenBoard,
}: CanvasProps) {
  const { t } = useTranslation();
  const { instance } = useSession();
  const { store } = conn;
  const doc = store.doc;
  const readOnly = conn.readOnly || !canEdit;
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const sizeVersion = useSyncExternalStore(store.subscribeSizes, store.getSizeVersion);

  const rootRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingImageAt = useRef<Point | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [viewport, setViewportState] = useState<Viewport>(
    () => loadViewport(boardId) ?? { x: -40, y: -40, zoom: 1 },
  );
  const vp = useRef(viewport);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fitted = useRef(loadViewport(boardId) !== null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [editing, setEditingState] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
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
      saveViewport(boardId, value);
      // While the view moves the world and the dots are composited, so a pan only shifts pixels; once it
      // settles the layer goes away and the cards are drawn sharp at the new zoom.
      rootRef.current?.classList.add('canvas--moving');
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(
        () => rootRef.current?.classList.remove('canvas--moving'),
        SETTLE_MS,
      );
    },
    [boardId],
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
    const bounds = boundsOf(snap.canvas.map((e) => store.rectOf(e)));
    if (bounds) setViewport(fitRect(bounds, size.w, size.h));
  }, [conn.status, size, snap, store, setViewport]);

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
        case 'board': {
          try {
            const board = await createBoard(projectId, boardId, t('board.board.untitled'));
            created = createElement(doc, 'board', pos, { boardId: board.id }, opts);
          } catch {
            setToast({ text: t('board.errors.boardCreate'), undo: false });
            return;
          }
          break;
        }
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
            onAsset: (assetId) => {
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
    [readOnly, projectId, doc, userId, store, select, t, instance],
  );

  const addText = useCallback(
    (text: string, at: Point) => {
      const trimmed = text.trim();
      if (!trimmed || readOnly) return;
      const opts = { userId, origin: LOCAL };
      if (/^https?:\/\/\S+$/i.test(trimmed)) {
        const el = createElement(doc, 'link', at, { url: trimmed }, opts);
        select([el.id]);
        void fillLinkPreview(doc, el.id, projectId, trimmed);
        return;
      }
      const el = createElement(doc, 'note', at, {}, opts);
      doc.transact(() => {
        const body = store.map(el.id)?.get('body');
        if (body instanceof Y.XmlFragment) fillFragment(body, trimmed);
      }, LOCAL);
      select([el.id]);
    },
    [readOnly, userId, doc, store, select, projectId],
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
        .filter((e): e is Element => !!e && e.parent === null && !e.locked);
      const rects = els.map((e) => store.rectOf(e));
      const next = how === 'distribute' ? distributeRects(rects) : alignRects(rects, how);
      updateElements(
        doc,
        els.map((e, i) => ({
          id: e.id,
          patch: { x: Math.round(next[i]?.x ?? e.x), y: Math.round(next[i]?.y ?? e.y) },
        })),
        LOCAL,
      );
    },
    [selection, snap, store, doc],
  );

  const groupIntoColumn = useCallback(() => {
    const els = [...selection]
      .map((id) => snap.byId.get(id))
      .filter((e): e is Element => !!e && e.parent === null && e.type !== 'column');
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
        const bounds = boundsOf(els.filter((e) => e !== undefined).map((e) => store.rectOf(e)));
        if (bounds) setViewport(fitRect(bounds, size.w, size.h, 64, to === 'selection' ? 2 : 1));
      }
    },
    [size, selection, snap, store, setViewport],
  );

  const openElement = useCallback(
    (el: Element) => {
      if (el.type === 'board') onOpenBoard(el.boardId);
      else if (el.type === 'link') {
        const href = webUrl(el.url);
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
      } else if (!readOnly && el.type !== 'image' && el.type !== 'file') {
        select([el.id]);
        setEditing(el.id);
      }
    },
    [onOpenBoard, readOnly, select, setEditing],
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
      for (const el of snap.canvas) if (intersects(rect, store.rectOf(el))) hit.add(el.id);
      setSelection(hit);
      const a = worldToScreen(v, { x: rect.x, y: rect.y });
      setOverlay({ marquee: { x: a.x, y: a.y, w: rect.w * v.zoom, h: rect.h * v.zoom } });
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
    const free = els.filter((x) => x.parent === null);
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
    } else if (els.some((x) => x.type !== 'column')) {
      const column = [...snap.canvas]
        .reverse()
        .find(
          (c) =>
            c.type === 'column' &&
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
          .filter((o) => !moving.has(o.id))
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
    if (g.kind === 'resize' && o.resize) {
      updateElement(doc, g.id, { x: o.resize.x, w: o.resize.w }, LOCAL);
      return;
    }
    if (g.kind !== 'move') return;
    if (!g.started) {
      if (g.clickOnly) select([g.clickOnly]);
      return;
    }
    const { dx = 0, dy = 0 } = o.offset ?? {};
    if (o.drop?.kind === 'unsorted') {
      moveToUnsorted(doc, g.ids, LOCAL);
    } else if (o.drop?.kind === 'column') {
      moveIntoParent(doc, g.ids, o.drop.id, o.drop.index, LOCAL);
    } else {
      const world = toWorld(e.clientX, e.clientY);
      let stack = 0;
      const moves = g.ids.flatMap((id) => {
        const el = snap.byId.get(id);
        if (!el) return [];
        if (el.parent === null) return [{ id, x: el.x + dx, y: el.y + dy }];
        // Cards leaving a column or the drawer stack under the pointer.
        const at = { id, x: world.x - g.grab.x, y: world.y - g.grab.y + stack };
        stack += store.heightOf(el) + 12;
        return [at];
      });
      moveToCanvas(doc, moves, LOCAL);
    }
    store.undo.stopCapturing();
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
        if (editing) setEditing(null);
        else setSelection(EMPTY_SET);
        break;
      case 'edit':
        if (single) openElement(single);
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
        const changes = [...selection]
          .map((id) => snap.byId.get(id))
          .filter((x): x is Element => !!x && x.parent === null && !x.locked)
          .map((x) => ({ id: x.id, patch: { x: x.x + cmd.dx, y: x.y + cmd.dy } }));
        updateElements(doc, changes, LOCAL);
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
    }),
    [
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
      (el) => selection.has(el.id) || editing === el.id || intersects(store.rectOf(el), area),
    );
  }, [snap, viewport, size, selection, editing, store, sizeVersion]);

  const selectedEls = useMemo(
    () => [...selection].map((id) => snap.byId.get(id)).filter((e): e is Element => !!e),
    [selection, snap],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: sizeVersion invalidates measured heights
  const selectionBox = useMemo(() => {
    const free = selectedEls.filter((e) => e.parent === null);
    const b = boundsOf(free.map((e) => store.rectOf(e)));
    if (!b) return null;
    const a = worldToScreen(viewport, { x: b.x, y: b.y });
    return { x: a.x, y: a.y, w: b.w * viewport.zoom, h: b.h * viewport.zoom };
  }, [selectedEls, viewport, store, sizeVersion]);

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    if (selection.size === 0) {
      return readOnly
        ? []
        : [
            { label: t('board.menu.newNote'), action: () => void add('note', menu.at) },
            { label: t('board.menu.newColumn'), action: () => void add('column', menu.at) },
          ];
    }
    const locked = selectedEls.some((e) => e.locked);
    const single = selectedEls.length === 1 ? selectedEls[0] : undefined;
    return [
      ...(single && (single.type === 'board' || single.type === 'link')
        ? [{ label: t('board.menu.open'), action: () => openElement(single) }]
        : []),
      ...(readOnly
        ? []
        : [
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
    readOnly,
    t,
    add,
    duplicate,
    toggleLock,
    removeSelection,
    openElement,
    doc,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sizeVersion invalidates measured heights
  const rectOf = useCallback((el: Element) => store.rectOf(el), [store, sizeVersion]);
  const draggingNested = overlay.ghost ? new Set([overlay.ghost.element.id]) : undefined;
  /** Cards with a selection outline or handles, their own or a nested card's. */
  const drawsOutline = (el: Element) =>
    selection.has(el.id) ||
    !!overlay.moving?.has(el.id) ||
    (el.type === 'column' && !!snap.columns.get(el.id)?.some((c) => selection.has(c.id)));

  return (
    <BoardContext.Provider value={ctx}>
      <div
        ref={rootRef}
        className={[
          'canvas',
          tool === 'hand' || spaceDown.current ? 'canvas--hand' : '',
          gesture.current?.kind === 'pan' ? 'canvas--panning' : '',
        ].join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
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
              childrenOf={el.type === 'column' ? snap.columns.get(el.id) : undefined}
              selection={el.type === 'column' ? selection : undefined}
              draggingIds={el.type === 'column' ? draggingNested : undefined}
              zoom={drawsOutline(el) ? viewport.zoom : undefined}
            />
          ))}
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
          </div>
        )}

        {!overlay.offset && !overlay.marquee && selectionBox && !menu && (
          <ContextBar
            box={selectionBox}
            elements={selectedEls}
            editor={editing ? noteEditor.current : null}
            readOnly={readOnly}
            onAlign={align}
            onGroup={groupIntoColumn}
            onLock={toggleLock}
            onDelete={removeSelection}
            onDuplicate={duplicate}
            onMore={(x, y) => setMenu({ x, y, at: screenToWorld(vp.current, { x, y }) })}
            onColor={(color) => {
              for (const el of selectedEls) {
                if (el.type === 'note') updateElement(doc, el.id, { color }, LOCAL);
              }
            }}
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
            elements={snap.canvas}
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
              void fillLinkPreview(doc, el.id, projectId, url);
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
