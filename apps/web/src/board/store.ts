import {
  canvasElements,
  childrenOf,
  growsWithText,
  isContainer,
  setElementView,
} from '@inkadra/canvas-core';
import {
  type Element,
  PLAN_ASPECT,
  readElement,
  readElementSteps,
  roots,
  UNSORTED,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { croppedRotatedSize } from './image-crop.ts';

/** Transaction origin of edits made in this tab: the undo history tracks only these. */
export const LOCAL = Symbol('local');

export interface Snapshot {
  byId: ReadonlyMap<string, Element>;
  /** Elements on the canvas, in drawing order. */
  canvas: readonly Element[];
  /** Children of each column and scene, top to bottom. */
  columns: ReadonlyMap<string, readonly Element[]>;
  unsorted: readonly Element[];
}

const EMPTY: Snapshot = { byId: new Map(), canvas: [], columns: new Map(), unsorted: [] };

/**
 * Plain view of a board document for React. Rebuilt after each Yjs transaction; element
 * objects keep their identity when they did not change, so memoised cards skip rendering.
 */
export class BoardStore {
  readonly undo: Y.UndoManager;
  private snapshot: Snapshot = EMPTY;
  private listeners = new Set<() => void>();
  private sizeListeners = new Set<() => void>();
  /** Rendered heights of elements whose height follows their content. */
  private heights = new Map<string, number>();
  private sizeVersion = 0;
  /** Elements that just appeared, with the time: their cards pop in once (takeAdded). */
  private added = new Map<string, number>();
  /** Transactions begun and not yet observed: while any is open the snapshot may be behind. */
  private open = 0;
  /** False once an element's key and id differ: the snapshot then keeps one of the two. */
  private exact = true;
  private removeView: () => void;
  private loading = false;
  private destroyed = false;
  private revision = 0;
  /** Resolves when the complete initial snapshot is available (or the store is destroyed). */
  readonly whenHydrated: Promise<void>;

  get hydrating() {
    return this.loading;
  }

  /** Opt-in cooperative initialization. The regular constructor remains synchronous. */
  static hydrate(doc: Y.Doc, { budgetMs = 8 }: { budgetMs?: number } = {}): BoardStore {
    return new BoardStore(doc, { budgetMs });
  }

  constructor(
    readonly doc: Y.Doc,
    options?: { budgetMs: number },
  ) {
    if (options && (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0))
      throw new RangeError('budgetMs must be positive and finite');
    const { elements } = roots(doc);
    this.undo = new Y.UndoManager(elements, {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 400,
    });
    this.loading = options !== undefined;
    if (!this.loading) this.rebuild();
    elements.observeDeep(this.onChange);
    // Yjs calls the observers, this one included, before afterTransaction.
    doc.on('beforeTransaction', this.begin);
    doc.on('afterTransaction', this.end);
    this.open = doc._transaction ? 1 : 0;
    this.removeView = setElementView(doc, () =>
      !this.loading && this.open === 0 && this.exact ? [...this.snapshot.byId.values()] : null,
    );
    this.whenHydrated = options ? this.hydrate(options.budgetMs) : Promise.resolve();
  }

  destroy() {
    this.destroyed = true;
    this.loading = false;
    roots(this.doc).elements.unobserveDeep(this.onChange);
    this.doc.off('beforeTransaction', this.begin);
    this.doc.off('afterTransaction', this.end);
    this.removeView();
    this.undo.destroy();
  }

  private begin = () => {
    this.open += 1;
  };

  private end = () => {
    this.open = Math.max(0, this.open - 1);
  };

  private onChange = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    this.revision++;
    // No partial snapshot is published. A concurrent edit restarts the cooperative read.
    if (this.loading) return;
    const { elements } = roots(this.doc);
    const touched = new Set<string>();
    for (const event of events) {
      if (event.target === elements) {
        for (const key of event.changes.keys.keys()) touched.add(key);
        continue;
      }
      const [id, field] = event.path;
      // Rich text changes inside a note do not change the plain view.
      if (typeof id === 'string' && field !== 'body') touched.add(id);
    }
    if (touched.size === 0) return;
    const byId = new Map(this.snapshot.byId);
    let changed = false;
    const added: string[] = [];
    for (const id of touched) {
      const map = elements.get(id);
      const next = map ? readElement(map) : null;
      const old = byId.get(id);
      if (next && next.id !== id) this.exact = false;
      if (!next) {
        changed = byId.delete(id) || changed;
      } else if (!old || !sameElement(old, next)) {
        if (!old) added.push(id);
        byId.set(id, next);
        changed = true;
      }
    }
    if (!changed) return;
    // Not the first load of a board, nor a large sync after being offline: those just appear.
    const local = events[0]?.transaction.local ?? false;
    if (added.length > 0 && added.length <= 50 && (local || this.snapshot.byId.size > 0)) {
      const now = performance.now();
      for (const [id, at] of this.added) if (now - at > 1000) this.added.delete(id);
      for (const id of added) this.added.set(id, now);
    }
    this.index(byId, touched);
    for (const l of this.listeners) l();
  };

  private rebuild() {
    const byId = new Map<string, Element>();
    for (const [key, map] of roots(this.doc).elements.entries()) {
      const el = readElement(map);
      if (!el) continue;
      if (el.id !== key) this.exact = false;
      byId.set(el.id, el);
    }
    this.index(byId);
  }

  private async hydrate(budgetMs: number) {
    const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    // Also separates applyUpdate from the initial read when called in the same JS task.
    await pause();
    while (!this.destroyed) {
      const revision = this.revision;
      const byId = new Map<string, Element>();
      let exact = true;
      let start = performance.now();
      // Queue the next turn before doing work, so the timer delay overlaps this slice.
      let nextPause = pause();
      for (const [key, map] of roots(this.doc).elements.entries()) {
        const steps = readElementSteps(map);
        let step = steps.next();
        while (!step.done) {
          if (performance.now() - start >= budgetMs) {
            await nextPause;
            if (this.destroyed || this.revision !== revision) break;
            nextPause = pause();
            start = performance.now();
          }
          step = steps.next();
        }
        if (this.destroyed || this.revision !== revision) break;
        const el = step.value;
        if (el) {
          byId.set(el.id, el);
          if (el.id !== key) exact = false;
        }
      }
      if (this.destroyed) return;
      if (this.revision !== revision) continue;
      this.exact = exact;
      this.index(byId);
      this.loading = false;
      for (const listener of this.listeners) listener();
      return;
    }
  }

  private index(byId: Map<string, Element>, touched?: ReadonlySet<string>) {
    // A mismatched key can leave multiple entries with the same element id. Preserve the
    // full-rebuild semantics for these malformed documents (also excluded from the view).
    if (!this.exact) {
      const all = [...byId.values()];
      this.snapshot = {
        byId,
        canvas: canvasElements(all),
        columns: new Map(all.filter(isContainer).map((el) => [el.id, childrenOf(all, el.id)])),
        unsorted: childrenOf(all, UNSORTED),
      };
      return;
    }
    const previous = this.snapshot;
    const columns = new Map(previous.columns);
    const dirty = new Set<string | null>();
    const reordered = new Set<string | null>();
    for (const id of touched ?? byId.keys()) {
      const old = previous.byId.get(id);
      const next = byId.get(id);
      if (old === next) continue;
      if (old) dirty.add(old.parent);
      if (next) dirty.add(next.parent);
      if (!old || !next || old.parent !== next.parent || old.z !== next.z || old.id !== next.id) {
        if (old) reordered.add(old.parent);
        if (next) reordered.add(next.parent);
      }
      if (old && isContainer(old) && (!next || !isContainer(next))) columns.delete(id);
      if (next && isContainer(next) && !columns.has(id)) {
        columns.set(id, []);
        dirty.add(id);
        reordered.add(id);
      }
    }
    // Group once, rather than scanning the entire board for every column on open.
    const groups = new Map<string | null, Element[]>();
    if (reordered.size) {
      for (const el of byId.values()) {
        if (!reordered.has(el.parent)) continue;
        const group = groups.get(el.parent);
        if (group) group.push(el);
        else groups.set(el.parent, [el]);
      }
    }
    let canvas = previous.canvas;
    let unsorted = previous.unsorted;
    for (const parent of dirty) {
      const before =
        parent === null ? canvas : parent === UNSORTED ? unsorted : columns.get(parent);
      if (!before) continue; // Children of a missing container are not in the public index.
      const next = reordered.has(parent)
        ? parent === null
          ? canvasElements(groups.get(parent) ?? [])
          : childrenOf(groups.get(parent) ?? [], parent)
        : before.map((el) => byId.get(el.id)!);
      if (parent === null) canvas = next;
      else if (parent === UNSORTED) unsorted = next;
      else columns.set(parent, next);
    }
    this.snapshot = {
      byId,
      canvas,
      columns,
      unsorted,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** True once for an element added in the last second, for its card to pop in. */
  takeAdded(id: string): boolean {
    const at = this.added.get(id);
    this.added.delete(id);
    return at !== undefined && performance.now() - at < 1000;
  }

  subscribeSizes = (listener: () => void) => {
    this.sizeListeners.add(listener);
    return () => this.sizeListeners.delete(listener);
  };

  getSizeVersion = () => this.sizeVersion;

  setHeight(id: string, height: number) {
    if (Math.abs((this.heights.get(id) ?? -1) - height) < 0.5) return;
    this.heights.set(id, height);
    this.sizeVersion += 1;
    for (const l of this.sizeListeners) l();
  }

  /** Height of an element on the canvas, measured or estimated. */
  heightOf(el: Element): number {
    // A character's height follows its content, whatever height an older document stored.
    if (
      el.type === 'link' ||
      el.type === 'column' ||
      el.type === 'scene' ||
      el.type === 'character'
    )
      return this.heights.get(el.id) ?? estimateHeight(el);
    if (growsWithText(el)) return Math.max(el.h ?? 0, this.contentHeightOf(el));
    return el.h ?? this.heights.get(el.id) ?? estimateHeight(el);
  }

  /** Height of an element as last drawn, whatever height it stores. */
  contentHeightOf(el: Element): number {
    return this.heights.get(el.id) ?? estimateHeight(el);
  }

  rectOf(el: Element) {
    return { x: el.x, y: el.y, w: el.w, h: this.heightOf(el) };
  }

  /** The Y.Map behind an element, for rich text and to-do items. */
  map(id: string): Y.Map<unknown> | undefined {
    return roots(this.doc).elements.get(id);
  }
}

function estimateHeight(el: Element): number {
  switch (el.type) {
    case 'image': {
      const dims = croppedRotatedSize(4, 3, el.crop, el.rotation);
      return Math.round((el.w * dims.height) / dims.width);
    }
    case 'column':
    case 'scene':
      return 120;
    case 'frame':
      return Math.round(el.w * 0.56) + 48;
    case 'color':
      return el.w;
    case 'board':
      return 66;
    case 'todo':
      return 48 + el.items.length * 26;
    case 'section':
      return 44;
    case 'table':
      return el.rows.length * 31 + 2;
    case 'plan':
      return Math.round(el.w / PLAN_ASPECT) + 34;
    case 'map':
      return el.imageAssetId ? Math.round((el.w * 560) / 1024) + 52 : 52;
    default:
      return 64;
  }
}

function sameElement(a: Element, b: Element): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (va === vb) continue;
    // Strokes and rows keep their objects while they do not change (readElement).
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (!sameItems(va, vb)) return false;
      continue;
    }
    if (typeof va === 'object' && JSON.stringify(va) === JSON.stringify(vb)) continue;
    return false;
  }
  return true;
}

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    // Preserve JSON equality (including null/undefined array entries), but serialize only
    // replaced items, never all unchanged strokes or rows after a single edit.
    if (JSON.stringify([a[i]]) !== JSON.stringify([b[i]])) return false;
  }
  return true;
}
