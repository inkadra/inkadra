import {
  canvasElements,
  childrenOf,
  estimateHeight,
  growsWithText,
  isContainer,
  setElementView,
} from '@inkadra/canvas-core';
import {
  type Element,
  encodeValidatedSnapshot,
  openValidatedSnapshot,
  openValidatedSnapshotSteps,
  readElement,
  readElementSteps,
  roots,
  UNSORTED,
  type ValidatedSnapshot,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';

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

/** Options of `new BoardStore` and `BoardStore.hydrate`. */
export interface OpenOptions {
  /**
   * A validated snapshot this same build exported for the same board (`exportValidatedSnapshot`,
   * decision 0106) and the build identity it was exported with: cards made of the same items
   * skip validation; everything else is read as usual, and a snapshot of another build, schema or
   * board, or a malformed one, is ignored as a whole.
   */
  snapshot?: { text: string; build: string } | null;
}

/** Options of `BoardStore.hydrate` (decision 0105). */
export interface HydrateOptions extends OpenOptions {
  /** Work per slice, in milliseconds (default 8). */
  budgetMs?: number;
  /**
   * How hydration gives the thread back: called when a slice starts, and the next slice starts
   * once its promise has resolved and this slice's budget is spent. Default: a zero timeout. A
   * React Native host can pass `setImmediate`, a MessageChannel or a frame-aware scheduler. A
   * rejection ends hydration with that error (`hydrationError`); a promise that never resolves
   * stops it until `destroy()`. One that is already resolved never gives the thread back.
   */
  schedule?: () => Promise<void>;
  /**
   * Cards to read first, e.g. those in view: their keys, or a test on each stored card. The
   * columns and scenes holding them (by their stored `parent`) are read with them, so that they
   * can be drawn where they are.
   */
  priority?: Iterable<string> | ((key: string, map: Y.Map<unknown>) => boolean);
  /**
   * Opt-in: once every priority card (and its containers) is read, publish a snapshot of only
   * those cards, each its current, validated read, read again at once when it changes, until the
   * complete snapshot replaces it. A container shows only the priority cards inside it.
   * `hydrating` stays true until then; if hydration fails, the view is withdrawn (empty).
   */
  progressive?: boolean;
}

const timeout = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
  /** Keys of elements changed while hydrating: their validated reads are taken again. */
  private stale = new Set<string>();
  /**
   * While hydrating: the validated reads by key, the priority cards with their containers, those
   * of them not read and current yet, and whether they are shown (progressive snapshot).
   */
  private hydration: {
    done: Map<string, Element | null>;
    first: ReadonlySet<string>;
    firstLeft: Set<string>;
    shown: boolean;
  } | null = null;
  /** Resolves on destroy, so hydration stops even while a scheduler never resolves. */
  private stopped: Promise<void> = Promise.resolve();
  private stop = () => {};
  /** Resolves when the complete initial snapshot is available (or the store is destroyed). */
  readonly whenHydrated: Promise<void>;
  /**
   * Why hydration stopped: the snapshot stays (or becomes) empty and `whenHydrated` rejects
   * with it.
   */
  hydrationError: unknown;

  get hydrating() {
    return this.loading;
  }

  /** Opt-in cooperative initialization. The regular constructor remains synchronous. */
  static hydrate(doc: Y.Doc, options: HydrateOptions = {}): BoardStore {
    return new BoardStore(doc, { ...options, budgetMs: options.budgetMs ?? 8 });
  }

  /** Synchronous unless `budgetMs` is given (use `BoardStore.hydrate`). */
  constructor(
    readonly doc: Y.Doc,
    options?: HydrateOptions,
  ) {
    const budgetMs = options?.budgetMs;
    if (budgetMs !== undefined && (!Number.isFinite(budgetMs) || budgetMs <= 0))
      throw new RangeError('budgetMs must be positive and finite');
    const { elements } = roots(doc);
    this.undo = new Y.UndoManager(elements, {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 400,
    });
    this.loading = budgetMs !== undefined;
    if (!this.loading) this.rebuild(options?.snapshot);
    else this.stopped = new Promise((resolve) => (this.stop = resolve));
    elements.observeDeep(this.onChange);
    // Yjs calls the observers, this one included, before afterTransaction.
    doc.on('beforeTransaction', this.begin);
    doc.on('afterTransaction', this.end);
    this.open = doc._transaction ? 1 : 0;
    this.removeView = setElementView(doc, () =>
      !this.loading && this.open === 0 && this.exact ? [...this.snapshot.byId.values()] : null,
    );
    this.whenHydrated = this.loading
      ? this.hydrate({ ...options, budgetMs: budgetMs! }).catch((error: unknown) => {
          this.hydrationError = error;
          // A progressive view is withdrawn: nothing stays shown that hydration no longer keeps.
          const shown = this.hydration?.shown;
          this.hydration = null;
          if (shown && !this.destroyed) {
            this.snapshot = EMPTY;
            for (const listener of this.listeners) listener();
          }
          throw error;
        })
      : Promise.resolve();
  }

  destroy() {
    this.destroyed = true;
    this.loading = false;
    this.hydration = null;
    this.stop();
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
    // Hydration reads these elements again; the cards of a progressive snapshot at once.
    if (this.loading) {
      const hydration = this.hydration;
      let refreshed = false;
      for (const id of touched) {
        if (hydration?.shown && hydration.first.has(id)) {
          const map = elements.get(id);
          hydration.done.set(id, map ? readElement(map) : null);
          refreshed = true;
          continue;
        }
        this.stale.add(id);
        if (hydration?.first.has(id)) hydration.firstLeft.add(id);
      }
      if (refreshed) this.publishPartial();
      return;
    }
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

  private rebuild(saved?: OpenOptions['snapshot']) {
    const snapshot = saved ? openValidatedSnapshot(this.doc, saved.text, saved) : null;
    const byId = new Map<string, Element>();
    for (const [key, map] of roots(this.doc).elements.entries()) {
      const hit = snapshot?.take(key, map);
      const el = hit !== undefined ? hit : readElement(map);
      if (!el) continue;
      if (el.id !== key) this.exact = false;
      byId.set(el.id, el);
    }
    this.index(byId);
  }

  private async hydrate(options: HydrateOptions & { budgetMs: number }) {
    const { budgetMs, priority, progressive = false } = options;
    const schedule = options.schedule ?? timeout;
    /** The next turn, queued at the start of a slice; never an unhandled rejection. */
    const queue = () => {
      const pause = schedule();
      pause.catch(() => {});
      return pause;
    };
    // Also separates applyUpdate from the initial read when called in the same JS task.
    await Promise.race([queue(), this.stopped]);
    if (this.destroyed) return;
    const { elements } = roots(this.doc);
    let start = performance.now();
    // Queue the next turn before doing work, so the scheduler's delay overlaps this slice.
    let nextPause = queue();
    const due = () => performance.now() - start >= budgetMs;
    const yieldNow = async () => {
      await Promise.race([nextPause, this.stopped]);
      nextPause = queue();
      start = performance.now();
    };
    let snapshot: ValidatedSnapshot | null = null;
    if (options.snapshot) {
      const steps = openValidatedSnapshotSteps(this.doc, options.snapshot.text, options.snapshot);
      let step = steps.next();
      while (!step.done) {
        if (due()) await yieldNow();
        if (this.destroyed) return;
        step = steps.next();
      }
      snapshot = step.value;
    }
    /** Validated reads by key, each current: a change since then puts its key in stale. */
    const done = new Map<string, Element | null>();
    /** Changed in the middle of their own read: read in one go next time, so typing ends. */
    const interrupted = new Set<string>();
    /** Read first, in this order; with `progressive`, published once all are read. */
    const first = new Set<string>();
    if (typeof priority === 'function') {
      for (const [key, map] of elements.entries()) {
        if (due()) await yieldNow();
        if (this.destroyed) return;
        if (priority(key, map)) first.add(key);
      }
    } else if (priority) for (const key of priority) if (elements.has(key)) first.add(key);
    // A card in a column or a scene is drawn inside it: its containers come with it.
    for (const key of [...first]) {
      let parent = elements.get(key)?.get('parent');
      while (typeof parent === 'string' && elements.has(parent) && !first.has(parent)) {
        first.add(parent);
        parent = elements.get(parent)?.get('parent');
      }
    }
    const hydration = { done, first, firstLeft: new Set(first), shown: false };
    this.hydration = hydration;
    const show = progressive && first.size > 0;
    for (;;) {
      for (const key of this.stale) done.delete(key);
      this.stale.clear();
      const todo: string[] = [];
      for (const key of first) if (!done.has(key)) todo.push(key);
      for (const key of elements.keys()) if (!done.has(key) && !first.has(key)) todo.push(key);
      // Every element is read and current, in this same task: publish.
      if (todo.length === 0) break;
      for (const key of todo) {
        if (due()) await yieldNow();
        if (this.destroyed) return;
        const map = elements.get(key);
        if (done.has(key)) continue;
        if (!map) {
          hydration.firstLeft.delete(key);
          continue;
        }
        // From here the read sees the current element; a change during a pause aborts it.
        this.stale.delete(key);
        const hit = snapshot?.take(key, map);
        if (hit !== undefined) done.set(key, hit);
        else if (interrupted.has(key)) done.set(key, readElement(map));
        else {
          const steps = readElementSteps(map);
          let step = steps.next();
          while (!step.done) {
            if (due()) await yieldNow();
            if (this.destroyed) return;
            if (this.stale.has(key)) break;
            step = steps.next();
          }
          if (!step.done) {
            interrupted.add(key);
            continue;
          }
          done.set(key, step.value);
        }
        hydration.firstLeft.delete(key);
        if (show && !hydration.shown && hydration.firstLeft.size === 0) {
          hydration.shown = true;
          this.publishPartial();
        }
      }
    }
    this.hydration = null;
    // Document order, as the synchronous read (a duplicated id keeps the last element).
    const byId = new Map<string, Element>();
    let exact = true;
    for (const key of elements.keys()) {
      const el = done.get(key);
      if (!el) continue;
      byId.set(el.id, el);
      if (el.id !== key) exact = false;
    }
    this.exact = exact;
    this.snapshot = EMPTY;
    this.index(byId);
    this.loading = false;
    for (const listener of this.listeners) listener();
  }

  /** The progressive snapshot: the current, validated reads of the priority cards only. */
  private publishPartial() {
    const hydration = this.hydration;
    if (!hydration?.shown) return;
    const byId = new Map<string, Element>();
    let exact = true;
    for (const key of roots(this.doc).elements.keys()) {
      if (!hydration.first.has(key)) continue;
      const el = hydration.done.get(key);
      if (!el) continue;
      byId.set(el.id, el);
      if (el.id !== key) exact = false;
    }
    this.exact = exact;
    this.snapshot = EMPTY;
    this.index(byId);
    for (const listener of this.listeners) listener();
  }

  /**
   * A validated snapshot of the current view, for a later open of the same board by the same
   * build (decision 0106): `build` is the host's build identity, the same it will pass to open it.
   * Null while hydrating, inside a transaction or when a card's key and id differ. It runs in one
   * block (about 0.18 s on the medium reference board without a JIT): call it when idle.
   */
  exportValidatedSnapshot(build: string): string | null {
    if (this.loading || this.destroyed || this.open > 0 || !this.exact) return null;
    const { byId } = this.snapshot;
    const keys = [...roots(this.doc).elements.keys()];
    return encodeValidatedSnapshot(
      this.doc,
      keys.map((key) => [key, byId.get(key) ?? null]),
      { build },
    );
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
