// SPDX-License-Identifier: AGPL-3.0-only
import {
  allowedWrites,
  type CardsById,
  duplicatePlanItems,
  ensurePlanScale,
  gridStep,
  hiddenToggle,
  itemLocked,
  linkedPlan,
  lockedLayersToggle,
  lockWrites,
  moveToPlanLayer,
  NOMINAL_SCALE,
  nudgeWrites,
  type PlanElement,
  type PlanGroupName,
  type PlanItem,
  type PlanItemRef,
  type Point,
  type ProjectKitEntry,
  placePlanIcon,
  planDropTarget,
  planEdit,
  planIconsFull,
  planItem,
  planItemOwner,
  planLayerOwner,
  planSnapAt,
  removeUnlockedItems,
  removeUnlockedWalls,
  restackWrites,
  rotateWrites,
  type SceneElement,
  updateElement,
  updatePlanWalls,
  withGroups,
  writePlanItems,
} from '@inkadra/canvas-core';
import {
  type AspectRatio,
  PLAN_LAYERS,
  type PlanIcon,
  type PlanIconKind,
  type PlanLayer,
  type PlanOpening,
  type PlanOpeningKind,
  type PlanWall,
} from '@inkadra/doc-schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type BoardStore, LOCAL } from '../store.ts';
import type { LibraryItem } from './library.ts';
import { CHARACTER_COLOURS, iconColor } from './PlanDrawing.tsx';
import { rememberRecent } from './PlanLibrary.tsx';
import { usePlanPref } from './plan-prefs.ts';
import type { KitScope } from './project-kit.ts';

export type DragKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'zone' | 'measure' | 'scale';
export type Tool =
  | 'select'
  | 'pencil'
  | 'text'
  | 'icons'
  | 'move'
  | 'walls'
  | 'openings'
  | DragKind;
/** A wall or an opening, picked or being edited (decision 0110). */
export interface WallRef {
  kind: 'walls' | 'openings';
  id: string;
}
/** Walls and openings shown in place while a gesture moves them. */
export interface WallPreview {
  walls?: PlanWall[];
  openings?: PlanOpening[];
}
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
  /** The project, for uploading a background picture; none where nothing is uploaded. */
  projectId?: string | undefined;
  /** The board, whose shooting days the sun's date offers; none for a guest or a preview. */
  boardId?: string | undefined;
  /** Opens a linked character, frame or location card (decision 0104), leaving the editor. */
  onOpenCard?: ((id: string) => void) | undefined;
  /** The board's frame aspect, for the picture of a linked frame. */
  boardAspect?: AspectRatio | undefined;
  onClose: () => void;
}

/** The names a person may hide for themselves: the layers and the Grip and crew group. */
const PLAN_GROUP_NAMES: ReadonlySet<string> = new Set([...PLAN_LAYERS, 'grip']);

const replaceIn = <T extends { id: string }>(
  list: T[] | undefined,
  next: ReadonlyArray<{ id: string }>,
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
  // This person's choices, kept in their account on the server (decision 0119).
  /** Snap to the grid (G). */
  const [snap, setSnap] = usePlanPref('planSnap');
  /** Snap icons together (Alt while dropping, the Snap toggle on a phone). */
  const [attach, setAttach] = usePlanPref('planAttach');
  /** Layers, and the Grip and crew group, this person hides while editing, on every plan. */
  const [hiddenPref, setHiddenPref] = usePlanPref('planHidden');
  const myHidden = useMemo<ReadonlySet<PlanGroupName>>(
    () => new Set(hiddenPref.filter((g): g is PlanGroupName => PLAN_GROUP_NAMES.has(g))),
    [hiddenPref],
  );
  // Earlier positions show, veiled, as the mockup draws them (audit M5).
  const [ghosts, setGhosts] = usePlanPref('planGhosts');
  // Per session: what is being worked on now.
  const [activeLayer, setActiveLayer] = useState<PlanLayer | null>(null);
  /** The base setup drawn faintly behind a setup. */
  const [ghostBase, setGhostBase] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  /** The base an icon dragged from the library would attach to, lit on the plan. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [penColor, setPenColor] = useState<string | null>(null);
  const [lockedItem, setLockedItem] = useState<PlanItem | null>(null);
  /** An item picked in Elements on a layer or group that is hidden (decision 0119). */
  const [hiddenItem, setHiddenItem] = useState<{
    item: PlanItem | PlanWall | PlanOpening;
    group: PlanGroupName;
  } | null>(null);
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
  /** The wall or opening picked (decision 0110); items and walls are never picked together. */
  const [wallSel, setWallSelState] = useState<WallRef | null>(null);
  /** A wall of the locked Set layer was clicked: the properties say why it does not pick. */
  const [lockedWall, setLockedWall] = useState(false);
  const [wallPreview, setWallPreview] = useState<WallPreview | null>(null);
  /** What the Openings tool places next. */
  const [openingKind, setOpeningKind] = useState<PlanOpeningKind>('door');
  /** The picture under the plan being moved and scaled (decision 0110). */
  const [placingBackground, setPlacingBackground] = useState(false);
  /** Called with the client point of the middle of the plan, to place there. */
  const middle = useRef<() => Point>(() => ({ x: 0.5, y: 0.5 }));

  /** A setup shows its base's Set layer under its own; measures drawn where their icons stand. */
  const editing = useMemo(() => planEdit(plan, base), [plan, base]);
  const { drawn } = editing;
  /** The plan as it is shown and listed, its links resolved; writes start from `drawn`. */
  const linked = useMemo(
    () => linkedPlan(drawn, props.cards ?? new Map(), { palette: CHARACTER_COLOURS }),
    [drawn, props.cards],
  );
  const step = gridStep(drawn);
  const scaleOwner = base?.id ?? plan.id;
  const ownerOf = (id: string) => planItemOwner(editing, id);
  const targetFor = (layer: PlanLayer) => planLayerOwner(editing, layer);
  const hiddenLayers = new Set<PlanGroupName>([...(plan.hiddenLayers ?? []), ...myHidden]);
  const locked = new Set<PlanLayer>(plan.lockedLayers ?? []);
  const viewOf = { hidden: hiddenLayers, locked };
  const moved =
    preview === null
      ? drawn
      : {
          ...drawn,
          strokes: replaceIn(drawn.strokes, preview),
          shapes: replaceIn(drawn.shapes, preview),
          icons: replaceIn(drawn.icons, preview),
        };
  /** The base an icon would attach to at `at` (view units); none on a hidden layer. */
  const snapAt = (item: Pick<PlanIcon, 'kind'> & Partial<Pick<PlanIcon, 'id'>>, at: Point) =>
    planSnapAt(editing, hiddenLayers, item, at);
  /** The base an icon placed or dragged to `at` lands on, unless it goes free (Alt, Snap off). */
  const dropAt = (
    item: Pick<PlanIcon, 'kind'> & Partial<Pick<PlanIcon, 'id'>>,
    at: Point,
    alt: boolean,
  ) => planDropTarget(editing, hiddenLayers, item, at, { attach, alt });
  const shown =
    wallPreview === null
      ? moved
      : {
          ...moved,
          walls: wallPreview.walls ? replaceIn(moved.walls, wallPreview.walls) : moved.walls,
          openings: wallPreview.openings
            ? replaceIn(moved.openings, wallPreview.openings)
            : moved.openings,
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
  // Picking items lets go of the wall; a wall that goes is no longer picked.
  useEffect(() => {
    if (selection.length) setWallSelState(null);
  }, [selection]);
  useEffect(() => {
    if (wallSel && !(drawn[wallSel.kind] ?? []).some((w) => w.id === wallSel.id))
      setWallSelState(null);
  }, [wallSel, drawn]);
  // Another tool ends the movement being drawn.
  useEffect(() => {
    if (tool !== 'move') setMoving(null);
  }, [tool]);

  const select = (ref: PlanItemRef | null) => setSelection(ref ? withGroups(drawn, [ref]) : []);
  const selectWall = (ref: WallRef | null) => {
    setSelection([]);
    setLockedItem(null);
    setLockedWall(false);
    setWallSelState(ref);
  };
  /** One change, one undo step. */
  const change = (write: () => void) => {
    store.undo.stopCapturing();
    write();
    store.undo.stopCapturing();
  };
  /** Writes items where they live, as the locks and attachments allow (no undo step). */
  const writeItems = (written: readonly PlanItem[], baseline?: readonly PlanItem[]) =>
    writePlanItems(doc, editing, written, LOCAL, baseline);
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

  // Walls and openings (decision 0110): on the Set layer, the base's for a setup. -----------
  const setOwner = targetFor('set');
  /** View units per metre for walls: the plan's scale, or the nominal one until it has one. */
  const wallScale = drawn.scale ?? NOMINAL_SCALE;
  const setLocked = locked.has('set');
  /**
   * A plan drawn in metres before it has a scale gets the nominal one with its first wall, in the
   * same change: what the walls tool showed in metres stays true (decision 0110).
   */
  const ensureScale = () => ensurePlanScale(doc, editing, LOCAL);
  /** Walls or openings written, as the locks allow (decision 0114): nothing else is sent. */
  const writeWalls = (key: WallRef['kind'], items: ReadonlyArray<PlanWall | PlanOpening>) => {
    const allowed = allowedWrites(drawn[key] ?? [], items);
    if (allowed.length) change(() => updatePlanWalls(doc, setOwner, key, allowed, LOCAL));
  };
  /** Removes walls and openings; those locked on their own stay, and stay picked. */
  const removeWalls = (ids: readonly string[]) => {
    let doomed: string[] = [];
    change(() => {
      doomed = removeUnlockedWalls(doc, editing, ids, LOCAL);
    });
    if (wallSel && doomed.includes(wallSel.id)) setWallSelState(null);
  };
  /** Locks or unlocks a wall or an opening on its own (decision 0114). */
  const toggleWallLock = (ref: WallRef) => {
    const target = (drawn[ref.kind] ?? []).find((w) => w.id === ref.id);
    if (target)
      writeWalls(ref.kind, [{ ...target, locked: itemLocked(target) ? undefined : true }]);
  };

  const remove = (all = selection.map((r) => r.id)) => {
    if (wallSel && all.length === 0) {
      removeWalls([wallSel.id]);
      return;
    }
    // Items locked on their own stay, and stay picked (decision 0114).
    let ids: string[] = [];
    change(() => {
      ids = removeUnlockedItems(doc, editing, all, LOCAL);
    });
    if (ids.length) setSelection((s) => s.filter((r) => !ids.includes(r.id)));
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
    if (items.length) write(lockWrites(items));
  };
  const rotate = (degrees: number) => {
    const items = chosen();
    if (items.length) write(rotateWrites(editing, items, degrees));
  };
  const nudge = (d: Point) => {
    const items = chosen();
    if (items.length) write(nudgeWrites(editing, items, d));
  };
  /** The colours paint what is selected; with nothing selected, the next strokes and icons. */
  const pickColor = (hex: string) => {
    const items = chosen();
    if (items.length) write(items.map((i) => ({ ...i, color: hex })));
    else setPenColor(hex);
  };
  /** Bring forward (+1) and Send back (-1): the stacking tier of the selected icons. */
  const restack = (by: 1 | -1) => {
    const items = restackWrites(chosen(), by);
    if (items.length) write(items);
  };
  /**
   * Moves the selected items of this plan to a layer. On a setup, Set is the base's, shared by
   * every setup (decisions 0062, 0104): what goes there moves into the base, in one undo step,
   * so a setup never keeps items of its own on Set.
   */
  const moveToLayer = (layer: PlanLayer) =>
    change(() => moveToPlanLayer(doc, editing, chosen(), layer, LOCAL));
  const toggleHidden = (layer: PlanGroupName) => {
    const to = hiddenToggle(plan, hiddenLayers, layer);
    if (to.for === 'plan') editPlan(to.patch);
    else
      setHiddenPref((now) =>
        now.includes(layer) ? now.filter((g) => g !== layer) : [...now, layer],
      );
  };
  const toggleLocked = (layer: PlanLayer) => editPlan(lockedLayersToggle(plan, layer));

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
    if (planIconsFull(editing)) return null;
    let id: string | null = null;
    change(() => {
      id = placePlanIcon(
        doc,
        editing,
        kind,
        p,
        {
          layer: activeLayer,
          color: (k) => penColor ?? iconColor(k),
          fields: opts.fields,
          on: opts.on,
          modifiers: opts.modifiers,
        },
        LOCAL,
      );
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
    wallSel,
    selectWall,
    lockedWall,
    setLockedWall,
    wallPreview,
    setWallPreview,
    openingKind,
    setOpeningKind,
    placingBackground,
    setPlacingBackground,
    setOwner,
    wallScale,
    setLocked,
    ensureScale,
    writeWalls,
    removeWalls,
    toggleWallLock,
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
    hiddenItem,
    setHiddenItem,
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
    snapAt,
    dropAt,
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
