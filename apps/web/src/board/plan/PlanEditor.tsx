// SPDX-License-Identifier: AGPL-3.0-only
import {
  addBlockingStep,
  addPlanIcon,
  addShape,
  addStroke,
  alignItems,
  bendThrough,
  blockingCurve,
  blockingPositions,
  categoryOf,
  coneEnd,
  DEFAULT_LENS,
  defaultLayer,
  duplicatePlanItems,
  encodeStroke,
  gridLength,
  gridStep,
  iconCone,
  isSized,
  itemBox,
  itemFrame,
  itemsBox,
  itemsInRect,
  layerCounts,
  layerOf,
  measureEnds,
  moveItem,
  normalizeRotation,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanAlign,
  type PlanElement,
  type PlanItem,
  type PlanItemRef,
  type PlanNoteTool,
  type Point,
  planItem,
  planItemAt,
  planItems,
  type ResizeHandle,
  ROTATE_STEP,
  removePlanItems,
  resizeItem,
  rotateItem,
  type SceneElement,
  SYMBOL_PERCENT,
  scaleFor,
  shownAngle,
  snapPlanPoint,
  symbolPercent,
  toGrid,
  toggleGroup,
  updateElement,
  updatePlanItems,
  variantView,
  withGroups,
  withPercent,
  withReachAt,
} from '@inkadra/canvas-core';
import {
  type FrameShape,
  MAX_PLAN_ICONS,
  MAX_SHAPES,
  MAX_STROKES,
  PLAN_ICON_KINDS,
  PLAN_LAYERS,
  type PlanIcon,
  type PlanIconKind,
  type PlanLayer,
  type PlanSensor,
  type PlanShape,
  type PlanStep,
} from '@inkadra/doc-schema';
import {
  Button,
  Checkbox,
  Icon,
  IconButton,
  type IconName,
  Select,
  Slider,
  Switch,
} from '@inkadra/ui';
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { moveTabFocus } from '../../lib/tabs.ts';
import { ContextMenu, type MenuItem } from '../chrome.tsx';
import { pathOf } from '../film/strokes.ts';
import { isMac } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { measureValue } from './kit.ts';
import { NumberField } from './NumberField.tsx';
import { planTitle } from './PlanCard.tsx';
import {
  iconColor,
  measureText,
  NOTE_COLOR,
  PLAN_COLORS,
  PLAN_INK,
  PLAN_PEN,
  PLAN_TEXT,
  PlanDrawing,
  PlanShapeView,
  planCss,
  TEXT_SIZES,
} from './PlanDrawing.tsx';
import { type LibraryItem, PlanLibrary, rememberRecent } from './PlanLibrary.tsx';
import { SceneBadges, ScenePicker, scenesOfPlan } from './scenes.tsx';
import './plan.css';

type DragKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'zone' | 'measure' | 'scale';
type Tool = 'select' | 'pencil' | 'text' | 'icons' | 'move' | DragKind;
type ShapeTool = 'rect' | 'ellipse';
/** What is open over the plan: a menu or a small panel, one at a time. */
type PopKind =
  | 'color'
  | 'lens'
  | 'light'
  | 'label'
  | 'steps'
  | 'layers'
  | 'scale'
  | 'variant'
  | 'more'
  | 'itemMore'
  | 'moveLayer'
  | 'shapes';

/** The tools of the bar at the bottom, in the order of the mockup, with their keys. */
const TOOLS: Array<{ tool: Tool; icon: IconName; key: string }> = [
  { tool: 'select', icon: 'pointer', key: 'V' },
  { tool: 'pencil', icon: 'pen', key: 'P' },
  { tool: 'line', icon: 'line', key: 'L' },
  { tool: 'arrow', icon: 'arrow', key: 'A' },
  { tool: 'rect', icon: 'rect', key: 'Q' },
  { tool: 'ellipse', icon: 'ellipse', key: 'O' },
  { tool: 'text', icon: 'text', key: 'T' },
  { tool: 'measure', icon: 'ruler', key: 'U' },
];
/** Degrees the R key and the menu turn an item by; the rotate handle snaps to ROTATE_STEP. */
const QUARTER_TURN = 45;
/** Two presses on an item within this time (ms) are a double click, by mouse or by finger. */
const DOUBLE_PRESS = 400;
const KINDS = new Set<string>(PLAN_ICON_KINDS);
/** Schema bounds: sizes and reaches up to 4000 view units, a scale up to 100000 per metre. */
const MAX_UNITS = 4000;
const MAX_SCALE = 100000;
/** A finger held this long (ms) on the empty plan starts a selection box. */
const LONG_PRESS = 400;
/** A finger that moves less than this (view units, about 9 px on a phone) has tapped. */
const TAP_SLOP = 24;
/** A set of primes, as on the mockup; Other takes any focal length. */
const LENSES = [18, 24, 35, 50, 85, 135];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const HANDLE_SIGN: Record<ResizeHandle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};
const isIconKind = (item: LibraryItem): item is PlanIconKind => KINDS.has(item);

interface TextDraft {
  at: Point;
  value: string;
  color: string;
}
type Gesture =
  | { kind: 'move'; ref: PlanItemRef; start: Point; item: PlanItem }
  | { kind: 'rotate'; ref: PlanItemRef; centre: Point; from: number; item: PlanItem }
  | { kind: 'draw'; points: Point[] }
  | { kind: 'shape'; shape: DragKind; a: Point; b: Point; raw: [Point, Point] }
  | { kind: 'bend'; index: number; item: PlanIcon }
  | { kind: 'reach'; item: PlanIcon }
  | { kind: 'resize'; handle: ResizeHandle; item: PlanItem }
  | { kind: 'moveMany'; start: Point; items: PlanItem[] }
  | { kind: 'rotateMany'; centre: Point; from: number; items: PlanItem[] }
  | { kind: 'marquee'; a: Point; add: boolean; touch: boolean; at: number; live: boolean }
  | { kind: 'end'; which: 0 | 1; item: PlanShape };

/** View units of a point of the drawing (0 to 1). */
const view = (p: Point): Point => ({ x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H });
const isIcon = (item: PlanItem | null | undefined): item is PlanIcon => !!item && 'x' in item;

const replaceIn = <T extends { id: string }>(
  list: T[] | undefined,
  next: readonly PlanItem[],
): T[] | undefined =>
  list?.map((item) => (next.find((n) => n.id === item.id) as unknown as T | undefined) ?? item);

/** A menu or panel by the button that opens it: under it, or above it low on the screen. */
function popStyle(anchor: DOMRect): CSSProperties {
  return {
    position: 'fixed',
    ...(anchor.left > window.innerWidth / 2
      ? { right: Math.max(8, window.innerWidth - anchor.right) }
      : { left: Math.max(8, anchor.left) }),
    ...(anchor.top > window.innerHeight / 2
      ? { bottom: window.innerHeight - anchor.top + 6 }
      : { top: anchor.bottom + 6 }),
  };
}

/**
 * The editor of a set plan (#335, decision 0071): a window in front of the dimmed board, the plan
 * filling it under one bar of tools at the bottom and one bar that appears on the selected item.
 * Icons, layers and scale open only when asked. On a phone it takes the whole screen, with the
 * bar of the item under the plan and the library as a sheet from the bottom. Every finished line,
 * shape, icon or edit is one change of the document, so it syncs as you go and undo goes back one
 * gesture at a time. The tool, the selection and the grid snap are local to this person.
 */
export function PlanEditor({
  store,
  plan,
  phone,
  scenes,
  base,
  family = [],
  onSwitch,
  onNewVariant,
  lenses = [],
  onOpenScene,
  onClose,
}: {
  store: BoardStore;
  plan: PlanElement;
  phone: boolean;
  /** Scenes of the board, in shooting order, to link the plan to. */
  scenes: readonly SceneElement[];
  /** The base of a variant, whose Set layer it shows and edits (round 6, h). */
  base?: PlanElement | undefined;
  /** The base and its variants, for the tabs of the header. */
  family?: readonly PlanElement[];
  onSwitch?: (id: string) => void;
  onNewVariant?: () => void;
  /** Lenses of the frames of the plan's scenes, proposed for a camera ("5A · 35 mm"). */
  lenses?: ReadonlyArray<{ label: string; mm: number }>;
  onOpenScene: (id: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [tool, setTool] = useState<Tool>('select');
  const [armed, setArmed] = useState<LibraryItem | null>(null);
  const [library, setLibrary] = useState(false);
  const [pop, setPop] = useState<{ kind: PopKind; anchor: DOMRect } | null>(null);
  const popAnchor = useRef<HTMLElement | null>(null);
  const popBox = useRef<HTMLDivElement>(null);
  /** The colour of the next strokes and icons; none picked, each takes its own. */
  const [penColor, setPenColor] = useState<string | null>(null);
  const [shapeTool, setShapeTool] = useState<ShapeTool>('rect');
  /** The text whose words are being written, in the bar over it. */
  const [editingText, setEditingText] = useState<string | null>(null);
  /** The measure being written: its number, then the offer to make it the scale of the plan. */
  const [measureDraft, setMeasureDraft] = useState<{
    id: string;
    value: string;
    wrong: boolean;
    asking: string | null;
    at: Point;
  } | null>(null);
  /** The item of a locked layer that was clicked: it says so instead of doing nothing. */
  const [lockedItem, setLockedItem] = useState<PlanItem | null>(null);
  const lastPress = useRef<{ id: string; at: number } | null>(null);
  /** What a finger pressed on a picked item takes out of the selection if it does not drag. */
  const tapOff = useRef<PlanItemRef[] | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const itemBar = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState(true);
  const [picking, setPicking] = useState<{ x: number; y: number } | null>(null);
  const [otherLens, setOtherLens] = useState(false);
  /** The icon whose route is being drawn, and the veiled copies of its earlier positions. */
  const [moving, setMoving] = useState<string | null>(null);
  const [ghosts, setGhosts] = useState(false);
  /** The angle shown over the rotate handle while it turns. */
  const [chip, setChip] = useState<string | null>(null);
  /** Layers this person hides on the base plan; on a variant hiding is the variant's own. */
  const [myHidden, setMyHidden] = useState<ReadonlySet<PlanLayer>>(new Set());
  /** The layer new strokes and shapes go to (round 6, h). */
  /**
   * The layer new items go to, icons included (round 6, h); none picked, each icon goes to its
   * family's layer and strokes and shapes to Set.
   */
  const [activeLayer, setActiveLayer] = useState<PlanLayer | null>(null);
  /** The line drawn to set the scale, waiting for its length in metres (round 6, g). */
  const [scaleDraft, setScaleDraft] = useState<{ length: number; metres: string } | null>(null);
  const [gridDraft, setGridDraft] = useState<'0.25' | '0.5' | '1'>(plan.grid ?? '0.5');
  const [rulersDraft, setRulersDraft] = useState(plan.rulers ?? true);
  const linked = scenesOfPlan(plan, new Map(scenes.map((s) => [s.id, s])));
  /** The selected items, groups whole (round 6, f). */
  const [selection, setSelection] = useState<PlanItemRef[]>([]);
  const selected = selection.length === 1 ? (selection[0] as PlanItemRef) : null;
  const setSelected = (ref: PlanItemRef | null) =>
    setSelection(ref ? withGroups(drawn, [ref]) : []);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  /** The item being moved or turned, shown in place until the gesture ends. */
  const [preview, setPreviewState] = useState<PlanItem[] | null>(null);
  // The pointer-up handler reads the preview of the last move, which may not be rendered yet.
  const previewRef = useRef<PlanItem[] | null>(null);
  const setPreview = (next: PlanItem | PlanItem[] | null) => {
    const list = next === null ? null : Array.isArray(next) ? next : [next];
    previewRef.current = list;
    setPreviewState(list);
  };
  /** The line being drawn: its points grow in place, a counter redraws it (no copy per move). */
  const [live, setLiveState] = useState<{ points: Point[]; n: number } | null>(null);
  const setLive = (points: Point[] | null) =>
    setLiveState(points ? { points, n: points.length } : null);
  const [liveShape, setLiveShape] = useState<{ kind: DragKind; a: Point; b: Point } | null>(null);
  const [text, setText] = useState<TextDraft | null>(null);
  const textRef = useRef<TextDraft | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const textInput = useRef<HTMLInputElement>(null);

  const doc = store.doc;
  /** Unless a colour was picked, annotations and measures draw green and the other tools in ink. */
  const ink =
    penColor ?? ((armed && !isIconKind(armed)) || tool === 'measure' ? NOTE_COLOR : PLAN_INK);
  /** A variant shows its base's Set layer under its own (round 6, h). */
  // Attached measures are drawn, picked and boxed where their icons stand now.
  const drawn = useMemo(() => {
    const merged = base ? variantView(plan, base) : plan;
    return { ...merged, shapes: merged.shapes?.map((sh) => measureEnds(sh, merged.icons)) };
  }, [plan, base]);
  const step = gridStep(drawn);
  /** The scale belongs to the plan whose Set it measures: the base of a variant. */
  const scaleOwner = base?.id ?? plan.id;
  const baseIds = new Set(
    base ? planItems(drawn).flatMap(({ item }) => (layerOf(item) === 'set' ? [item.id] : [])) : [],
  );
  /** Where an item lives: the base for the shared Set layer of a variant, else the plan. */
  const ownerOf = (id: string) => (base && baseIds.has(id) ? base.id : plan.id);
  const targetFor = (layer: PlanLayer) => (base && layer === 'set' ? base.id : plan.id);
  const hiddenLayers = new Set<PlanLayer>([...(plan.hiddenLayers ?? []), ...myHidden]);
  const viewOf = {
    hidden: hiddenLayers,
    locked: new Set(plan.lockedLayers ?? []),
  };
  /** Strokes and shapes go to the active layer; Set, their default, is not written. */
  const onLayer = activeLayer ? { layer: activeLayer } : {};
  const item = selected ? planItem(drawn, selected) : undefined;
  const movingIcon = (drawn.icons ?? []).find((i) => i.id === moving) ?? null;
  const shown =
    preview === null
      ? drawn
      : {
          ...drawn,
          strokes: replaceIn(drawn.strokes, preview),
          shapes: replaceIn(drawn.shapes, preview),
          icons: replaceIn(drawn.icons, preview),
        };
  const current = preview?.find((p) => p.id === item?.id) ?? item ?? null;
  /** The selected items as drawn, the previews of a gesture included. */
  const liftedIds = useMemo(() => new Set(selection.map((r) => r.id)), [selection]);
  const hiddenList = useMemo(() => [...myHidden], [myHidden]);
  const many = selection.length > 1 ? selection.flatMap((r) => planItem(shown, r) ?? []) : [];

  // The selection loses the items that go (deleted here, by undo or by someone else).
  useEffect(() => {
    if (selection.some((r) => !planItem(drawn, r)))
      setSelection((s) => s.filter((r) => planItem(drawn, r)));
  }, [selection, drawn]);
  useEffect(() => {
    if (text) textInput.current?.focus();
  }, [text]);
  // Another tool ends the movement being drawn.
  useEffect(() => {
    if (tool !== 'move') setMoving(null);
  }, [tool]);
  // Writing a text ends with the selection of that text.
  useEffect(() => {
    if (editingText && selected?.id !== editingText) setEditingText(null);
  }, [editingText, selected?.id]);
  // The bar sits over the item, under it when there is no room, always inside the plan's area.
  useLayoutEffect(() => {
    // No bar while dragging: nothing is measured on those frames.
    const bar = itemBar.current;
    if (!bar || phone) return;
    const held =
      many.length > 1
        ? itemsBox(many)
        : (current ?? lockedItem)
          ? itemBox((current ?? lockedItem) as PlanItem)
          : null;
    const room = bar.offsetParent as HTMLElement | null;
    const on = stage.current?.getBoundingClientRect();
    if (!room || !on || !held) return;
    const r = room.getBoundingClientRect();
    const k = on.width / PLAN_VIEW_W;
    const top = on.top - r.top + held.y * k;
    // Past the rotate handle above the item, 56 view units from its box.
    const above = top - bar.offsetHeight - 56 * k - 8;
    const below = top + held.h * k + 16;
    const y = above >= 8 ? above : Math.min(below, r.height - bar.offsetHeight - 64);
    const x = on.left - r.left + (held.x + held.w / 2) * k - bar.offsetWidth / 2;
    const right = r.width - bar.offsetWidth - 8 - (library ? 276 : 0);
    bar.style.left = `${Math.max(8, Math.min(x, right))}px`;
    bar.style.top = `${y}px`;
  });

  /** One change, one undo step. */
  const change = (write: () => void) => {
    store.undo.stopCapturing();
    write();
    store.undo.stopCapturing();
  };
  const snapped = (p: Point) => (snap ? snapPlanPoint(p, step) : p);
  const pointAt = (e: { clientX: number; clientY: number }): Point => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const inside = (p: Point) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

  const placeIcon = (kind: PlanIconKind, p: Point, keepPlacing = false) => {
    if ((plan.icons?.length ?? 0) >= MAX_PLAN_ICONS) return;
    const q = snapped(p);
    let id: string | null = null;
    change(() => {
      const layer = activeLayer ?? categoryOf(kind).layer;
      id = addPlanIcon(
        doc,
        targetFor(layer),
        {
          kind,
          color: penColor ?? iconColor(kind),
          x: toGrid(q.x),
          y: toGrid(q.y),
          ...(layer !== categoryOf(kind).layer ? { layer } : {}),
        },
        LOCAL,
      );
    });
    rememberRecent(kind);
    if (keepPlacing || !id) return;
    // Back to Select, the new icon picked; Shift keeps placing.
    setArmed(null);
    setTool('select');
    if (phone) setLibrary(false);
    setSelection([{ kind: 'icons', id }]);
  };

  /** A library tile: icons wait for a tap on the plan; annotations pick their tool. */
  const arm = (next: LibraryItem) => {
    setArmed(next);
    setSelected(null);
    if (isIconKind(next)) setTool('icons');
    else {
      rememberRecent(next);
      setTool(TOOL_OF_NOTE[next]);
    }
  };
  const dropAt = (next: LibraryItem, at: { clientX: number; clientY: number }) => {
    const p = pointAt(at);
    if (isIconKind(next) && inside(p)) placeIcon(next, p);
  };

  const remove = () => {
    if (selection.length === 0) return;
    const ids = selection.map((r) => r.id);
    change(() => {
      removePlanItems(doc, plan.id, ids, LOCAL);
      if (base) removePlanItems(doc, base.id, ids, LOCAL);
    });
    setSelection([]);
  };
  const duplicate = () => {
    if (selection.length === 0) return;
    let copies: PlanItemRef[] = [];
    change(() => {
      const d = { x: step, y: step };
      copies = [
        ...duplicatePlanItems(
          doc,
          plan,
          selection.filter((r) => ownerOf(r.id) === plan.id),
          d,
          LOCAL,
        ),
        ...(base
          ? duplicatePlanItems(
              doc,
              base,
              selection.filter((r) => ownerOf(r.id) === base.id),
              d,
              LOCAL,
            )
          : []),
      ];
    });
    setSelection(copies);
  };
  /**
   * Writes items where they live: the base's Set layer, or the plan (no undo step). Only what
   * differs from `baseline` is written: for a gesture, the items as they were when it started,
   * so another person's edit of another field made meanwhile stays. Without one, this render.
   */
  const writeItems = (items: readonly PlanItem[], baseline?: readonly PlanItem[]) => {
    const all = planItems(drawn);
    const before =
      baseline ?? items.flatMap((i) => all.find((e) => e.item.id === i.id)?.item ?? []);
    const own = items.filter((i) => ownerOf(i.id) === plan.id);
    const shared = items.filter((i) => ownerOf(i.id) !== plan.id);
    if (own.length) updatePlanItems(doc, plan.id, own, LOCAL, before);
    if (shared.length && base) updatePlanItems(doc, base.id, shared, LOCAL, before);
  };
  const write = (next: PlanItem | readonly PlanItem[], baseline?: readonly PlanItem[]) =>
    change(() => writeItems(Array.isArray(next) ? next : [next as PlanItem], baseline));
  const rotate = (degrees: number) => {
    if (many.length > 1) {
      const b = itemsBox(many);
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      write(many.map((i) => rotateItem(i, degrees, c)));
    } else if (item) write(rotateItem(item, degrees));
  };
  const nudge = (d: Point) => {
    const items = many.length > 1 ? many : item ? [item] : [];
    if (items.length) write(items.map((i) => moveItem(i, d)));
  };
  /** The colours paint what is selected; with nothing selected, the next strokes and icons. */
  const pickColor = (hex: string) => {
    if (many.length > 1) write(many.map((i) => ({ ...i, color: hex })));
    else if (item) write({ ...item, color: hex });
    else setPenColor(hex);
  };
  const openPop = (kind: PopKind) => (e: MouseEvent<HTMLElement>) => {
    popAnchor.current = e.currentTarget;
    const anchor = e.currentTarget.getBoundingClientRect();
    setPop((open) => (open?.kind === kind ? null : { kind, anchor }));
  };
  const closePop = useCallback(() => setPop(null), []);
  /** An item of a menu that opens a panel in its place, by the same button. */
  const nextPop = (kind: PopKind) => {
    const anchor = popAnchor.current?.getBoundingClientRect();
    if (anchor) setPop({ kind, anchor });
  };
  const pickTool = (next: Tool) => {
    setArmed(null);
    setTool(next);
    if (next === 'rect' || next === 'ellipse') setShapeTool(next);
  };
  /** The route of an icon: from where it stands, each click a new numbered position. */
  const startRoute = (icon: PlanIcon) => {
    setArmed(null);
    setTool('move');
    setMoving(icon.id);
    setSelection([{ kind: 'icons', id: icon.id }]);
  };
  const endRoute = () => {
    setMoving(null);
    setTool('select');
  };
  const disarm = () => {
    setArmed(null);
    setTool('select');
  };
  /** Ends writing a text: a text left with no words goes. */
  const finishText = () => {
    if (item && 'x0' in item && !item.text?.trim()) remove();
    setEditingText(null);
  };
  const relabel = (label: string) => {
    if (!isIcon(item)) return;
    const next = { ...item, label: label.slice(0, 60) };
    if (!label) delete (next as Partial<PlanIcon>).label;
    writeItems([next]);
  };

  const commitText = () => {
    const draft = textRef.current;
    textRef.current = null;
    setText(null);
    if (draft) {
      setTool('select');
      setArmed(null);
    }
    const value = draft?.value.trim().slice(0, 500);
    if (!draft || !value) return;
    const x = toGrid(draft.at.x);
    const y = toGrid(draft.at.y);
    // A text is a note unless a layer is active: it goes where that layer lives.
    change(() =>
      addShape(
        doc,
        targetFor(activeLayer ?? 'notes'),
        {
          ...onLayer,
          kind: 'text',
          color: draft.color,
          width: PLAN_TEXT,
          x0: x,
          y0: y,
          x1: x,
          y1: y,
          text: value,
        },
        LOCAL,
      ),
    );
  };

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    // An open menu or panel has the keyboard, and Escape closes it first; the point on the cone
    // keeps its arrows, as the length panel and the point are one control.
    if (pop && !target?.closest('[data-reach]')) {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.type === 'keydown') {
          closePop();
          popAnchor.current?.focus();
        }
      } else if (!target?.closest('.plan-pop, .menu')) e.stopImmediatePropagation();
      return;
    }
    // The scene picker has the keyboard while it is open; fields keep their keys.
    if (picking || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
    // Whatever the editor does not use never reaches the board behind it: Delete, arrows,
    // copy and paste or a tool letter would act on the plan card (as DrawingEditor.tsx).
    e.stopImmediatePropagation();
    if (e.type !== 'keydown') return;
    // The library's tabs keep their arrows, Home and End.
    if (moveTabFocus(e)) return;
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (scaleDraft) setScaleDraft(null);
      else if (measureDraft) setMeasureDraft(null);
      else if (moving) endRoute();
      else if (armed) disarm();
      else if (selection.length) setSelection([]);
      else if (tool !== 'select') setTool('select');
      else if (library) setLibrary(false);
      else onClose();
    } else if (
      e.key === 'Enter' &&
      item &&
      'x0' in item &&
      item.kind === 'text' &&
      target?.tagName !== 'BUTTON'
    )
      setEditingText(item.id);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) remove();
    else if (mod && key === 'a')
      // Everything on the active layer, as the round 6 mockup says.
      setSelection(
        itemsInRect(drawn, { x: -1, y: -1, w: 2000, h: 2000 }, viewOf).filter((r) => {
          const found = planItem(drawn, r);
          return !!found && layerOf(found) === activeLayer;
        }),
      );
    else if (mod && key === 'g' && selection.length > 1) write(toggleGroup(many));
    else if (e.key.startsWith('Arrow') && target?.closest('[data-reach]') && isIcon(item)) {
      // The point on the cone: longer with up and right, by a tenth of a metre or one square.
      const reach = iconCone(item, plan.sensor)?.reach ?? 0;
      const more = drawn.scale ? drawn.scale / 10 : step;
      const by = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? more : -more;
      write({
        ...item,
        reach: Math.round(Math.min(MAX_UNITS, Math.max(20, reach + by)) * 100) / 100,
      });
      e.preventDefault();
    } else if (e.key.startsWith('Arrow') && selection.length) {
      const k = e.shiftKey ? step * 4 : step;
      nudge({
        x: e.key === 'ArrowLeft' ? -k : e.key === 'ArrowRight' ? k : 0,
        y: e.key === 'ArrowUp' ? -k : e.key === 'ArrowDown' ? k : 0,
      });
    } else if (mod && key === 'z') e.shiftKey ? store.undo.redo() : store.undo.undo();
    else if (mod && key === 'y') store.undo.redo();
    else if (mod && key === 'd' && selection.length) duplicate();
    else if (!mod && key === 'r' && selection.length)
      rotate(e.shiftKey ? -QUARTER_TURN : QUARTER_TURN);
    else if (!mod && key === '/' && !phone) {
      setLibrary(true);
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('.plan-lib__search input')?.focus(),
      );
    } else if (!mod && key === 'g') setSnap((v) => !v);
    else if (!mod && key === 'm' && isIcon(item)) startRoute(item);
    else if (!mod && TOOLS.some((x) => x.key.toLowerCase() === key))
      pickTool(TOOLS.find((x) => x.key.toLowerCase() === key)?.tool ?? 'select');
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on, true);
    window.addEventListener('keyup', on, true);
    return () => {
      window.removeEventListener('keydown', on, true);
      window.removeEventListener('keyup', on, true);
    };
  }, []);
  // A modal: the app behind is inert, the editor takes the focus and gives it back on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const app = document.getElementById('root');
    const wasInert = app?.inert ?? false;
    if (app) app.inert = true;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (app) app.inert = wasInert;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.plan-editor__text')) return;
    e.stopPropagation();
    const p = pointAt(e);
    if (text) {
      // A click away from the text being typed finishes it.
      commitText();
      return;
    }
    // A double click writes: the words of a text in its bar, the number of a measure. Looked at
    // first: on a phone the handles of a small text cover it and would take the second tap.
    if (tool === 'select' && !armed) {
      const pressed = planItemAt(drawn, p, viewOf);
      const previous = lastPress.current;
      lastPress.current = pressed ? { id: pressed.id, at: e.timeStamp } : null;
      if (pressed && previous?.id === pressed.id && e.timeStamp - previous.at < DOUBLE_PRESS) {
        const target = planItem(drawn, pressed);
        if (target && 'x0' in target && target.kind === 'text') {
          setSelected(pressed);
          setEditingText(target.id);
          return;
        }
        if (target && 'x0' in target && target.kind === 'measure') {
          setSelected(pressed);
          openMeasure(target);
          return;
        }
      }
    }
    const grip = (e.target as Element).closest<SVGElement>('[data-handle]');
    if (grip && item) {
      e.currentTarget.setPointerCapture(e.pointerId);
      store.undo.stopCapturing();
      gesture.current = { kind: 'resize', handle: grip.dataset.handle as ResizeHandle, item };
      return;
    }
    const end = (e.target as Element).closest<SVGElement>('[data-end]');
    if (end && item && 'x0' in item) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'end', which: end.dataset.end === '1' ? 1 : 0, item };
      return;
    }
    const reachGrip = (e.target as Element).closest<SVGElement>('[data-reach]');
    if (reachGrip && isIcon(item)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'reach', item };
      return;
    }
    const bend = (e.target as Element).closest<SVGElement>('[data-bend]');
    if (bend && isIcon(item)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'bend', index: Number(bend.dataset.bend), item };
      return;
    }
    if (tool === 'move') {
      if (movingIcon) write(addBlockingStep(movingIcon, snapped(p)));
      return;
    }
    setLockedItem(null);
    if (armed && isIconKind(armed)) {
      placeIcon(armed, p, e.shiftKey);
      return;
    }
    const handle = (e.target as Element).closest('[data-rotate]');
    if (handle && many.length > 1) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const b = itemsBox(many);
      const centre = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const q = view(p);
      gesture.current = {
        kind: 'rotateMany',
        centre,
        from: Math.atan2(q.y - centre.y, q.x - centre.x),
        items: many,
      };
      return;
    }
    if (handle && item && selected) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const box = itemBox(item);
      const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const q = view(p);
      gesture.current = {
        kind: 'rotate',
        ref: selected,
        centre,
        from: Math.atan2(q.y - centre.y, q.x - centre.x),
        item,
      };
      return;
    }
    if (tool === 'select' || tool === 'icons') {
      const hit = planItemAt(drawn, p, viewOf);
      if (hit && (e.shiftKey || (phone && tool === 'select' && selection.length > 0))) {
        // Shift (or, on a phone, a tap while something is picked) adds or takes away.
        const group = withGroups(drawn, [hit]);
        const has = selection.some((r) => r.id === hit.id);
        if (e.shiftKey || !has) {
          setSelection(
            has
              ? selection.filter((r) => !group.some((g) => g.id === r.id))
              : [...selection, ...group.filter((g) => !selection.some((r) => r.id === g.id))],
          );
          return;
        }
        // A finger on a picked item may drag the selection: only a tap takes it out, on release.
        tapOff.current = group;
      }
      const picked = hit
        ? selection.some((r) => r.id === hit.id)
          ? selection
          : withGroups(drawn, [hit])
        : [];
      if (hit && picked.length > 1) {
        setSelection(picked);
        e.currentTarget.setPointerCapture(e.pointerId);
        store.undo.stopCapturing();
        gesture.current = {
          kind: 'moveMany',
          start: p,
          items: picked.flatMap((r) => planItem(drawn, r) ?? []),
        };
        return;
      }
      if (hit) {
        const target = planItem(drawn, hit);
        setSelected(hit);
        if (!target) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        store.undo.stopCapturing();
        gesture.current = { kind: 'move', ref: hit, start: p, item: target };
        return;
      }
      // An item of a locked layer cannot be picked, but says why.
      const under = planItemAt(drawn, p, { hidden: hiddenLayers });
      const lockedOne = under && planItem(drawn, under);
      if (lockedOne) setLockedItem(lockedOne);
      // A drag on the empty plan picks what its box touches (round 6, f).
      if (!e.shiftKey) setSelection([]);
      e.currentTarget.setPointerCapture(e.pointerId);
      // A finger draws the box after a long press (round 6, f); a mouse at once.
      const touch = e.pointerType === 'touch';
      const started = {
        kind: 'marquee' as const,
        a: p,
        add: e.shiftKey,
        touch,
        at: e.timeStamp,
        live: !touch,
      };
      gesture.current = started;
      if (touch)
        longPress.current = setTimeout(() => {
          if (gesture.current !== started) return;
          started.live = true;
          setMarquee({ a: p, b: p });
        }, LONG_PRESS);
      else setMarquee({ a: p, b: p });
      return;
    }
    setSelected(null);
    if (tool === 'text') {
      if ((plan.shapes?.length ?? 0) >= MAX_SHAPES) return;
      e.preventDefault();
      const draft = { at: p, value: '', color: ink };
      textRef.current = draft;
      setText(draft);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pencil') {
      if ((plan.strokes?.length ?? 0) >= MAX_STROKES) return;
      gesture.current = { kind: 'draw', points: [p] };
      setLive([p]);
      return;
    }
    if ((plan.shapes?.length ?? 0) >= MAX_SHAPES) return;
    const a = snapped(p);
    gesture.current = { kind: 'shape', shape: tool, a, b: a, raw: [p, p] };
    setLiveShape({ kind: tool, a, b: a });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    const p = pointAt(e);
    if (g.kind === 'marquee') {
      if (!g.live) {
        const moved = Math.hypot(view(p).x - view(g.a).x, view(p).y - view(g.a).y) > 12;
        if (e.timeStamp - g.at >= LONG_PRESS) g.live = true;
        else if (moved) {
          gesture.current = null;
          clearTimeout(longPress.current);
        }
        if (!g.live) return;
      }
      setMarquee({ a: g.a, b: p });
      return;
    }
    if (tapOff.current && (g.kind === 'move' || g.kind === 'moveMany')) {
      const moved = Math.hypot(view(p).x - view(g.start).x, view(p).y - view(g.start).y);
      if (moved < TAP_SLOP) return;
      tapOff.current = null;
    }
    if (g.kind === 'moveMany') {
      let d = { x: view(p).x - view(g.start).x, y: view(p).y - view(g.start).y };
      if (snap) {
        const b = itemsBox(g.items);
        const to = snapPlanPoint(
          { x: (b.x + d.x) / PLAN_VIEW_W, y: (b.y + d.y) / PLAN_VIEW_H },
          step,
        );
        d = { x: view(to).x - b.x, y: view(to).y - b.y };
      }
      setPreview(g.items.map((i) => moveItem(i, d)));
      return;
    }
    if (g.kind === 'rotateMany') {
      const q = view(p);
      let degrees = ((Math.atan2(q.y - g.centre.y, q.x - g.centre.x) - g.from) * 180) / Math.PI;
      if (snap || e.shiftKey) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP;
      setPreview(g.items.map((i) => rotateItem(i, normalizeRotation(degrees), g.centre)));
      const shownDeg = normalizeRotation(degrees);
      setChip(`${shownDeg > 180 ? shownDeg - 360 : shownDeg}°`);
      return;
    }
    if (g.kind === 'move') {
      let d = { x: view(p).x - view(g.start).x, y: view(p).y - view(g.start).y };
      if (snap && isIcon(g.item)) {
        // An icon's centre lands on the grid.
        const c = { x: (g.item.x / 4096) * PLAN_VIEW_W, y: (g.item.y / 4096) * PLAN_VIEW_H };
        const to = snapPlanPoint(
          { x: (c.x + d.x) / PLAN_VIEW_W, y: (c.y + d.y) / PLAN_VIEW_H },
          step,
        );
        d = { x: view(to).x - c.x, y: view(to).y - c.y };
      }
      setPreview(moveItem(g.item, d));
    } else if (g.kind === 'resize') {
      const symbol = isIcon(g.item) && !isSized(g.item.kind);
      setPreview(
        resizeItem(g.item, g.handle, view(p), {
          keepRatio: e.shiftKey || symbol,
          fromCentre: e.altKey,
          textSizes: Object.values(TEXT_SIZES),
        }),
      );
    } else if (g.kind === 'end') {
      const q = snapped(p);
      const next: PlanShape =
        g.which === 0
          ? { ...g.item, x0: toGrid(q.x), y0: toGrid(q.y) }
          : { ...g.item, x1: toGrid(q.x), y1: toGrid(q.y) };
      // A measure's end let go anywhere no longer follows its icon.
      delete next[g.which === 0 ? 'from' : 'to'];
      setPreview(next);
    } else if (g.kind === 'reach') {
      setPreview(withReachAt(g.item, view(p), plan.sensor));
    } else if (g.kind === 'bend') {
      const at = blockingPositions(g.item);
      const a = at[g.index] as Point;
      const b = at[g.index + 1] as Point;
      const steps = [...(g.item.steps ?? [])];
      steps[g.index] = {
        ...(steps[g.index] as PlanStep),
        bend: Math.round(bendThrough(a, b, view(p))),
      };
      setPreview({ ...g.item, steps });
    } else if (g.kind === 'rotate') {
      const q = view(p);
      const angle = Math.atan2(q.y - g.centre.y, q.x - g.centre.x);
      let degrees = ((angle - g.from) * 180) / Math.PI;
      if (snap || e.shiftKey) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP;
      const turned = rotateItem(g.item, normalizeRotation(degrees));
      setPreview(turned);
      setChip(`${shownAngle(turned)}°`);
    } else if (g.kind === 'draw') {
      // Coalesced events keep fast lines smooth on pens and fast mice.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events.length > 0 ? events : [e.nativeEvent]) g.points.push(pointAt(ev));
      setLive(g.points);
    } else {
      g.b = snapped(p);
      g.raw[1] = p;
      setLiveShape({ kind: g.shape, a: g.a, b: g.b });
    }
  }

  /** A gesture the browser took away (a scroll, a second finger): nothing is written. */
  function onPointerCancel() {
    clearTimeout(longPress.current);
    tapOff.current = null;
    gesture.current = null;
    setPreview(null);
    setChip(null);
    setLive(null);
    setLiveShape(null);
    setMarquee(null);
  }

  function onPointerUp() {
    clearTimeout(longPress.current);
    const taken = tapOff.current;
    tapOff.current = null;
    if (taken) setSelection((now) => now.filter((r) => !taken.some((t) => t.id === r.id)));
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'marquee') {
      const m = marquee;
      setMarquee(null);
      if (!m) return;
      const a = view(m.a);
      const b = view(m.b);
      const rect = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      };
      if (rect.w + rect.h < 4) return;
      setLockedItem(null);
      const hits = withGroups(drawn, itemsInRect(drawn, rect, viewOf));
      setSelection(
        g.add ? [...selection, ...hits.filter((h) => !selection.some((r) => r.id === h.id))] : hits,
      );
      return;
    }
    if (g.kind !== 'draw' && g.kind !== 'shape') {
      setChip(null);
      const next = previewRef.current;
      setPreview(null);
      if (next) write(next, 'items' in g ? g.items : [g.item]);
      return;
    }
    if (g.kind === 'draw') {
      setLive(null);
      change(() =>
        addStroke(
          doc,
          targetFor(activeLayer ?? 'set'),
          {
            ...onLayer,
            tool: 'pencil',
            color: ink,
            width: PLAN_PEN,
            points: encodeStroke(g.points),
          },
          LOCAL,
        ),
      );
      return;
    }
    setLiveShape(null);
    if (g.shape === 'scale') {
      // "Imposta la scala": the line drawn on something of known length.
      const length = gridLength(toGrid(g.a.x), toGrid(g.a.y), toGrid(g.b.x), toGrid(g.b.y));
      setTool('select');
      if (length > 10) setScaleDraft({ length, metres: '' });
      return;
    }
    // A measure's ends that start or land on an icon stay on it (round 6, g).
    const endOn = (q: Point) => {
      if (g.shape !== 'measure') return null;
      const hit = planItemAt(drawn, q, viewOf);
      const target = hit && planItem(drawn, hit);
      return isIcon(target) ? target : null;
    };
    // Where the pointer was, not the grid point: the icon under it.
    const fromIcon = endOn(g.raw[0]);
    const toIcon = endOn(g.raw[1]);
    if (fromIcon) g.a = { x: fromIcon.x / 4096, y: fromIcon.y / 4096 };
    if (toIcon) g.b = { x: toIcon.x / 4096, y: toIcon.y / 4096 };
    const shape = {
      kind: g.shape,
      color: ink,
      width: PLAN_PEN,
      x0: toGrid(g.a.x),
      y0: toGrid(g.a.y),
      x1: toGrid(g.b.x),
      y1: toGrid(g.b.y),
      ...(g.shape === 'zone' || g.shape === 'measure' ? { layer: 'notes' as const } : {}),
      ...(fromIcon ? { from: fromIcon.id } : {}),
      ...(toIcon ? { to: toIcon.id } : {}),
    };
    // A click without a drag draws nothing.
    if (Math.abs(shape.x1 - shape.x0) + Math.abs(shape.y1 - shape.y0) < 8) return;
    let created: string | null = null;
    change(() => {
      created = addShape(
        doc,
        targetFor(shape.layer ?? activeLayer ?? 'set'),
        { ...(shape.layer ? {} : onLayer), ...shape } as unknown as FrameShape,
        LOCAL,
      );
    });
    if (armed) setArmed(null);
    if (armed && g.shape !== 'measure') setTool('select');
    if (created && g.shape === 'measure') {
      const length = gridLength(shape.x0, shape.y0, shape.x1, shape.y1);
      openMeasure({ id: created, x0: shape.x0, y0: shape.y0, x1: shape.x1, y1: shape.y1, length });
    }
  }

  /** The number of a measure, to write: what it says now, in the way of this language. */
  function openMeasure(m: {
    id: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    length?: number;
    text?: string | undefined;
  }) {
    const written = m.text ? Number(m.text) : 0;
    const length = m.length ?? gridLength(m.x0, m.y0, m.x1, m.y1);
    const metres = written > 0 ? written : drawn.scale ? length / drawn.scale : 0;
    setMeasureDraft({
      id: m.id,
      value: metres
        ? metres.toLocaleString(i18n.language, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : '',
      wrong: false,
      asking: null,
      at: { x: (m.x0 + m.x1) / 8192, y: Math.max(m.y0, m.y1) / 4096 },
    });
  }
  const writeMeasure = (id: string, text: string | undefined) => {
    const found = planItem(drawn, { kind: 'shapes', id });
    if (!found) return;
    const next = { ...found, text } as PlanShape;
    if (text === undefined) delete next.text;
    write(next);
  };
  const commitMeasure = () => {
    if (!measureDraft) return;
    const value = measureValue(measureDraft.value);
    if (!value) {
      setMeasureDraft({ ...measureDraft, wrong: true });
      return;
    }
    if (drawn.scale) {
      writeMeasure(measureDraft.id, value);
      setMeasureDraft(null);
    } else setMeasureDraft({ ...measureDraft, wrong: false, asking: value });
  };
  /** The line and its number make the scale of the plan: the measure then reads it from there. */
  const measureAsScale = () => {
    const found = measureDraft && planItem(drawn, { kind: 'shapes', id: measureDraft.id });
    if (!measureDraft?.asking || !found || !('x0' in found)) return;
    const next = scaleFor(
      gridLength(found.x0, found.y0, found.x1, found.y1),
      Number(measureDraft.asking),
    );
    if (next && next <= MAX_SCALE)
      change(() =>
        updateElement(
          doc,
          scaleOwner,
          { scale: Math.round(next * 100) / 100, grid: drawn.grid ?? '0.5', rulers: true },
          LOCAL,
        ),
      );
    setMeasureDraft(null);
  };

  const box = current ? itemBox(current) : null;
  const frame = current ? itemFrame(current) : null;
  const pad = 8;
  const symbol = isIcon(current) && !isSized(current.kind);
  const ends =
    current && 'x0' in current && !frame
      ? [
          { x: current.x0 * (PLAN_VIEW_W / 4096), y: current.y0 * (PLAN_VIEW_H / 4096) },
          { x: current.x1 * (PLAN_VIEW_W / 4096), y: current.y1 * (PLAN_VIEW_H / 4096) },
        ]
      : null;
  /** Handles are bigger under a finger: on a phone a view unit is a third of a pixel. */
  const grip = phone ? 28 : 12;
  const rotateGrip = (x: number, y: number) => (
    <g data-rotate="" className="plan-editor__rotate">
      <line x1={x} y1={y} x2={x} y2={y - 32} />
      <circle cx={x} cy={y - 40} r={phone ? 18 : 8} />
      {chip && (
        <g className="plan-editor__chip">
          <rect x={x - 30} y={y - 92} width={60} height={28} rx={6} />
          <text x={x} y={y - 72} textAnchor="middle">
            {chip}
          </text>
        </g>
      )}
    </g>
  );
  const outline =
    box &&
    (frame ? (
      <g
        className="plan-editor__selection"
        transform={`translate(${frame.centre.x} ${frame.centre.y}) rotate(${frame.angle})`}
      >
        <rect
          x={-frame.w / 2 - pad}
          y={-frame.h / 2 - pad}
          width={frame.w + pad * 2}
          height={frame.h + pad * 2}
          rx={4}
        />
        {HANDLES.filter((h) => !symbol || h.length === 2).map((h) => {
          const [sx, sy] = HANDLE_SIGN[h];
          return (
            <rect
              key={h}
              data-handle={h}
              className={`plan-editor__handle plan-editor__handle--${h}`}
              x={sx * (frame.w / 2 + pad) - grip / 2}
              y={sy * (frame.h / 2 + pad) - grip / 2}
              width={grip}
              height={grip}
              rx={symbol ? grip / 2 : 2}
            />
          );
        })}
        {rotateGrip(0, -frame.h / 2 - pad)}
      </g>
    ) : (
      <g className="plan-editor__selection">
        <rect
          x={box.x - pad}
          y={box.y - pad}
          width={box.w + pad * 2}
          height={box.h + pad * 2}
          rx={4}
        />
        {ends?.map((p, i) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: the two ends of a line.
            key={i}
            data-end={i}
            className="plan-editor__bend"
            cx={p.x}
            cy={p.y}
            r={8}
          />
        ))}
        {rotateGrip(box.x + box.w / 2, box.y - pad)}
      </g>
    ));
  const groupBox = many.length > 1 ? itemsBox(many) : null;
  const manyBox = groupBox && (
    <g className="plan-editor__selection">
      {many.map((i) => {
        const b = itemBox(i);
        return (
          <rect
            key={i.id}
            className="plan-editor__member"
            x={b.x - 3}
            y={b.y - 3}
            width={b.w + 6}
            height={b.h + 6}
            rx={3}
          />
        );
      })}
      <rect
        x={groupBox.x - pad}
        y={groupBox.y - pad}
        width={groupBox.w + pad * 2}
        height={groupBox.h + pad * 2}
        rx={4}
      />
      {rotateGrip(groupBox.x + groupBox.w / 2, groupBox.y - pad)}
    </g>
  );
  const reachEnd = isIcon(current) && !moving ? coneEnd(current, plan.sensor) : null;
  const reachGrip = reachEnd && (
    <circle
      data-reach=""
      className="plan-editor__reach"
      cx={reachEnd.x}
      cy={reachEnd.y}
      r={phone ? 20 : 8}
      role="slider"
      tabIndex={0}
      aria-label={t('board.plan.reach')}
      aria-valuemin={20}
      aria-valuemax={MAX_UNITS}
      aria-valuenow={Math.round(iconCone(current as PlanIcon, plan.sensor)?.reach ?? 0)}
    />
  );
  const blockingGrips = isIcon(current) && !moving && (
    <g className="plan-editor__selection">
      {blockingPositions(current)
        .slice(1)
        .map((b, i) => {
          const a = blockingPositions(current)[i] as Point;
          const { middle } = blockingCurve(a, b, current.steps?.[i]?.bend);
          return (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: a move is its place in the order.
              key={i}
              data-bend={i}
              className="plan-editor__bend"
              cx={middle.x}
              cy={middle.y}
              r={9}
            />
          );
        })}
    </g>
  );
  const liveLayer = (
    <>
      {live && (
        <path
          d={pathOf(live.points, PLAN_VIEW_H)}
          fill="none"
          stroke="currentColor"
          strokeWidth={PLAN_PEN}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: planCss(ink) }}
        />
      )}
      {liveShape && (
        <PlanShapeView
          shape={
            {
              id: 'liveAAAA',
              kind: liveShape.kind === 'scale' ? 'measure' : liveShape.kind,
              ...(liveShape.kind === 'scale' ? { dashed: true } : {}),
              color: ink,
              width: PLAN_PEN,
              x0: toGrid(liveShape.a.x),
              y0: toGrid(liveShape.a.y),
              x1: toGrid(liveShape.b.x),
              y1: toGrid(liveShape.b.y),
            } as PlanShape
          }
        />
      )}
      {many.length > 1 ? manyBox : !moving && outline}
      {blockingGrips}
      {reachGrip}
      {marquee && (
        <rect
          className="plan-editor__marquee"
          x={Math.min(marquee.a.x, marquee.b.x) * PLAN_VIEW_W}
          y={Math.min(marquee.a.y, marquee.b.y) * PLAN_VIEW_H}
          width={Math.abs(marquee.b.x - marquee.a.x) * PLAN_VIEW_W}
          height={Math.abs(marquee.b.y - marquee.a.y) * PLAN_VIEW_H}
        />
      )}
    </>
  );

  const title = planTitle(t, plan);
  const colorName = (hex: string) =>
    t(
      `board.plan.colors.${PLAN_COLORS.find((c) => c.hex === hex)?.name ?? 'ink'}`,
    ).toLocaleLowerCase(i18n.language);

  const toolButton = (
    key: string,
    label: string,
    icon: ReactNode,
    on: boolean,
    act: (e: MouseEvent<HTMLElement>) => void,
    disabled = false,
  ) => (
    <button
      key={key}
      type="button"
      className="plan-editor__btn"
      aria-pressed={on}
      aria-label={label}
      data-ink-tooltip={label}
      disabled={disabled}
      onClick={act}
    >
      {icon}
    </button>
  );
  /** The colour of what is selected, or of the next strokes: the button that opens the palette. */
  const colorButton = (hex: string, tip?: string) => (
    <button
      type="button"
      className="plan-editor__swatch"
      aria-label={t('board.plan.colorOf', { name: colorName(hex) })}
      data-ink-tooltip={tip ?? t('board.plan.colorOf', { name: colorName(hex) })}
      aria-haspopup="dialog"
      onClick={openPop('color')}
    >
      <i style={{ background: planCss(hex) }} />
    </button>
  );
  const shownColor = many.length > 1 ? (many[0] as PlanItem).color : current ? current.color : ink;
  const shapeOn = (['line', 'arrow', 'rect', 'ellipse'] as Tool[]).includes(tool) && !armed;
  const tools = (
    <div
      className="plan-editor__tools ink-motion-pop"
      data-tour="plan-tools"
      role="toolbar"
      aria-label={t('board.plan.tools')}
    >
      {TOOLS.filter((x) => {
        if (x.tool === 'ellipse') return false;
        return !phone || !['line', 'arrow', 'rect'].includes(x.tool);
      }).flatMap((x) => {
        const button =
          x.tool === 'rect'
            ? // One button for both: pressed again it turns into the other shape (O and Q too).
              toolButton(
                'rect',
                `${t('board.plan.tool.shape')} (Q)`,
                <Icon name={shapeTool} size={16} />,
                (tool === 'rect' || tool === 'ellipse') && !armed,
                () =>
                  pickTool(
                    tool === shapeTool ? (shapeTool === 'rect' ? 'ellipse' : 'rect') : shapeTool,
                  ),
              )
            : toolButton(
                x.tool,
                phone
                  ? t(`board.plan.tool.${x.tool}`)
                  : `${t(`board.plan.tool.${x.tool}`)} (${x.key})`,
                <Icon name={x.icon} size={16} />,
                tool === x.tool && !armed,
                () => pickTool(x.tool),
              );
        // On a phone lines and shapes share one button, after the pencil.
        return phone && x.tool === 'pencil'
          ? [
              button,
              toolButton(
                'shapes',
                t('board.plan.tool.shapes'),
                <Icon
                  name={
                    tool === 'line' || tool === 'arrow' || tool === 'ellipse'
                      ? tool
                      : ('rect' as IconName)
                  }
                  size={16}
                />,
                shapeOn,
                openPop('shapes'),
              ),
            ]
          : [button];
      })}
      {!phone && <span className="plan-editor__sep" aria-hidden="true" />}
      {colorButton(shownColor, selection.length ? undefined : t('board.plan.nextColor'))}
      {!phone && <span className="plan-editor__sep" aria-hidden="true" />}
      <button
        type="button"
        className="plan-editor__btn plan-editor__btn--wide"
        data-tour="plan-icons"
        aria-pressed={library}
        aria-label={t('board.plan.panel.icons')}
        onClick={() => setLibrary((v) => !v)}
      >
        <Icon name="iconLibrary" size={16} />
        {!phone && <span>{t('board.plan.panel.icons')}</span>}
      </button>
      {!phone && <span className="plan-editor__sep" aria-hidden="true" />}
      {toolButton(
        'undo',
        t('board.plan.undo'),
        <Icon name="undo" size={16} />,
        false,
        () => store.undo.undo(),
        !store.undo.canUndo(),
      )}
      {!phone &&
        toolButton(
          'redo',
          t('board.plan.redo'),
          <span className="plan-editor__mirror">
            <Icon name="undo" size={16} />
          </span>,
          false,
          () => store.undo.redo(),
          !store.undo.canRedo(),
        )}
    </div>
  );

  const palette = (
    <div className="plan-pop__swatches">
      {PLAN_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          className="plan-editor__swatch"
          aria-pressed={shownColor === c.hex}
          aria-label={t(`board.plan.colors.${c.name}`)}
          data-ink-tooltip={t(`board.plan.colors.${c.name}`)}
          onClick={() => {
            pickColor(c.hex);
            closePop();
          }}
        >
          <i style={{ background: `var(--ink-${c.token})` }} />
        </button>
      ))}
    </div>
  );
  const isTextItem = !!current && 'x0' in current && current.kind === 'text';
  const labelField = current && (isIcon(current) || isTextItem) && (
    <input
      className="plan-editor__field"
      aria-label={t(isIcon(current) ? 'board.plan.labelField' : 'film.pen.textField')}
      placeholder={isIcon(current) ? t('board.plan.labelPlaceholder') : undefined}
      maxLength={isIcon(current) ? 60 : 500}
      // biome-ignore lint/a11y/noAutofocus: a double click on a text is asking to write it.
      autoFocus={!isIcon(current) || pop?.kind === 'label'}
      value={(isIcon(current) ? current.label : 'text' in current ? current.text : '') ?? ''}
      onFocus={() => store.undo.stopCapturing()}
      onBlur={() => store.undo.stopCapturing()}
      onChange={(e) =>
        isIcon(current)
          ? relabel(e.target.value)
          : writeItems([{ ...current, text: e.target.value } as PlanItem])
      }
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (isIcon(current)) e.currentTarget.blur();
          else finishText();
          if (pop?.kind === 'label') closePop();
        }
      }}
    />
  );
  /** A smaller or bigger step of the three sizes of a text. */
  const textStep = (dir: -1 | 1) => {
    if (!current || !('x0' in current)) return null;
    const sizes = Object.values(TEXT_SIZES) as number[];
    const next =
      dir > 0 ? sizes.find((v) => v > current.width) : sizes.findLast((v) => v < current.width);
    return next ?? null;
  };
  const textSizer = (dir: -1 | 1) => {
    const next = textStep(dir);
    return (
      <IconButton
        icon={dir > 0 ? 'plus' : 'minus'}
        label={t(dir > 0 ? 'board.plan.bigger' : 'board.plan.smaller')}
        disabled={next === null}
        onClick={() => next !== null && current && write({ ...current, width: next } as PlanItem)}
      />
    );
  };
  const angleField = current && frame && (
    <>
      {!phone && <span className="plan-editor__vr" aria-hidden="true" />}
      {!phone && <span className="plan-editor__cap">{t('board.plan.angleField')}</span>}
      <NumberField
        value={shownAngle(current)}
        min={-360}
        max={360}
        unit="°"
        label={t('board.plan.angleField')}
        onCommit={(deg) => rotate(normalizeRotation(deg - shownAngle(current)))}
      />
    </>
  );
  /** Width and depth of furniture in metres; the size of a symbol in percent (round 6, e). */
  const sizeFields = current && isIcon(current) && (
    <>
      {isSized(current.kind) && drawn.scale && frame && (
        <>
          {!phone && <span className="plan-editor__vr" aria-hidden="true" />}
          <NumberField
            value={Math.round((frame.w / drawn.scale) * 100) / 100}
            min={0.01}
            max={MAX_UNITS / drawn.scale}
            step={0.01}
            label={t('board.plan.width')}
            onCommit={(m) => write({ ...current, w: m * (drawn.scale as number), h: frame.h })}
          />
          <span className="plan-editor__times">×</span>
          <NumberField
            value={Math.round((frame.h / drawn.scale) * 100) / 100}
            min={0.01}
            max={MAX_UNITS / drawn.scale}
            step={0.01}
            unit="m"
            label={t('board.plan.depth')}
            onCommit={(m) => write({ ...current, w: frame.w, h: m * (drawn.scale as number) })}
          />
        </>
      )}
      {!isSized(current.kind) && (
        <>
          {!phone && <span className="plan-editor__vr" aria-hidden="true" />}
          {!phone && <span className="plan-editor__cap">{t('board.plan.dimShort')}</span>}
          <NumberField
            value={symbolPercent(current)}
            min={SYMBOL_PERCENT.min}
            max={SYMBOL_PERCENT.max}
            unit="%"
            label={t('board.plan.dimension')}
            onCommit={(v) => write(withPercent(current, v))}
          />
        </>
      )}
    </>
  );
  const align = (how: PlanAlign) => write(alignItems(many, how));
  const manyBar = many.length > 1 && (
    <div
      ref={itemBar}
      className="plan-editor__bar ink-motion-pop"
      role="toolbar"
      aria-label={t('board.plan.selection')}
    >
      <span className="plan-editor__count">{t('board.plan.items', { count: many.length })}</span>
      <span className="plan-editor__vr" aria-hidden="true" />
      <IconButton
        icon="alignLeft"
        label={t('board.plan.align.left')}
        onClick={() => align('left')}
      />
      <IconButton
        icon="alignCenter"
        label={t('board.plan.align.centre')}
        onClick={() => align('centre')}
      />
      <IconButton icon="alignTop" label={t('board.plan.align.top')} onClick={() => align('top')} />
      <IconButton
        icon="distribute"
        label={t('board.plan.align.distribute')}
        onClick={() => align('distribute')}
      />
      <span className="plan-editor__vr" aria-hidden="true" />
      <IconButton
        icon="groupItems"
        label={`${t(many.every((i) => i.group && i.group === many[0]?.group) ? 'board.plan.ungroup' : 'board.plan.group')} (${isMac() ? '⌘' : 'Ctrl+'}G)`}
        onClick={() => write(toggleGroup(many))}
      />
      <span className="plan-editor__vr" aria-hidden="true" />
      {colorButton((many[0] as PlanItem).color)}
      <IconButton icon="copy" label={t('board.plan.duplicate')} onClick={duplicate} />
      <IconButton icon="trash" label={t('board.plan.delete')} onClick={remove} />
    </div>
  );
  const moreButton = (
    <IconButton
      icon="more"
      label={t('board.plan.more')}
      aria-haspopup="menu"
      onClick={openPop('itemMore')}
    />
  );
  /** The bar turned into the field of a text, as on notes. */
  const textBar = current && isTextItem && editingText === current.id && (
    <div
      ref={itemBar}
      className="plan-editor__bar ink-motion-pop"
      role="toolbar"
      aria-label={t('board.plan.selection')}
    >
      {colorButton(current.color)}
      {labelField}
      {textSizer(-1)}
      {textSizer(1)}
      <span className="plan-editor__vr" aria-hidden="true" />
      <button type="button" className="plan-editor__done" onClick={finishText}>
        {t('film.pen.done')}
      </button>
    </div>
  );
  const isMeasure = !!current && 'x0' in current && current.kind === 'measure';
  const itemOnBar = current && !(phone && armed) && (
    <div
      ref={itemBar}
      className="plan-editor__bar ink-motion-pop"
      role="toolbar"
      aria-label={t(
        isIcon(current) && current.kind === 'camera'
          ? 'board.plan.cameraBar'
          : 'board.plan.selection',
      )}
    >
      {colorButton(current.color)}
      {isIcon(current) &&
        (phone ? (
          <IconButton
            icon="text"
            label={t('board.plan.labelField')}
            aria-haspopup="dialog"
            onClick={openPop('label')}
          />
        ) : (
          labelField
        ))}
      {isTextItem && (
        <>
          <button
            type="button"
            className="plan-editor__lens"
            onClick={() => setEditingText(current.id)}
          >
            {t('board.plan.edit')}
          </button>
          {textSizer(-1)}
          {textSizer(1)}
        </>
      )}
      {isMeasure && 'x0' in current && (
        <button type="button" className="plan-editor__lens" onClick={() => openMeasure(current)}>
          {measureText(current, drawn.scale, i18n.language) || t('board.plan.writeMeasure')}
        </button>
      )}
      {sizeFields}
      {angleField}
      {isIcon(current) && (
        <>
          {!phone && <span className="plan-editor__vr" aria-hidden="true" />}
          {current.kind === 'camera' && (
            <PopButton
              phone={phone}
              icon="planCamera"
              label={t('board.plan.lens')}
              onClick={openPop('lens')}
            />
          )}
          {iconCone(current)?.beam && (
            <PopButton
              phone={phone}
              icon="brush"
              label={t('board.plan.light')}
              onClick={openPop('light')}
            />
          )}
          <PopButton
            phone={phone}
            icon="blocking"
            label={t('board.plan.route')}
            noCaret
            onClick={() => startRoute(current)}
          />
        </>
      )}
      {!phone && <span className="plan-editor__vr" aria-hidden="true" />}
      {moreButton}
    </div>
  );
  const lockedBar = !current && many.length === 0 && lockedItem && (
    <div
      ref={itemBar}
      className="plan-editor__bar ink-motion-pop"
      role="toolbar"
      aria-label={t('board.plan.selection')}
    >
      <span className="plan-editor__count plan-editor__locked">
        <Icon name="lock" size={13} />
        {t(`board.plan.lockedAs.${layerOf(lockedItem)}`)}
      </span>
      <span className="plan-editor__vr" aria-hidden="true" />
      <IconButton icon="copy" label={t('board.plan.duplicate')} disabled />
      <IconButton icon="trash" label={t('board.plan.delete')} disabled />
    </div>
  );
  const bar = manyBar || textBar || itemOnBar || lockedBar;

  const libraryPanel = (
    <PlanLibrary
      armed={armed}
      phone={phone}
      onArm={arm}
      onDrop={dropAt}
      onPlaceFirst={(next) => {
        arm(next);
        if (isIconKind(next)) placeIcon(next, { x: 0.5, y: 0.5 });
      }}
      onClose={() => setLibrary(false)}
    />
  );

  const icon = isIcon(current) ? current : null;
  const cone = icon ? iconCone(icon, plan.sensor) : null;
  const lensIs = icon?.lens ?? DEFAULT_LENS;
  /** The length of the cone, as the point at its end sets it: metres, or squares of the grid. */
  const reachUnit = drawn.scale ?? step;
  const reachField = icon && cone && (
    <div className="plan-props__row">
      <span>{t('board.plan.reach')}</span>
      <NumberField
        value={Math.round((cone.reach / reachUnit) * 100) / 100}
        min={20 / reachUnit}
        max={MAX_UNITS / reachUnit}
        step={0.01}
        nudge={drawn.scale ? 0.1 : 1}
        unit={drawn.scale ? 'm' : t('board.plan.squares')}
        label={t('board.plan.reach')}
        onCommit={(v) => write({ ...icon, reach: Math.round(v * reachUnit * 100) / 100 })}
      />
    </div>
  );
  const lensPanel = icon?.kind === 'camera' && cone && (
    <>
      <div className="plan-pop__row">
        <div className="plan-pop__field">
          <span>{t('board.plan.focal')}</span>
          <Select
            aria-label={t('board.plan.focal')}
            value={otherLens || !LENSES.includes(lensIs) ? 'other' : String(lensIs)}
            onChange={(v) => {
              if (v === 'other') setOtherLens(true);
              else {
                setOtherLens(false);
                write({ ...icon, lens: Number(v) });
              }
            }}
            options={[
              ...LENSES.map((mm) => ({ value: String(mm), label: `${mm} mm` })),
              { value: 'other', label: t('board.plan.otherLens') },
            ]}
          />
        </div>
        <div className="plan-pop__field">
          <span>{t('board.plan.sensor')}</span>
          <Select
            aria-label={t('board.plan.sensor')}
            value={plan.sensor ?? 's35'}
            onChange={(v) =>
              change(() =>
                updateElement(
                  doc,
                  plan.id,
                  { sensor: v === 's35' ? undefined : (v as PlanSensor) },
                  LOCAL,
                ),
              )
            }
            options={(['s35', 'ff', 'm43', 's16'] as const).map((v) => ({
              value: v,
              label: t(`board.plan.sensors.${v}`),
            }))}
          />
        </div>
      </div>
      {(otherLens || !LENSES.includes(lensIs)) && (
        <div className="plan-props__row">
          <span>{t('board.plan.focal')}</span>
          <NumberField
            value={lensIs}
            min={4}
            max={2000}
            unit="mm"
            label={t('board.plan.focalOther')}
            onCommit={(mm) => write({ ...icon, lens: Math.round(mm) })}
          />
        </div>
      )}
      {lenses.length > 0 && (
        <div className="plan-props__hints">
          <span>{t('board.plan.fromFrames')}</span>
          {lenses.map((l) => (
            <button
              key={l.label}
              type="button"
              className="plan__badge"
              onClick={() => write({ ...icon, lens: l.mm })}
            >
              {l.label} · {l.mm} mm
            </button>
          ))}
        </div>
      )}
      <p className="plan-pop__text">
        {t('board.plan.angle')}: {t('board.plan.angleValue', { angle: Math.round(cone.angle) })}
      </p>
      {reachField}
      <label className="plan-props__row">
        <span>{t('board.plan.showLens')}</span>
        <Checkbox
          checked={!!icon.showLens}
          onChange={(e) => {
            const next = { ...icon, showLens: e.target.checked };
            if (!e.target.checked) delete (next as Partial<PlanIcon>).showLens;
            write(next);
          }}
        />
      </label>
    </>
  );
  const range = (
    label: string,
    value: number,
    min: number,
    max: number,
    unit: string,
    set: (v: number) => PlanIcon,
  ) => (
    <div className="plan-props__row">
      <span>{label}</span>
      <Slider
        className="plan-props__range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onPointerDown={() => store.undo.stopCapturing()}
        onPointerUp={() => store.undo.stopCapturing()}
        onChange={(v) => writeItems([set(v)])}
      />
      <NumberField
        value={value}
        min={min}
        max={max}
        unit={unit}
        label={label}
        onCommit={(v) => {
          store.undo.stopCapturing();
          writeItems([set(v)]);
        }}
      />
    </div>
  );
  const lightPanel = icon && cone?.beam && (
    <>
      <div className="plan-props__row">
        <span>{t('board.plan.power')}</span>
        <input
          className="plan-editor__field"
          aria-label={t('board.plan.power')}
          placeholder="1,2K"
          maxLength={20}
          value={icon.power ?? ''}
          onFocus={() => store.undo.stopCapturing()}
          onChange={(e) => {
            const next = { ...icon, power: e.target.value };
            if (!e.target.value) delete (next as Partial<PlanIcon>).power;
            writeItems([next]);
          }}
        />
      </div>
      {range(t('board.plan.beam'), icon.beam ?? 30, 5, 180, '°', (v) => ({ ...icon, beam: v }))}
      {range(
        t('board.plan.intensity'),
        Math.round((icon.intensity ?? 0.8) * 100),
        0,
        100,
        '%',
        (v) => ({ ...icon, intensity: v / 100 }),
      )}
      {reachField}
    </>
  );

  /** The notes of the positions of a route, kept from the earlier panel. */
  const stepsPanel = icon && (icon.steps?.length ?? 0) > 0 && (
    <>
      <div className="plan-props__label">
        {t('board.plan.positions', { count: (icon.steps?.length ?? 0) + 1 })}
      </div>
      <ol className="plan-props__steps">
        {[...(icon.steps ?? []), null].map((stepAt, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a position is its place in the order.
          <li key={i}>
            <span className="plan-props__num">{i + 1}</span>
            <input
              className="plan-editor__field"
              aria-label={t('board.plan.stepNote', { number: i + 1 })}
              placeholder={t('board.plan.stepPlaceholder')}
              maxLength={200}
              value={(stepAt ? stepAt.note : icon.note) ?? ''}
              onFocus={() => store.undo.stopCapturing()}
              onChange={(e) => {
                const note = e.target.value;
                const next: PlanIcon = { ...icon, steps: [...(icon.steps ?? [])] };
                if (stepAt) {
                  const edited: PlanStep = { ...stepAt, note };
                  if (!note) delete edited.note;
                  (next.steps as PlanStep[])[i] = edited;
                } else if (note) next.note = note;
                else delete next.note;
                writeItems([next]);
              }}
            />
          </li>
        ))}
      </ol>
    </>
  );
  const routeName = movingIcon && (movingIcon.label || t(`board.plan.icons.${movingIcon.kind}`));
  /** The bar of a route, over the plan. */
  const moveBar = movingIcon && (
    <div
      className="plan-editor__movebar ink-motion-pop"
      role="toolbar"
      aria-label={t('board.plan.routeBar')}
    >
      <span>{t('board.plan.routeOf', { name: routeName })}</span>
      <span className="plan-editor__vr" aria-hidden="true" />
      <IconButton
        icon="line"
        label={t('board.plan.solid')}
        aria-pressed={!movingIcon.dashed}
        onClick={() => {
          const next = { ...movingIcon };
          delete next.dashed;
          write(next);
        }}
      />
      <IconButton
        icon="dashed"
        label={t('board.plan.dashed')}
        aria-pressed={!!movingIcon.dashed}
        onClick={() => write({ ...movingIcon, dashed: true })}
      />
      <IconButton
        icon="trash"
        label={t('board.plan.clearRoute')}
        onClick={() => {
          const next = { ...movingIcon };
          delete next.steps;
          delete next.note;
          delete next.dashed;
          write(next);
        }}
      />
      <span className="plan-editor__vr" aria-hidden="true" />
      <button type="button" className="plan-editor__done" onClick={endRoute}>
        {t('film.pen.done')}
      </button>
    </div>
  );
  const scaleValue = drawn.scale
    ? t('board.plan.scaleGrid', { grid: Number(drawn.grid ?? '0.5').toLocaleString(i18n.language) })
    : t('board.plan.noScale');
  const scalePanel = (
    <>
      <div className="plan-props__row">
        <span>{t('board.plan.scale')}</span>
        <b>{scaleValue}</b>
      </div>
      <Button
        icon="ruler"
        onClick={() => {
          closePop();
          pickTool('scale');
        }}
      >
        {t('board.plan.setScale')}
      </Button>
      {drawn.scale && (
        <>
          <label className="plan-props__row">
            <span>{t('board.plan.rulers')}</span>
            <Switch
              checked={!!drawn.rulers}
              onChange={(e) =>
                change(() =>
                  updateElement(doc, scaleOwner, { rulers: e.target.checked || undefined }, LOCAL),
                )
              }
            />
          </label>
          <Button
            variant="ghost"
            onClick={() =>
              change(() =>
                updateElement(
                  doc,
                  scaleOwner,
                  { scale: undefined, grid: undefined, rulers: undefined },
                  LOCAL,
                ),
              )
            }
          >
            {t('board.plan.clearScale')}
          </Button>
        </>
      )}
    </>
  );
  const metresDraft = scaleDraft ? Number(scaleDraft.metres.replace(',', '.')) : 0;
  // Within the schema: at least a centimetre, and a scale the document accepts.
  const scaleOk =
    !!scaleDraft &&
    metresDraft >= 0.01 &&
    metresDraft < 1000 &&
    (scaleFor(scaleDraft.length, metresDraft) ?? Infinity) <= MAX_SCALE;
  const scaleDialog = scaleDraft && (
    <div className="plan-scale ink-motion-pop" role="dialog" aria-label={t('board.plan.setScale')}>
      <div className="plan-scale__head">
        <b>{t('board.plan.setScale')}</b>
        <IconButton
          icon="close"
          label={t('board.plan.cancel')}
          onClick={() => setScaleDraft(null)}
        />
      </div>
      <label className="plan-scale__field">
        <span>{t('board.plan.lineIs')}</span>
        <span className="plan-num">
          <input
            inputMode="decimal"
            // biome-ignore lint/a11y/noAutofocus: the dialog opens to take this one number.
            autoFocus
            aria-label={t('board.plan.lineIs')}
            value={scaleDraft.metres}
            onChange={(e) => setScaleDraft({ ...scaleDraft, metres: e.target.value })}
          />
          <span>{t('board.plan.metres')}</span>
        </span>
      </label>
      <div className="plan-props__row">
        <span>{t('board.plan.grid')}</span>
        <fieldset className="plan-props__segmented" aria-label={t('board.plan.grid')}>
          {(['0.25', '0.5', '1'] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={gridDraft === g}
              onClick={() => setGridDraft(g)}
            >
              {Number(g).toLocaleString(i18n.language)}
              {g === '1' ? ' m' : ''}
            </button>
          ))}
        </fieldset>
      </div>
      <label className="plan-props__row">
        <span>{t('board.plan.rulers')}</span>
        <Switch checked={rulersDraft} onChange={(e) => setRulersDraft(e.target.checked)} />
      </label>
      <div className="plan-scale__actions">
        <Button variant="ghost" onClick={() => setScaleDraft(null)}>
          {t('board.plan.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!scaleOk}
          onClick={() => {
            const next = scaleFor(scaleDraft.length, metresDraft);
            if (!next || !scaleOk) return;
            change(() =>
              updateElement(
                doc,
                scaleOwner,
                {
                  scale: Math.round(next * 100) / 100,
                  grid: gridDraft,
                  rulers: rulersDraft || undefined,
                },
                LOCAL,
              ),
            );
            setScaleDraft(null);
          }}
        >
          {t('board.plan.apply')}
        </Button>
      </div>
    </div>
  );
  /** The number of a measure just drawn; without a scale, the offer to make it the scale. */
  const measurePanel = measureDraft && (
    <div
      className="plan-pop plan-pop--measure ink-motion-pop"
      role="dialog"
      aria-label={t('board.plan.shapes.measure')}
      style={
        phone
          ? undefined
          : (() => {
              const r = stage.current?.getBoundingClientRect();
              if (!r) return undefined;
              const left = r.left + measureDraft.at.x * r.width - 135;
              const top = r.top + measureDraft.at.y * r.height;
              const low = top > window.innerHeight - 220;
              return {
                position: 'fixed',
                left: Math.max(8, Math.min(left, window.innerWidth - 278)),
                ...(low ? { bottom: window.innerHeight - top + 12 } : { top: top + 12 }),
              } as CSSProperties;
            })()
      }
    >
      {measureDraft.asking ? (
        <div className="plan-pop__ask">
          <b>{t('board.plan.noScaleYet')}</b>
          <p>
            {t('board.plan.useAsScale', {
              value: Number(measureDraft.asking).toLocaleString(i18n.language, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
            })}
          </p>
          <div className="plan-pop__actions">
            <Button variant="primary" onClick={measureAsScale}>
              {t('board.plan.useAsScaleYes')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                writeMeasure(measureDraft.id, measureDraft.asking as string);
                setMeasureDraft(null);
              }}
            >
              {t('board.plan.useAsScaleNo')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="plan-pop__row plan-pop__row--end">
            <label className="plan-pop__field">
              <span>{t('board.plan.shapes.measure')}</span>
              <input
                className={`plan-editor__field${measureDraft.wrong ? ' is-wrong' : ''}`}
                inputMode="decimal"
                // biome-ignore lint/a11y/noAutofocus: the panel opens to take this one number.
                autoFocus
                aria-label={t('board.plan.measureMetres')}
                aria-invalid={measureDraft.wrong}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitMeasure();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setMeasureDraft(null);
                  }
                }}
                value={measureDraft.value}
                onChange={(e) =>
                  setMeasureDraft({ ...measureDraft, value: e.target.value, wrong: false })
                }
              />
            </label>
            <span className="plan-pop__unit">m</span>
            <Button variant="primary" onClick={commitMeasure}>
              {t('film.pen.done')}
            </Button>
          </div>
          {measureDraft.wrong ? (
            <p className="plan-pop__wrong" role="alert">
              {t('board.plan.measureWrong')}
            </p>
          ) : (
            <p className="plan-pop__text">{t('board.plan.measureHint')}</p>
          )}
        </>
      )}
    </div>
  );
  /** Rulers in metres along the top and the left of a scaled plan. */
  const rulers = !phone && drawn.scale && drawn.rulers && (
    <>
      <div className="plan-ruler plan-ruler--top" aria-hidden="true">
        {Array.from({ length: Math.floor(PLAN_VIEW_W / drawn.scale) + 1 }, (_, m) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a metre is its place on the ruler.
          <span key={m} style={{ left: `${((m * (drawn.scale as number)) / PLAN_VIEW_W) * 100}%` }}>
            {m === 1 ? '1 m' : m}
          </span>
        ))}
      </div>
      <div className="plan-ruler plan-ruler--left" aria-hidden="true">
        {Array.from({ length: Math.floor(PLAN_VIEW_H / drawn.scale) + 1 }, (_, m) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a metre is its place on the ruler.
          <span key={m} style={{ top: `${((m * (drawn.scale as number)) / PLAN_VIEW_H) * 100}%` }}>
            {m}
          </span>
        ))}
      </div>
    </>
  );

  const counts = layerCounts(drawn);
  const locked = new Set(plan.lockedLayers ?? []);
  const toggleHidden = (layer: PlanLayer) => {
    if (plan.variantOf) {
      // On a variant, hiding is the variant's: for everyone, and in its exports.
      const next = hiddenLayers.has(layer)
        ? (plan.hiddenLayers ?? []).filter((l) => l !== layer)
        : [...(plan.hiddenLayers ?? []), layer];
      change(() =>
        updateElement(doc, plan.id, { hiddenLayers: next.length ? next : undefined }, LOCAL),
      );
    } else
      setMyHidden((s) => {
        const next = new Set(s);
        if (next.has(layer)) next.delete(layer);
        else next.add(layer);
        return next;
      });
  };
  const toggleLocked = (layer: PlanLayer) => {
    const next = locked.has(layer) ? [...locked].filter((l) => l !== layer) : [...locked, layer];
    change(() =>
      updateElement(doc, plan.id, { lockedLayers: next.length ? next : undefined }, LOCAL),
    );
  };
  const layersPane = (
    <div className="plan-layers">
      <ul>
        {PLAN_LAYERS.map((layer) => (
          <li key={layer} className={activeLayer === layer ? 'is-active' : undefined}>
            <button
              type="button"
              className="plan-layers__name"
              aria-pressed={activeLayer === layer}
              onClick={() => setActiveLayer((l) => (l === layer ? null : layer))}
            >
              <i className={`plan-layers__dot plan-layers__dot--${layer}`} />
              <span className={hiddenLayers.has(layer) ? 'is-off' : undefined}>
                {t(`board.plan.layers.${layer}`)}
              </span>
              <span className="plan-layers__count">{counts[layer]}</span>
            </button>
            <IconButton
              icon={hiddenLayers.has(layer) ? 'eyeOff' : 'eye'}
              label={t(hiddenLayers.has(layer) ? 'board.plan.showLayer' : 'board.plan.hideLayer', {
                layer: t(`board.plan.layers.${layer}`),
              })}
              aria-pressed={hiddenLayers.has(layer)}
              onClick={() => toggleHidden(layer)}
            />
            <IconButton
              icon={locked.has(layer) ? 'lock' : 'unlock'}
              label={t(locked.has(layer) ? 'board.plan.unlockLayer' : 'board.plan.lockLayer', {
                layer: t(`board.plan.layers.${layer}`),
              })}
              aria-pressed={locked.has(layer)}
              onClick={() => toggleLocked(layer)}
            />
          </li>
        ))}
      </ul>
      <p className="plan-props__hint">
        {activeLayer
          ? t('board.plan.layersHint', { layer: t(`board.plan.layers.${activeLayer}`) })
          : t('board.plan.layersHintNone')}
      </p>
    </div>
  );
  const layerStatus = [
    ...[...hiddenLayers].map((l) => t(`board.plan.hiddenAs.${l}`)),
    ...[...locked].map((l) => t(`board.plan.lockedAs.${l}`)),
  ];
  const variantTabs = family.length > 1 && (
    <nav className="plan-editor__variants" aria-label={t('board.plan.variants')}>
      {family.map((p) => {
        const scene = scenes.find((sc) => p.sceneIds?.includes(sc.id));
        const name = p.variantOf ? p.variant || t('board.plan.variant') : t('board.plan.base');
        return (
          <button
            key={p.id}
            type="button"
            aria-current={p.id === plan.id ? 'page' : undefined}
            onClick={() => p.id !== plan.id && onSwitch?.(p.id)}
          >
            {scene ? `${name} · ${t('needed.sceneNumber', { number: scene.number })}` : name}
          </button>
        );
      })}
    </nav>
  );
  const newVariantButton = onNewVariant && (
    <IconButton icon="plus" label={t('board.plan.newVariant')} onClick={onNewVariant} />
  );

  /** "…" of the plan: what is seldom needed. Aggancia alla griglia stays one click from here. */
  const moreItems: MenuItem[] = [
    {
      label: t('board.plan.snap'),
      shortcut: 'G',
      checked: snap,
      icon: 'grid',
      action: () => setSnap((v) => !v),
    },
    {
      label: t('board.plan.ghosts'),
      checked: ghosts,
      icon: 'blocking',
      action: () => setGhosts((v) => !v),
    },
    {
      label: t('board.plan.inPresentation'),
      checked: plan.presentation !== false,
      icon: 'play',
      action: () =>
        change(() =>
          updateElement(
            doc,
            plan.id,
            { presentation: plan.presentation !== false ? false : undefined },
            LOCAL,
          ),
        ),
    },
    ...(plan.variantOf
      ? [
          {
            label: t('board.plan.variantField'),
            icon: 'text' as IconName,
            action: () => nextPop('variant'),
          },
        ]
      : []),
    ...(phone
      ? [
          {
            label: `${t('board.plan.scale')}: ${scaleValue}`,
            icon: 'ruler' as IconName,
            action: () => nextPop('scale'),
          },
          {
            label: t('board.plan.linkScene'),
            icon: 'link' as IconName,
            action: () => {
              const a = popAnchor.current?.getBoundingClientRect();
              setPicking({ x: 8, y: (a?.bottom ?? 48) + 6 });
            },
          },
        ]
      : []),
  ];
  const itemMoreItems: MenuItem[] = current
    ? [
        { label: t('board.plan.duplicate'), icon: 'copy', action: duplicate },
        {
          label: t('board.plan.moveToLayer'),
          icon: 'layers',
          shortcut: t(`board.plan.layers.${layerOf(current)}`),
          disabled: ownerOf(current.id) !== plan.id,
          action: () => nextPop('moveLayer'),
        },
        {
          label: t('board.plan.rotateBy', { degrees: QUARTER_TURN }),
          icon: 'rotateRight',
          shortcut: 'R',
          action: () => rotate(QUARTER_TURN),
        },
        ...(isIcon(current) && (current.steps?.length ?? 0) > 0
          ? [
              {
                label: t('board.plan.stepNotes'),
                icon: 'note' as IconName,
                action: () => nextPop('steps'),
              },
            ]
          : []),
        { divider: true },
        { label: t('board.plan.delete'), icon: 'trash', danger: true, action: remove },
      ]
    : [];
  const layerMenuItems: MenuItem[] = current
    ? // On a variant the Set is the base's: the variant's own items cannot go there.
      PLAN_LAYERS.filter((l) => !(base && l === 'set')).map((l) => ({
        label: t(`board.plan.layers.${l}`),
        checked: layerOf(current) === l,
        action: () => {
          const next = { ...current, layer: l };
          // The item's own default layer is not written (a text's is Notes, not Set).
          if (defaultLayer(current) === l) delete (next as Partial<PlanIcon>).layer;
          write(next);
        },
      }))
    : [];
  const shapeItems: MenuItem[] = (['line', 'arrow', 'rect', 'ellipse'] as const).map((k) => ({
    label: t(`board.plan.tool.${k}`),
    icon: k,
    checked: tool === k && !armed,
    action: () => pickTool(k),
  }));
  const menuOf: Partial<Record<PopKind, MenuItem[]>> = {
    more: moreItems,
    itemMore: itemMoreItems,
    moveLayer: layerMenuItems,
    shapes: shapeItems,
  };
  const panelOf: Partial<Record<PopKind, { label: string; body: ReactNode }>> = {
    color: { label: t('board.plan.color'), body: palette },
    lens: { label: t('board.plan.lens'), body: lensPanel },
    light: { label: t('board.plan.light'), body: lightPanel },
    label: { label: t('board.plan.labelField'), body: labelField },
    steps: { label: t('board.plan.stepNotes'), body: stepsPanel },
    layers: { label: t('board.plan.panel.layers'), body: layersPane },
    scale: { label: t('board.plan.scale'), body: scalePanel },
    variant: {
      label: t('board.plan.variantField'),
      body: (
        <input
          className="plan-editor__field"
          aria-label={t('board.plan.variantField')}
          maxLength={60}
          defaultValue={plan.variant ?? ''}
          onBlur={(e) => {
            const variant = e.target.value.trim() || undefined;
            if (variant !== plan.variant)
              change(() => updateElement(doc, plan.id, { variant }, LOCAL));
          }}
        />
      ),
    },
  };
  const openMenu = pop && menuOf[pop.kind];
  const openPanel = pop && panelOf[pop.kind];
  const pops = (
    <>
      {openMenu && pop && (
        <ContextMenu
          key={pop.kind}
          className="plan-menu"
          label={pop.kind === 'more' ? t('board.plan.morePlan') : t('board.plan.more')}
          style={popStyle(pop.anchor)}
          anchor={popAnchor}
          items={openMenu}
          onClose={closePop}
        />
      )}
      {openPanel && pop && (
        <PopPanel
          key={pop.kind}
          box={popBox}
          label={openPanel.label}
          style={popStyle(pop.anchor)}
          anchor={popAnchor}
          onClose={closePop}
        >
          {openPanel.body}
        </PopPanel>
      )}
    </>
  );

  /** How many items the box being dragged would pick. */
  const marqueeCount = marquee
    ? withGroups(
        drawn,
        itemsInRect(
          drawn,
          {
            x: Math.min(marquee.a.x, marquee.b.x) * PLAN_VIEW_W,
            y: Math.min(marquee.a.y, marquee.b.y) * PLAN_VIEW_H,
            w: Math.abs(marquee.b.x - marquee.a.x) * PLAN_VIEW_W,
            h: Math.abs(marquee.b.y - marquee.a.y) * PLAN_VIEW_H,
          },
          viewOf,
        ),
      ).length
    : 0;
  const armedName = armed && t(`board.plan.icons.${armed}`);
  const isEmpty = planItems(drawn).length === 0;

  const stageArea = (
    <div className={`plan-editor__stage-wrap${library && !phone ? ' has-library' : ''}`}>
      <div
        className="plan-editor__fit"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) setSelection([]);
        }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the drawing is pointer work; the bars and keys give the same tools. */}
        <div
          ref={stage}
          className={`plan-editor__stage plan-editor__stage--${tool}`}
          onPointerDown={onPointerDown}
          // The press that opened a field to write in must not take its focus back.
          onMouseDown={(e) => {
            if (editingText || measureDraft) e.preventDefault();
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {rulers}
          <PlanDrawing
            plan={shown}
            grid={step}
            ghosts={ghosts}
            route
            hidden={hiddenList}
            lifted={liftedIds}
            label={t('board.plan.drawing')}
          >
            {liveLayer}
          </PlanDrawing>
          {isEmpty && tool === 'select' && !armed && (
            <p className="plan-editor__empty">{t('board.plan.emptyHint')}</p>
          )}
          {marquee && !phone && (
            <span
              className="plan-editor__tool-label"
              style={{
                left: `${Math.min(Math.max(marquee.a.x, marquee.b.x) * 100, 72)}%`,
                top: `${Math.min(Math.max(marquee.a.y, marquee.b.y) * 100, 94)}%`,
              }}
            >
              {t('board.plan.marquee', { count: marqueeCount })}
            </span>
          )}
          {text && (
            <input
              ref={textInput}
              className="plan-editor__text"
              aria-label={t('film.pen.textField')}
              placeholder={t('film.pen.textPlaceholder')}
              maxLength={500}
              value={text.value}
              style={{ left: `${text.at.x * 100}%`, top: `${text.at.y * 100}%` }}
              onChange={(e) => {
                const draft = { ...text, value: e.target.value };
                textRef.current = draft;
                setText(draft);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  textRef.current = null;
                  setText(null);
                }
              }}
              onBlur={commitText}
            />
          )}
        </div>
      </div>
      {moveBar}
      {layerStatus.length > 0 && !phone && (
        <p className="plan-editor__status">{layerStatus.join(' · ')}</p>
      )}
      {tool === 'scale' && (
        <p className="plan-editor__movebar plan-editor__tip">{t('board.plan.scaleHint')}</p>
      )}
      {scaleDialog}
      {armed && armedName && (
        <p className="plan-editor__toast ink-motion-pop" role="status">
          <span>{t(phone ? 'board.plan.placeTap' : 'board.plan.placeClick')}</span>
          <b>{armedName}</b>
          <button type="button" className="plan-editor__done" onClick={disarm}>
            {t('board.plan.placeEnd')}
          </button>
          {!phone && <kbd>Esc</kbd>}
        </p>
      )}
      {movingIcon && (
        <p className="plan-editor__toast" role="status">
          {t(phone ? 'board.plan.routeHintPhone' : 'board.plan.routeHint', {
            number: (movingIcon.steps?.length ?? 0) + 2,
          })}
        </p>
      )}
      {marquee && phone && (
        <p className="plan-editor__toast" role="status">
          {t('board.plan.marqueeHold', { count: marqueeCount })}
        </p>
      )}
      {!movingIcon && preview === null && !marquee && bar}
      {tools}
      {library && !phone && libraryPanel}
    </div>
  );

  if (phone)
    // On the body: over the phone's navigation bar, which the canvas does not cover.
    return createPortal(
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="plan-editor plan-editor--phone"
        data-chrome=""
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="plan-editor__head">
          <b>{t('board.plan.short')}</b>
          <span className="plan-editor__subtitle">{plan.title}</span>
          <span className="plan-editor__spacer" />
          <IconButton
            icon="layers"
            label={t('board.plan.panel.layers')}
            aria-haspopup="dialog"
            onClick={openPop('layers')}
          />
          <IconButton
            icon="more"
            label={t('board.plan.morePlan')}
            aria-haspopup="menu"
            onClick={openPop('more')}
          />
          <Button variant="primary" onClick={onClose}>
            {t('film.pen.done')}
          </Button>
          {picking && (
            <ScenePicker
              store={store}
              plan={plan}
              scenes={scenes}
              style={{ position: 'fixed', left: picking.x, top: picking.y }}
              onClose={() => setPicking(null)}
            />
          )}
        </header>
        {stageArea}
        {library && !current && libraryPanel}
        {measurePanel}
        {pops}
      </div>,
      document.body,
    );
  // On the body too: the window sits in front of the whole app, the shell dimmed with the board.
  return createPortal(
    <div className="plan-editor" data-chrome="">
      <div className="plan-editor__backdrop" aria-hidden="true" onPointerDown={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="plan-editor__window ink-motion-rise"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="plan-editor__head">
          <span className="plan-editor__name">{t('board.plan.name')}</span>
          <input
            className="plan-editor__title"
            aria-label={t('board.plan.titleField')}
            placeholder={t('board.plan.titlePlaceholder')}
            maxLength={200}
            defaultValue={plan.title ?? ''}
            size={Math.max(8, (plan.title ?? '').length + 1)}
            onBlur={(e) => {
              const title = e.target.value.trim() || undefined;
              if (title !== plan.title) change(() => updateElement(doc, plan.id, { title }, LOCAL));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
          <SceneBadges scenes={linked} onOpen={onOpenScene} />
          <IconButton
            icon="link"
            label={t('board.plan.linkScene')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPicking({ x: r.left, y: r.bottom + 6 });
            }}
          />
          {picking && (
            <ScenePicker
              store={store}
              plan={plan}
              scenes={scenes}
              style={{ position: 'fixed', left: picking.x, top: picking.y }}
              onClose={() => setPicking(null)}
            />
          )}
          {variantTabs}
          {newVariantButton}
          <span className="plan-editor__spacer" />
          <button
            type="button"
            className="plan-editor__headbtn"
            aria-haspopup="dialog"
            onClick={openPop('scale')}
          >
            <Icon name="ruler" size={15} />
            {drawn.scale ? `${t('board.plan.scale')}: ${scaleValue}` : t('board.plan.scale')}
          </button>
          <button
            type="button"
            className="plan-editor__headbtn"
            aria-haspopup="dialog"
            onClick={openPop('layers')}
          >
            <Icon name="layers" size={15} />
            {t('board.plan.panel.layers')}
          </button>
          <IconButton
            icon="more"
            label={t('board.plan.morePlan')}
            aria-haspopup="menu"
            onClick={openPop('more')}
          />
          <Button variant="primary" onClick={onClose}>
            {t('film.pen.done')}
          </Button>
        </header>
        <div className="plan-editor__body">{stageArea}</div>
        {measurePanel}
        {pops}
      </div>
    </div>,
    document.body,
  );
}

const TOOL_OF_NOTE: Record<PlanNoteTool, Tool> = {
  arrow: 'arrow',
  text: 'text',
  measure: 'measure',
  zone: 'zone',
};

/** A button of the item's bar with its name; on a phone only its icon, as on the mockup. */
function PopButton({
  phone,
  icon,
  label,
  noCaret,
  onClick,
}: {
  phone: boolean;
  icon: IconName;
  label: string;
  noCaret?: boolean;
  onClick: (e: MouseEvent<HTMLElement>) => void;
}) {
  if (phone) return <IconButton icon={icon} label={label} onClick={onClick} />;
  return (
    <button type="button" className="plan-editor__lens" onClick={onClick}>
      {noCaret && <Icon name={icon} size={14} />}
      {label}
      {!noCaret && <Icon name="chevronDown" size={12} />}
    </button>
  );
}

/** A small panel by the button that opened it: a press outside closes it, as menus do. */
function PopPanel({
  box,
  label,
  style,
  anchor,
  onClose,
  children,
}: {
  box: RefObject<HTMLDivElement | null>;
  label: string;
  style: CSSProperties;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button, input, [role="combobox"]')?.focus();
    const away = (e: globalThis.PointerEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [box, anchor, onClose]);
  return (
    <div
      ref={box}
      className="plan-pop ink-motion-pop"
      role="dialog"
      aria-label={label}
      style={style}
    >
      {children}
    </div>
  );
}
