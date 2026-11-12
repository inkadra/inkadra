// SPDX-License-Identifier: AGPL-3.0-only
import {
  type FrameElement,
  frameLabels,
  type SceneElement,
  type SceneGroup,
  storyboardOf,
} from '@inkadra/canvas-core';
import { type AspectRatio, type Element, getBoardAspect } from '@inkadra/doc-schema';
import { type Board, blockTarget, type ScheduleBlock, targetKey } from '@inkadra/shared';
import { type GlyphColor, glyphColor } from '@inkadra/ui';
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { treeOrder } from '../boards.ts';
import type { BoardConnection } from '../connection.ts';
import type { BoardStore, Snapshot } from '../store.ts';

/** The identity palette in the order storyboards take it (decision 0123). */
const DOTS: readonly GlyphColor[] = [
  'blue',
  'orange',
  'purple',
  'green',
  'teal',
  'yellow',
  'red',
  'pink',
];
/** The grey dot of a block whose storyboard cannot be read. */
export const UNAVAILABLE_DOT = glyphColor.neutral;

/**
 * The dot of each storyboard (decision 0123): its icon's colour when it has one, else a colour
 * of the identity palette in order of creation among the project's storyboards.
 * shortcut: the web lists live boards only, so a storyboard in the trash no longer counts and
 * later ones can change colour; count trashed ones when the board list carries them.
 */
export function storyboardDots(boards: readonly Board[]): Map<string, string> {
  const ordered = boards
    .filter((b) => b.kind !== 'production' && b.parentBoardId !== null)
    .sort(
      (a, b) =>
        Number(b.kind === 'storyboard') - Number(a.kind === 'storyboard') ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  return new Map(
    ordered.map((b, i) => [
      b.id,
      glyphColor[(b.icon?.color as GlyphColor | undefined) ?? DOTS[i % DOTS.length] ?? 'blue'] ??
        glyphColor.neutral,
    ]),
  );
}

/** A board whose frames and scenes a schedule reads. */
export interface ScheduleSource {
  boardId: string;
  title: string;
  /** Its dot, a CSS colour. */
  dot: string;
  store: BoardStore;
  /** The person may only read it: its needed items are not ticked from the schedule. */
  readOnly: boolean;
}

/** A scene of one source, with its frames. */
export type SourceGroup = SceneGroup & { boardId: string };

/**
 * The frames and scenes a schedule reads (decision 0123): a storyboard's own, or on the
 * Production board those of every storyboard the person can read. Elements are merged into one
 * map by id; blocks are matched by board and id (`look`).
 */
export interface ScheduleSources {
  /** The board that holds the days. */
  dayBoardId: string;
  /** The Production board: several storyboards, each with its dot. */
  across: boolean;
  /** The boards read, in tree order. */
  list: ScheduleSource[];
  byId: ReadonlyMap<string, Element>;
  groups: SourceGroup[];
  frames: FrameElement[];
  /** Frame labels ("12A"), by element id. */
  labels: ReadonlyMap<string, string>;
  /** The board each element is read from. */
  boardOf: ReadonlyMap<string, string>;
  /** A storyboard is still opening: its blocks wait before they say "not available". */
  loading: boolean;
}

/** What a block shows of the frame or scene it plans, read from its own board. */
export interface BlockLook {
  /** The frame's label, or the scene's number. */
  label: string;
  frame?: FrameElement | undefined;
  scene?: SceneElement | undefined;
  /** Its board, or none when it cannot be read: the stored label shows, with a grey dot. */
  source?: ScheduleSource | undefined;
  /** It names a frame or scene of a board that can be read, but that is gone. */
  missing: boolean;
  /** Read from another board's document than the day's: on the Production board. */
  dot?: { color: string; name: string } | undefined;
  aspect: AspectRatio;
}

const DEFAULT_ASPECT: AspectRatio = '16:9';

/** What a block plans, as `sources` read it; null for a block that plans no frame or scene. */
export function lookOf(
  block: Pick<
    ScheduleBlock,
    'type' | 'shotId' | 'shotBoardId' | 'shotLabel' | 'sceneId' | 'sceneBoardId' | 'sceneLabel'
  >,
  sources: ScheduleSources,
  unavailable: string,
): BlockLook | null {
  const target = blockTarget(block, sources.dayBoardId);
  if (!target) return null;
  const source = sources.list.find((s) => s.boardId === target.boardId);
  const el =
    source && sources.boardOf.get(target.id) === target.boardId
      ? sources.byId.get(target.id)
      : undefined;
  const stored = (target.kind === 'shot' ? block.shotLabel : block.sceneLabel) ?? '';
  const frame = el?.type === 'frame' ? el : undefined;
  const parent = frame?.parent ? sources.byId.get(frame.parent) : undefined;
  const scene = el?.type === 'scene' ? el : parent?.type === 'scene' ? parent : undefined;
  const label =
    target.kind === 'shot'
      ? (frame && sources.labels.get(frame.id)) || stored
      : scene?.number || stored;
  return {
    label,
    frame,
    scene,
    source,
    missing: !!source && !el,
    dot: sources.across
      ? source
        ? { color: source.dot, name: source.title }
        : { color: UNAVAILABLE_DOT, name: unavailable }
      : undefined,
    aspect: source ? (getBoardAspect(source.store.doc) ?? DEFAULT_ASPECT) : DEFAULT_ASPECT,
  };
}

/**
 * The labels a block keeps for readers who cannot open its storyboard, as they are now
 * (decision 0123): written whenever a day is saved with that storyboard read.
 */
export function withLabels<B extends ScheduleBlock>(block: B, sources: ScheduleSources): B {
  if (!sources.across) return block;
  const target = blockTarget(block, sources.dayBoardId);
  if (!target) return block;
  const look = lookOf(block, sources, '');
  if (!look?.source || look.missing || !look.label) return block;
  const label = look.label.slice(0, 40);
  return target.kind === 'shot'
    ? block.shotLabel === label
      ? block
      : { ...block, shotLabel: label }
    : block.sceneLabel === label
      ? block
      : { ...block, sceneLabel: label };
}

/**
 * The cards a day's call sheet reads (decision 0123): those of the storyboards its blocks plan,
 * the first in tree order winning on a shared id or name, as `byId` keeps them; a storyboard's
 * own cards on a storyboard.
 */
export function dayElements(
  day: { blocks: ReadonlyArray<Parameters<typeof blockTarget>[0]> },
  sources: Pick<ScheduleSources, 'across' | 'byId' | 'boardOf' | 'dayBoardId'>,
): ReadonlyMap<string, Element> {
  if (!sources.across) return sources.byId;
  const boards = new Set(
    day.blocks.flatMap((b) => blockTarget(b, sources.dayBoardId)?.boardId ?? []),
  );
  return new Map([...sources.byId].filter(([id]) => boards.has(sources.boardOf.get(id) ?? '')));
}

/** One key per frame or scene that blocks plan, by board: frames scheduled leave the queue. */
export function plannedKeys(
  blocks: Iterable<
    Pick<ScheduleBlock, 'type' | 'shotId' | 'shotBoardId' | 'sceneId' | 'sceneBoardId'>
  >,
  dayBoardId: string,
): Set<string> {
  const keys = new Set<string>();
  for (const block of blocks) {
    const target = blockTarget(block, dayBoardId);
    if (target) keys.add(`${target.kind}:${targetKey(target.boardId, target.id)}`);
  }
  return keys;
}

// The connections load with the Production board only: a storyboard's schedule opens none.
const SourceDoc = lazy(() => import('./schedule-doc.tsx'));

/** Follows every store and returns their snapshots: the same list until one of them changes. */
function useSnapshots(stores: readonly BoardStore[]): readonly Snapshot[] {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const stops = stores.map((store) => store.subscribe(bump));
    return () => {
      for (const stop of stops) stop();
    };
  }, [stores]);
  const last = useRef<readonly Snapshot[]>([]);
  const now = stores.map((store) => store.getSnapshot());
  if (now.length !== last.current.length || now.some((snap, i) => snap !== last.current[i]))
    last.current = now;
  return last.current;
}

/**
 * The sources of a schedule. A storyboard reads its own document. The Production board opens
 * the documents of the project's storyboards the person can read and of any board a block points
 * to, through the board connection, each with the person's own role (decision 0123).
 * shortcut: every readable storyboard opens at once; open them on demand when a project has more
 * than about ten.
 * `docs` must be rendered: it holds the connections.
 */
export function useScheduleSources({
  store,
  boardId,
  boards,
  across,
  referenced,
}: {
  store: BoardStore;
  boardId: string;
  /** The project's boards the person can read; null while they load. */
  boards: readonly Board[] | null;
  across: boolean;
  /** Boards the days' blocks point to. */
  referenced: readonly string[];
}): { sources: ScheduleSources; docs: ReactNode } {
  const ids = useMemo(() => {
    if (!across || !boards) return [] as string[];
    const live = new Set(boards.map((b) => b.id));
    return treeOrder(boards)
      .filter(
        (b) =>
          b.kind !== 'production' &&
          (b.kind === 'storyboard' || (referenced.includes(b.id) && live.has(b.id))),
      )
      .map((b) => b.id);
  }, [across, boards, referenced]);
  const [conns, setConns] = useState<ReadonlyMap<string, BoardConnection>>(new Map());
  const onConn = useMemo(
    () => (id: string, conn: BoardConnection | null) =>
      setConns((current) => {
        if ((current.get(id) ?? null) === conn) return current;
        const next = new Map(current);
        if (conn) next.set(id, conn);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const open = useMemo(() => {
    if (!across) return [{ boardId, store, readOnly: false }];
    return ids.flatMap((id) => {
      const conn = conns.get(id);
      // Refused: its blocks show their stored labels, as for a storyboard in the trash.
      if (!conn || conn.status === 'denied' || conn.status === 'signedOut') return [];
      return [{ boardId: id, store: conn.store, readOnly: conn.readOnly }];
    });
  }, [across, ids, conns, boardId, store]);
  const stores = useMemo(() => open.map((o) => o.store), [open]);
  const snapshots = useSnapshots(stores);
  const dots = useMemo(() => storyboardDots(boards ?? []), [boards]);
  const sources = useMemo((): ScheduleSources => {
    const byId = new Map<string, Element>();
    const boardOf = new Map<string, string>();
    const labels = new Map<string, string>();
    const groups: SourceGroup[] = [];
    const list: ScheduleSource[] = [];
    open.forEach((o, i) => {
      const snap = snapshots[i];
      if (!snap) return;
      // shortcut: element ids are fresh UUIDs, so one map holds every storyboard of a project;
      // the first in tree order wins on a shared id (an id copied by hand), as cards do on a name.
      for (const [id, el] of snap.byId)
        if (!byId.has(id)) {
          byId.set(id, el);
          boardOf.set(id, o.boardId);
        }
      const all = storyboardOf([...snap.byId.values()]);
      for (const [id, label] of frameLabels(all)) if (!labels.has(id)) labels.set(id, label);
      for (const g of all) groups.push({ ...g, boardId: o.boardId });
      list.push({
        ...o,
        title: boards?.find((b) => b.id === o.boardId)?.title ?? '',
        dot: dots.get(o.boardId) ?? glyphColor.neutral,
      });
    });
    return {
      dayBoardId: boardId,
      across,
      list,
      byId,
      groups,
      frames: groups.flatMap((g) => g.frames),
      labels,
      boardOf,
      loading:
        across &&
        (!boards || ids.some((id) => !conns.has(id) || conns.get(id)?.status === 'connecting')),
    };
  }, [open, snapshots, boards, dots, boardId, across, ids, conns]);
  const docs = across ? ids.map((id) => <SourceDoc key={id} boardId={id} onConn={onConn} />) : null;
  return { sources, docs };
}

/**
 * The dot of a storyboard, named by it (decision 0123); `decorative` beside its name, which then
 * says it once.
 */
export function SourceDot({
  color,
  name,
  decorative = false,
}: {
  color: string;
  name: string;
  decorative?: boolean;
}) {
  return (
    <span
      className="schedule__dot"
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': name, 'data-ink-tooltip': name })}
      style={{ ['--dot' as string]: color }}
    />
  );
}
