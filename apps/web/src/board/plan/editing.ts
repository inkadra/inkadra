// SPDX-License-Identifier: AGPL-3.0-only
import {
  addPlanIcon,
  attachIcon,
  type CardsById,
  defaultIconSize,
  defaultLayer,
  duplicatePlanItems,
  gridStep,
  itemsBox,
  itemTier,
  kindLayer,
  layerOf,
  linkedPlan,
  measureEnds,
  moveItem,
  moveWithAttached,
  type PlanElement,
  type PlanItem,
  type PlanItemRef,
  type Point,
  planItem,
  planItems,
  removePlanItems,
  rotateItem,
  rotateWithAttached,
  type SceneElement,
  toGrid,
  updateElement,
  updatePlanItems,
  variantView,
  withAttached,
  withGroups,
} from '@inkadra/canvas-core';
import {
  type AspectRatio,
  MAX_PLAN_ICONS,
  type PlanIcon,
  type PlanIconKind,
  type PlanLayer,
} from '@inkadra/doc-schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type BoardStore, LOCAL } from '../store.ts';
import type { LibraryItem } from './library.ts';
import { CHARACTER_COLOURS, iconColor } from './PlanDrawing.tsx';
import { rememberRecent } from './PlanLibrary.tsx';

export type DragKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'zone' | 'measure' | 'scale';
export type Tool = 'select' | 'pencil' | 'text' | 'icons' | 'move' | DragKind;
export type PanelTab = 'properties' | 'elements' | 'kit';
/** A full sheet of the phone over the plan. */
export type PhoneSheet = 'library' | 'elements' | 'kit' | null;
/** Degrees the R key and the menu turn an item by. */
export const QUARTER_TURN = 45;
export const MAX_UNITS = 4000;
export const MAX_SCALE = 100000;
export const isIcon = (item: PlanItem | null | undefined): item is PlanIcon =>
  !!item && 'x' in item;

export interface PlanEditorProps {
  store: BoardStore;
  plan: PlanElement;
  phone: boolean;
  /** Scenes of the board, in shooting order, to link the plan to. */
  scenes: readonly SceneElement[];
  /** The base of a setup, whose Set layer it shows and edits. */
  base?: PlanElement | undefined;
  /** The base and its setups, for the tabs of the header. */
  family?: readonly PlanElement[];
  /** The cards of the board, for the links of decision 0104 (read only here). */
  cards?: CardsById;
  /** Shot labels of the storyboard, by frame id. */
  labels?: ReadonlyMap<string, string>;
  /** The plans the project kit is derived from. */
  kitPlans?: readonly PlanElement[];
  onSwitch?: (id: string) => void;
  /** A new setup copied from the one being edited. */
  onNewVariant?: () => void;
  /** Lenses of the frames of the plan's scenes, proposed for a camera ("5A · 35 mm"). */
  lenses?: ReadonlyArray<{ label: string; mm: number }>;
  onOpenScene: (id: string) => void;
  /** Opens a linked character, frame or location card (decision 0104), leaving the editor. */
  onOpenCard?: ((id: string) => void) | undefined;
  /** The board's frame aspect, for the picture of a linked frame. */
  boardAspect?: AspectRatio | undefined;
  onClose: () => void;
}

const replaceIn = <T extends { id: string }>(
  list: T[] | undefined,
  next: readonly PlanItem[],
): T[] | undefined =>
  list?.map((item) => (next.find((n) => n.id === item.id) as unknown as T | undefined) ?? item);

/**
 * The state of the set plan editor that its parts share (decision 0104): the tool, the
 * selection, the layers this person hides, and the writes. Every write is one change of the
 * document, one undo step; typing in a field writes as it goes inside one step.
 */
export function usePlanEditing(props: PlanEditorProps) {
  const { store, plan, base, phone } = props;
  const doc = store.doc;
  const [tool, setTool] = useState<Tool>('select');
  const [armed, setArmed] = useState<LibraryItem | null>(null);
  const [selection, setSelection] = useState<PlanItemRef[]>([]);
  /** Snap to the grid (G). */
  const [snap, setSnap] = useState(true);
  /** Snap icons together (Alt while dropping, the Snap toggle on a phone). */
  const [attach, setAttach] = useState(true);
  const [myHidden, setMyHidden] = useState<ReadonlySet<PlanLayer>>(new Set());
  const [activeLayer, setActiveLayer] = useState<PlanLayer | null>(null);
  const [ghosts, setGhosts] = useState(false);
  /** The base setup drawn faintly behind a setup. */
  const [ghostBase, setGhostBase] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  /** The base an icon dragged from the library would attach to, lit on the plan. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [penColor, setPenColor] = useState<string | null>(null);
  const [lockedItem, setLockedItem] = useState<PlanItem | null>(null);
  const [tab, setTab] = useState<PanelTab>('properties');
  const [sheet, setSheet] = useState<PhoneSheet>(null);
  /** The item being moved or turned, shown in place until the gesture ends. */
  const [preview, setPreviewState] = useState<PlanItem[] | null>(null);
  const previewRef = useRef<PlanItem[] | null>(null);
  const setPreview = (next: PlanItem | PlanItem[] | null) => {
    const list = next === null ? null : Array.isArray(next) ? next : [next];
    previewRef.current = list;
    setPreviewState(list);
  };
  /** Called with the client point of the middle of the plan, to place there. */
  const middle = useRef<() => Point>(() => ({ x: 0.5, y: 0.5 }));

  /** A setup shows its base's Set layer under its own; measures drawn where their icons stand. */
  const drawn = useMemo(() => {
    const merged = base ? variantView(plan, base) : plan;
    return { ...merged, shapes: merged.shapes?.map((sh) => measureEnds(sh, merged.icons)) };
  }, [plan, base]);
  /** The plan as it is shown and listed, its links resolved; writes start from `drawn`. */
  const linked = useMemo(
    () => linkedPlan(drawn, props.cards ?? new Map(), { palette: CHARACTER_COLOURS }),
    [drawn, props.cards],
  );
  const step = gridStep(drawn);
  const scaleOwner = base?.id ?? plan.id;
  const baseIds = new Set(
    base ? planItems(drawn).flatMap(({ item }) => (layerOf(item) === 'set' ? [item.id] : [])) : [],
  );
  const ownerOf = (id: string) => (base && baseIds.has(id) ? base.id : plan.id);
  const targetFor = (layer: PlanLayer) => (base && layer === 'set' ? base.id : plan.id);
  const hiddenLayers = new Set<PlanLayer>([...(plan.hiddenLayers ?? []), ...myHidden]);
  const locked = new Set<PlanLayer>(plan.lockedLayers ?? []);
  const viewOf = { hidden: hiddenLayers, locked };
  const shown =
    preview === null
      ? drawn
      : {
          ...drawn,
          strokes: replaceIn(drawn.strokes, preview),
          shapes: replaceIn(drawn.shapes, preview),
          icons: replaceIn(drawn.icons, preview),
        };
  const selected = selection.length === 1 ? (selection[0] as PlanItemRef) : null;
  const item = selected ? (planItem(drawn, selected) ?? null) : null;
  const many = selection.length > 1 ? selection.flatMap((r) => planItem(drawn, r) ?? []) : [];
  const icons = drawn.icons ?? [];
  const movingIcon = icons.find((i) => i.id === moving) ?? null;

  // The selection loses the items that go (deleted here, by undo or by someone else).
  useEffect(() => {
    if (selection.some((r) => !planItem(drawn, r)))
      setSelection((s) => s.filter((r) => planItem(drawn, r)));
  }, [selection, drawn]);
  // Another tool ends the movement being drawn.
  useEffect(() => {
    if (tool !== 'move') setMoving(null);
  }, [tool]);

  const select = (ref: PlanItemRef | null) => setSelection(ref ? withGroups(drawn, [ref]) : []);
  /** One change, one undo step. */
  const change = (write: () => void) => {
    store.undo.stopCapturing();
    write();
    store.undo.stopCapturing();
  };
  /**
   * Writes items where they live: the base's Set layer, or the plan (no undo step). Only what
   * differs from `baseline` is written (for a gesture, the items as they were when it started),
   * so another person's edit of another field made meanwhile stays.
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
  /** A field of an item written as it is typed: one undo step per field. */
  const edit = <T extends PlanItem>(target: T, patch: Partial<T>) => {
    const next = { ...target, ...patch } as T;
    for (const [k, v] of Object.entries(patch))
      if (v === undefined || v === '') delete (next as Record<string, unknown>)[k];
    writeItems([next]);
  };
  const editPlan = (patch: Partial<PlanElement>, id = plan.id) =>
    change(() => updateElement(doc, id, patch as never, LOCAL));

  const remove = (ids = selection.map((r) => r.id)) => {
    if (ids.length === 0) return;
    change(() => {
      removePlanItems(doc, plan.id, ids, LOCAL);
      if (base) removePlanItems(doc, base.id, ids, LOCAL);
    });
    setSelection((s) => s.filter((r) => !ids.includes(r.id)));
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
  const chosen = (): PlanItem[] => (many.length > 1 ? many : item ? [item] : []);
  const rotate = (degrees: number) => {
    if (many.length > 1) {
      const b = itemsBox(many);
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      write(many.map((i) => rotateItem(i, degrees, c)));
    } else if (isIcon(item) && withAttached(icons, [item.id]).size > 1)
      // A base turns what is on it as one piece (decision 0104).
      write(rotateWithAttached(icons, item.id, degrees));
    else if (item) write(rotateItem(item, degrees));
  };
  const nudge = (d: Point) => {
    const items = chosen();
    if (!items.length) return;
    const carried = moveWithAttached(
      icons,
      items.filter(isIcon).map((i) => i.id),
      d,
    );
    write([...items.filter((i) => !isIcon(i)).map((i) => moveItem(i, d)), ...carried]);
  };
  /** The colours paint what is selected; with nothing selected, the next strokes and icons. */
  const pickColor = (hex: string) => {
    const items = chosen();
    if (items.length) write(items.map((i) => ({ ...i, color: hex })));
    else setPenColor(hex);
  };
  /** Bring forward (+1) and Send back (-1): the stacking tier of the selected icons. */
  const restack = (by: 1 | -1) => {
    const items = chosen().filter(isIcon);
    if (items.length)
      write(items.map((i) => ({ ...i, tier: Math.max(0, Math.min(5, Number(itemTier(i)) + by)) })));
  };
  const moveToLayer = (layer: PlanLayer) => {
    const items = chosen().filter((i) => ownerOf(i.id) === plan.id);
    write(
      items.map((i) => {
        const next = { ...i, layer };
        if (defaultLayer(i) === layer) delete (next as Partial<PlanIcon>).layer;
        return next;
      }),
    );
  };
  const toggleHidden = (layer: PlanLayer) => {
    if (plan.variantOf) {
      // On a setup, hiding is the setup's: for everyone, and in its exports.
      const next = hiddenLayers.has(layer)
        ? (plan.hiddenLayers ?? []).filter((l) => l !== layer)
        : [...(plan.hiddenLayers ?? []), layer];
      editPlan({ hiddenLayers: next.length ? next : undefined });
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
    editPlan({ lockedLayers: next.length ? next : undefined });
  };

  /**
   * Places an icon at `p` (0 to 1 of the drawing): its real size, its family's colour and layer.
   * `on` attaches it to that icon (decision 0104). Returns its id.
   */
  const placeIcon = (
    kind: PlanIconKind,
    p: Point,
    opts: { keep?: boolean; fields?: Partial<PlanIcon>; on?: string | null } = {},
  ): string | null => {
    if ((plan.icons?.length ?? 0) >= MAX_PLAN_ICONS) return null;
    let id: string | null = null;
    change(() => {
      const layer = activeLayer ?? kindLayer(kind);
      const fresh = {
        kind,
        color: penColor ?? iconColor(kind),
        x: toGrid(p.x),
        y: toGrid(p.y),
        ...defaultIconSize(kind, drawn.scale),
        ...(layer !== kindLayer(kind) ? { layer } : {}),
        ...opts.fields,
      };
      id = addPlanIcon(doc, targetFor(layer), fresh, LOCAL);
      if (id && opts.on) {
        const placed = attachIcon([...icons, { ...fresh, id }], id, opts.on);
        if (placed.length) writeItems(placed, [{ ...fresh, id }]);
      }
    });
    rememberRecent(kind);
    if (opts.keep || !id) return id;
    setArmed(null);
    setTool('select');
    setSelection([{ kind: 'icons', id }]);
    return id;
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

  return {
    ...props,
    cards: props.cards ?? new Map(),
    phone,
    doc,
    tool,
    setTool,
    armed,
    setArmed,
    selection,
    setSelection,
    select,
    snap,
    setSnap,
    attach,
    setAttach,
    myHidden,
    activeLayer,
    setActiveLayer,
    ghosts,
    setGhosts,
    ghostBase,
    setGhostBase,
    moving,
    movingIcon,
    dropTarget,
    setDropTarget,
    penColor,
    lockedItem,
    setLockedItem,
    tab,
    setTab,
    sheet,
    setSheet,
    preview,
    previewRef,
    setPreview,
    middle,
    drawn,
    linked,
    shown,
    step,
    scaleOwner,
    ownerOf,
    targetFor,
    hiddenLayers,
    locked,
    viewOf,
    item,
    many,
    icons,
    change,
    writeItems,
    write,
    edit,
    editPlan,
    remove,
    duplicate,
    rotate,
    nudge,
    pickColor,
    restack,
    moveToLayer,
    toggleHidden,
    toggleLocked,
    placeIcon,
    startRoute,
    endRoute,
    disarm,
  };
}

export type Ed = ReturnType<typeof usePlanEditing>;
