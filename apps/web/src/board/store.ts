import { canvasElements, childrenOf, listElements } from '@inkadra/canvas-core';
import { type Element, readElement, roots, UNSORTED } from '@inkadra/doc-schema';
import * as Y from 'yjs';

/** Transaction origin of edits made in this tab: the undo history tracks only these. */
export const LOCAL = Symbol('local');

export interface Snapshot {
  byId: ReadonlyMap<string, Element>;
  /** Elements on the canvas, in drawing order. */
  canvas: readonly Element[];
  /** Children of each column, top to bottom. */
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

  constructor(readonly doc: Y.Doc) {
    const { elements } = roots(doc);
    this.undo = new Y.UndoManager(elements, {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 400,
    });
    this.rebuild();
    elements.observeDeep(this.onChange);
  }

  destroy() {
    roots(this.doc).elements.unobserveDeep(this.onChange);
    this.undo.destroy();
  }

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
    const byId = new Map(this.snapshot.byId);
    let changed = false;
    for (const id of touched) {
      const map = elements.get(id);
      const next = map ? readElement(map) : null;
      const old = byId.get(id);
      if (!next) {
        changed = byId.delete(id) || changed;
      } else if (!old || !sameElement(old, next)) {
        byId.set(id, next);
        changed = true;
      }
    }
    if (!changed) return;
    this.index(byId);
    for (const l of this.listeners) l();
  };

  private rebuild() {
    const byId = new Map<string, Element>();
    for (const el of listElements(this.doc)) byId.set(el.id, el);
    this.index(byId);
  }

  private index(byId: Map<string, Element>) {
    const all = [...byId.values()];
    const columns = new Map<string, Element[]>();
    for (const el of all) {
      if (el.type === 'column') columns.set(el.id, childrenOf(all, el.id));
    }
    this.snapshot = {
      byId,
      canvas: canvasElements(all),
      columns,
      unsorted: childrenOf(all, UNSORTED),
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

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
    return el.h ?? this.heights.get(el.id) ?? estimateHeight(el);
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
    case 'image':
      return Math.round(el.w * 0.75);
    case 'column':
      return 120;
    case 'color':
      return el.w;
    case 'board':
      return 120;
    case 'todo':
      return 48 + el.items.length * 26;
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
    if (typeof va === 'object' && JSON.stringify(va) === JSON.stringify(vb)) continue;
    return false;
  }
  return true;
}
