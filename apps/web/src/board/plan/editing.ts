// SPDX-License-Identifier: AGPL-3.0-only
import {
  addPlanIcon,
  attachIcon,
  type CardsById,
  defaultIconSize,
  defaultLayer,
  duplicatePlanItems,
  gridStep,
  itemLocked,
  itemsBox,
  itemTier,
  kindLayer,
  layerOf,
  measureEnds,
  moveItem,
  moveWithAttached,
  type PlanElement,
  type PlanGroupName,
  type PlanItem,
  type PlanItemRef,
  type Point,
  type ProjectKitEntry,
  planGroupOf,
  planItem,
  planItems,
  removePlanItems,
  rotateItem,
  rotateManyWithAttached,
  rotateWithAttached,
  type SceneElement,
  settleWrite,
  snapTarget,
  toGrid,
  transferPlanItems,
  updateElement,
  updatePlanItems,
  variantView,
  withAttached,
  withGroups,
} from '@inkadra/canvas-core';
import {
  MAX_PLAN_ICONS,
  type PlanIcon,
  type PlanIconKind,
  type PlanLayer,
} from '@inkadra/doc-schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type BoardStore, LOCAL } from '../store.ts';
import type { LibraryItem } from './library.ts';
import { iconColor } from './PlanDrawing.tsx';
import { rememberRecent } from './PlanLibrary.tsx';
import type { KitScope } from './project-kit.ts';

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
  /** The plans of this board, the project kit is derived from them live. */
  kitPlans?: readonly PlanElement[];
  /** The kit of the other boards of the project, and whether it arrived (decision 0114). */
  otherKits?: { entries: readonly ProjectKitEntry[]; scope: KitScope };
  onSwitch?: (id: string) => void;
  /** A new setup copied from the one being edited. */
  onNewVariant?: () => void;
  /** Lenses of the frames of the plan's scenes, proposed for a camera ("5A · 35 mm"). */
  lenses?: ReadonlyArray<{ label: string; mm: number }>;
  onOpenScene: (id: string) => void;
  /** Today's export of the plan card (the board's export of a selection). */
  onExport?: () => void;
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
  /** Layers, and the Grip and crew group, this person hides while editing. */
  const [myHidden, setMyHidden] = useState<ReadonlySet<PlanGroupName>>(new Set());
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
  const step = gridStep(drawn);
  const scaleOwner = base?.id ?? plan.id;
  // What the base holds, not what is drawn on Set: an item of the setup stranded on Set is the
  // setup's (variantView shows it), and moving it to Set again moves it into the base.
  const baseIds = new Set(base ? planItems(base).map(({ item }) => item.id) : []);
  const ownerOf = (id: string) => (base && baseIds.has(id) ? base.id : plan.id);
  const targetFor = (layer: PlanLayer) => (base && layer === 'set' ? base.id : plan.id);
  const hiddenLayers = new Set<PlanGroupName>([...(plan.hiddenLayers ?? []), ...myHidden]);
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
  /**
   * The base an icon would attach to at `at` (view units), for every way of placing or dragging
   * one (decision 0104): never an icon on a layer this person or the setup hides, so nothing
   * attaches to something invisible. A locked layer's icons stay bases: a person may still sit
   * on a locked sofa, which itself does not move.
   */
  const snapAt = (item: Pick<PlanIcon, 'kind'> & Partial<Pick<PlanIcon, 'id'>>, at: Point) =>
    snapTarget(
      item,
      at,
      (drawn.icons ?? []).filter(
        (i) => !hiddenLayers.has(layerOf(i)) && !hiddenLayers.has(planGroupOf(i)),
      ),
    );
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
  const writeItems = (
    written: readonly PlanItem[],
    baseline?: readonly PlanItem[],
    /** Icons placed in this change, not drawn yet, and the plan each went to. */
    placed: { icons: readonly PlanIcon[]; owners: ReadonlyMap<string, string> } = {
      icons: [],
      owners: new Map(),
    },
  ) => {
    // Whatever wrote them, the attachment rules hold (decision 0104): an `on` whose base is gone
    // is dropped, and what sits on a written base is placed again.
    const items = settleWrite([...icons, ...placed.icons], written);
    const all = planItems(drawn);
    const before =
      baseline ?? items.flatMap((i) => all.find((e) => e.item.id === i.id)?.item ?? []);
    const owner = (id: string) => placed.owners.get(id) ?? ownerOf(id);
    const own = items.filter((i) => owner(i.id) === plan.id);
    const shared = items.filter((i) => owner(i.id) !== plan.id);
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

  const remove = (all = selection.map((r) => r.id)) => {
    // Items locked on their own stay, and stay picked (decision 0114).
    const kept = new Set(planItems(drawn).flatMap((e) => (itemLocked(e.item) ? [e.item.id] : [])));
    const ids = all.filter((id) => !kept.has(id));
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
  /**
   * Locks or unlocks the selected items on their own (decision 0114): locked when one of them is
   * not yet. The only write a locked item takes, besides its base's moves.
   */
  const toggleItemLock = (items = chosen()) => {
    if (!items.length) return;
    const lock = !items.every(itemLocked);
    write(items.map((i) => ({ ...i, locked: lock ? true : undefined }) as PlanItem));
  };
  const rotate = (degrees: number) => {
    if (many.length > 1) {
      const b = itemsBox(many);
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      // What is attached to them turns with them, as they move together (decision 0104).
      write(rotateManyWithAttached(icons, many, degrees, c));
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
  /**
   * Moves the selected items of this plan to a layer. On a setup, Set is the base's, shared by
   * every setup (decisions 0062, 0104): what goes there moves into the base, in one undo step,
   * so a setup never keeps items of its own on Set.
   */
  const moveToLayer = (layer: PlanLayer) => {
    const items = chosen().filter((i) => ownerOf(i.id) === plan.id);
    const onLayer = (i: PlanItem) => ({ layer: defaultLayer(i) === layer ? undefined : layer });
    if (base && layer === 'set') {
      if (items.length)
        change(() =>
          transferPlanItems(
            doc,
            plan.id,
            base.id,
            items.map((i) => i.id),
            onLayer,
            LOCAL,
          ),
        );
      return;
    }
    write(items.map((i) => ({ ...i, ...onLayer(i) }) as PlanItem));
  };
  const toggleHidden = (layer: PlanGroupName) => {
    // Grip and crew is no layer of the document: hiding it is always this person's (decision 0114).
    if (plan.variantOf && layer !== 'grip') {
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
   * `on` attaches it to that icon; `modifiers` are placed on its front, in order (a light of the
   * project kit). One transaction, one undo step (decision 0104). Returns its id.
   */
  const placeIcon = (
    kind: PlanIconKind,
    p: Point,
    opts: {
      keep?: boolean;
      fields?: Partial<PlanIcon>;
      on?: string | null;
      modifiers?: readonly PlanIconKind[];
    } = {},
  ): string | null => {
    if ((plan.icons?.length ?? 0) >= MAX_PLAN_ICONS) return null;
    let id: string | null = null;
    const freshOf = (k: PlanIconKind) => {
      const layer = activeLayer ?? kindLayer(k);
      return {
        layer,
        icon: {
          kind: k,
          color: penColor ?? iconColor(k),
          x: toGrid(p.x),
          y: toGrid(p.y),
          ...defaultIconSize(k, drawn.scale),
          ...(layer !== kindLayer(k) ? { layer } : {}),
        },
      };
    };
    change(() =>
      doc.transact(() => {
        const placed: { icons: PlanIcon[]; owners: Map<string, string> } = {
          icons: [],
          owners: new Map(),
        };
        const add = (k: PlanIconKind, fields?: Partial<PlanIcon>): PlanIcon | null => {
          const { layer, icon } = freshOf(k);
          const target = targetFor(layer);
          const newId = addPlanIcon(doc, target, { ...icon, ...fields }, LOCAL);
          if (!newId) return null;
          const added = { ...icon, ...fields, id: newId } as PlanIcon;
          placed.icons.push(added);
          placed.owners.set(newId, target);
          return added;
        };
        /** Attaches against what is there now, the icons just placed included. */
        const attach = (itemId: string, baseId: string) => {
          const all = [...icons, ...placed.icons];
          const next = attachIcon(all, itemId, baseId);
          if (!next.length) return;
          writeItems(next, all, placed);
          for (const n of next) {
            const at = placed.icons.findIndex((i) => i.id === n.id);
            if (at >= 0) placed.icons[at] = n;
          }
        };
        const main = add(kind, opts.fields);
        if (!main) return;
        id = main.id;
        if (opts.on) attach(main.id, opts.on);
        for (const m of opts.modifiers ?? []) {
          const mod = add(m);
          if (!mod) break;
          attach(mod.id, main.id);
        }
      }, LOCAL),
    );
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
    snapAt,
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
    toggleItemLock,
    placeIcon,
    startRoute,
    endRoute,
    disarm,
  };
}

export type Ed = ReturnType<typeof usePlanEditing>;
