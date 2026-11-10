// SPDX-License-Identifier: MPL-2.0
/**
 * Reference board for performance work (decision 0093): a board document grown through the
 * Yjs operations that real sessions make, one transaction per gesture, by hundreds of client
 * ids that edit concurrently and merge. A board written in one transaction is much smaller and
 * faster to load than one with a history, so it gives optimistic numbers.
 *
 * Dev and test tooling only: index.ts does not export it, so no app bundles it. Run it with
 * `pnpm --filter @inkadra/doc-schema reference-board` (docs/testing/reference-board.md).
 */
import * as Y from 'yjs';
import { addElement, initBoardDoc, roots, tableRowMap } from './doc.ts';
import type { Element, Stroke } from './elements.ts';

export type ReferenceBoardSize = 'small' | 'medium' | 'large';

interface SizeSpec {
  /** Elements on the finished board. */
  elements: number;
  /** Frames and set plans with a drawing, and the range of their stroke counts. */
  drawn: number;
  strokes: [number, number];
  /** Notes whose body holds task lists, mentions, pictures and ink marks. */
  richNotes: number;
  tableRows: number;
  /** Editing sessions, each with a client id of its own, and how many run at once. */
  sessions: number;
  replicas: number;
  /** Element-level edits besides the creations: moves and deletions. */
  moves: number;
  deletions: number;
}

export const REFERENCE_SIZES: Record<ReferenceBoardSize, SizeSpec> = {
  small: {
    elements: 200,
    drawn: 6,
    strokes: [60, 120],
    richNotes: 10,
    tableRows: 100,
    sessions: 60,
    replicas: 4,
    moves: 1500,
    deletions: 150,
  },
  medium: {
    elements: 1000,
    drawn: 30,
    strokes: [500, 1000],
    richNotes: 50,
    tableRows: 500,
    sessions: 400,
    replicas: 8,
    moves: 8000,
    deletions: 800,
  },
  large: {
    elements: 3000,
    drawn: 60,
    strokes: [500, 1000],
    richNotes: 150,
    tableRows: 500,
    sessions: 1000,
    replicas: 8,
    moves: 24000,
    deletions: 2400,
  },
};

/** Strokes of the first frame of the medium and large boards, the one benchmarks draw on. */
export const BENCH_FRAME_STROKES = 800;

export interface ReferenceBoardSummary {
  size: ReferenceBoardSize;
  seed: number;
  boardId: string;
  updateBytes: number;
  elements: { total: number; byType: Record<string, number> };
  drawn: { cards: number; strokes: number; minStrokes: number; maxStrokes: number };
  richNotes: number;
  table: { rows: number; columns: number };
  /** Ids the benchmarks edit: the frame with BENCH_FRAME_STROKES strokes (medium and large). */
  bench: { frameId: string; tableId: string };
  history: {
    /** Local transactions, one per gesture, by kind. */
    operations: number;
    byKind: Record<string, number>;
    sessions: number;
    clientIds: number;
  };
}

export interface ReferenceBoard {
  update: Uint8Array;
  summary: ReferenceBoardSummary;
}

const ID_ALPHABET = 'ModuleSymbhasOwnPr-0123456789ABCDEFGHNRVfgctiUvz_KqYTJkLxpZXIjQW';
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SYNC = Symbol('sync');

/** Builds the board. Same size and seed, same bytes. */
export function generateReferenceBoard(size: ReferenceBoardSize, seed = 1): ReferenceBoard {
  const spec = REFERENCE_SIZES[size];
  let state = seed >>> 0 || 1;
  // mulberry32: small, fast and good enough to pick operations.
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const id = () => {
    let out = '';
    for (let i = 0; i < 21; i++) out += ID_ALPHABET[Math.floor(random() * 64)];
    return out;
  };
  const uuid = () => {
    const hex = Array.from({ length: 32 }, () => DIGITS[Math.floor(random() * 16)])
      .join('')
      .toLowerCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
  };
  const color = () =>
    `#${Array.from({ length: 6 }, () => DIGITS[Math.floor(random() * 16)]).join('')}`;
  // Fractional-indexing integer keys ("a0" … "az", "b00" …): valid, increasing.
  let zCounter = 0;
  const nextZ = () => {
    const n = zCounter++;
    if (n < 62) return `a${DIGITS[n]}`;
    if (n < 62 * 62) return `b${DIGITS[Math.floor(n / 62)]}${DIGITS[n % 62]}`;
    return `c${DIGITS[Math.floor(n / 3844)]}${DIGITS[Math.floor(n / 62) % 62]}${DIGITS[n % 62]}`;
  };

  const boardId = uuid();
  const usedClients = new Set<number>();
  const clientId = () => {
    let c = 0;
    while (c === 0 || usedClients.has(c)) c = Math.floor(random() * 2 ** 32) >>> 0;
    usedClients.add(c);
    return c;
  };

  // Each replica is a device that stays open; every session on it gets a fresh client id,
  // as a reload of the web app does. Updates are exchanged when a round of sessions ends.
  const replicas: Y.Doc[] = [];
  const outbox: Uint8Array[] = [];
  for (let i = 0; i < spec.replicas; i++) {
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== SYNC) outbox.push(update);
    });
    replicas.push(doc);
  }
  const sync = () => {
    if (outbox.length === 0) return;
    const merged = Y.mergeUpdates(outbox.splice(0));
    for (const doc of replicas) Y.applyUpdate(doc, merged, SYNC);
  };

  const byKind: Record<string, number> = {};
  let sessions = 0;
  const count = (kind: string) => {
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  };
  const session = (doc: Y.Doc) => {
    doc.clientID = clientId();
    sessions++;
  };

  // What the generator plans; replicas may not have seen it yet.
  const drawn: Array<{ id: string; type: 'frame' | 'plan'; target: number }> = [];
  const richNotes: string[] = [];
  const tableId = id();
  const columnIds = Array.from({ length: 6 }, id);
  const heavy = new Set<string>([tableId]);
  for (let i = 0; i < spec.drawn; i++) {
    const target =
      i === 0 && spec.strokes[1] >= BENCH_FRAME_STROKES
        ? BENCH_FRAME_STROKES
        : int(spec.strokes[0], spec.strokes[1]);
    const entry = { id: id(), type: i % 3 === 2 ? ('plan' as const) : ('frame' as const), target };
    drawn.push(entry);
    heavy.add(entry.id);
  }
  for (let i = 0; i < spec.richNotes; i++) {
    const note = id();
    richNotes.push(note);
    heavy.add(note);
  }

  const base = (elementId: string, parent: string | null = null) => ({
    id: elementId,
    x: int(-20000, 20000),
    y: int(-20000, 20000),
    w: pick([180, 240, 260, 320, 420]),
    z: nextZ(),
    parent,
    createdBy: uuid(),
    createdAt: 1_700_000_000_000 + int(0, 30_000_000_000),
  });
  const strokeOf = (plan: boolean): Stroke => {
    const n = int(8, 60);
    const points: number[] = [];
    let x = int(0, 4096);
    let y = int(0, 4096);
    for (let i = 0; i < n; i++) {
      x = Math.max(0, Math.min(4096, x + int(-80, 80)));
      y = Math.max(0, Math.min(4096, y + int(-80, 80)));
      points.push(x, y);
    }
    const stroke: Stroke & { layer?: string } = {
      id: id(),
      tool: pick(['pencil', 'brush', 'marker'] as const),
      color: color(),
      width: int(1, 30),
      points,
    };
    if (random() < 0.3) stroke.opacity = Math.round((0.2 + random() * 0.8) * 100) / 100;
    if (plan && random() < 0.5) stroke.layer = pick(['set', 'lights', 'actors']);
    return stroke;
  };
  const paragraph = (text: string) => {
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(text)]);
    return p;
  };
  const words = ['luce', 'camera', 'carrello', 'controcampo', 'Anna', 'porta', 'esterno', 'notte'];
  const sentence = () => Array.from({ length: int(3, 12) }, () => pick(words)).join(' ');

  // Light cards: what people add, move around and delete most.
  const lightCard = (elementId: string, parent: string | null): Element => {
    const kind = pick([
      'note',
      'note',
      'frame',
      'image',
      'link',
      'color',
      'todo',
      'column',
      'section',
    ]);
    const b = base(elementId, kind === 'column' || kind === 'section' ? null : parent);
    switch (kind) {
      case 'frame':
        return { ...b, type: 'frame', action: sentence(), status: pick(['draft', 'ready']) };
      case 'image':
        return { ...b, type: 'image', assetId: uuid() };
      case 'link':
        return { ...b, type: 'link', url: `https://example.com/${elementId}`, title: sentence() };
      case 'color':
        return { ...b, type: 'color', hex: color() };
      case 'todo':
        return {
          ...b,
          type: 'todo',
          title: sentence().slice(0, 200),
          items: Array.from({ length: int(0, 5) }, () => ({
            id: id(),
            text: sentence(),
            done: random() < 0.4,
          })),
        };
      case 'column':
        return { ...b, type: 'column', title: sentence().slice(0, 200) };
      case 'section':
        return { ...b, type: 'section', title: sentence().slice(0, 200) };
      default:
        return { ...b, type: 'note' };
    }
  };

  const elementsOf = (doc: Y.Doc) => roots(doc).elements;
  const liveLight = (doc: Y.Doc) => [...elementsOf(doc).keys()].filter((k) => !heavy.has(k));
  const columnsIn = (doc: Y.Doc) =>
    [...elementsOf(doc).entries()].filter(([, m]) => m.get('type') === 'column').map(([k]) => k);

  // Operations ------------------------------------------------------------------------------

  const createLight = (doc: Y.Doc) => {
    const columns = columnsIn(doc);
    const parent = columns.length > 0 && random() < 0.25 ? pick(columns) : null;
    doc.transact(() => {
      const map = addElement(doc, lightCard(id(), parent));
      const body = map.get('body');
      if (body instanceof Y.XmlFragment) body.insert(0, [paragraph(sentence())]);
    });
    count('create');
  };
  const remove = (doc: Y.Doc) => {
    const light = liveLight(doc);
    if (light.length === 0) return createLight(doc);
    const target = pick(light);
    const elements = elementsOf(doc);
    // Like deleteElements in canvas-core: a column goes with the cards inside it.
    doc.transact(() => {
      for (const [key, map] of [...elements.entries()])
        if (map.get('parent') === target && !heavy.has(key)) elements.delete(key);
      elements.delete(target);
    });
    count('delete');
  };
  const move = (doc: Y.Doc) => {
    const keys = [...elementsOf(doc).keys()];
    if (keys.length === 0) return createLight(doc);
    const target = pick(keys);
    const map = elementsOf(doc).get(target)!;
    const roll = random();
    const type = map.get('type');
    doc.transact(() => {
      if (roll < 0.1 && type !== 'column' && type !== 'section' && !heavy.has(target)) {
        // Into a column, or back onto the canvas.
        const columns = columnsIn(doc);
        map.set('parent', map.get('parent') === null && columns.length ? pick(columns) : null);
        map.set('z', nextZ());
      } else if (roll < 0.2) {
        map.set('z', nextZ()); // brought to front
      } else if (roll < 0.27) {
        map.set('w', pick([200, 240, 300, 360, 480]));
      } else {
        map.set('x', ((map.get('x') as number) ?? 0) + int(-400, 400));
        map.set('y', ((map.get('y') as number) ?? 0) + int(-400, 400));
      }
    });
    count('move');
  };
  const draw = (doc: Y.Doc) => {
    const open = drawn.filter((d) => {
      const strokes = elementsOf(doc).get(d.id)?.get('strokes');
      return strokes instanceof Y.Array && strokes.length < d.target;
    });
    if (open.length === 0) return move(doc);
    const card = pick(open);
    const strokes = elementsOf(doc).get(card.id)!.get('strokes') as Y.Array<Stroke>;
    // One in ten strokes is erased again, as an eraser or an undo would.
    if (strokes.length > 0 && random() < 0.1) {
      doc.transact(() => strokes.delete(int(0, strokes.length - 1), 1));
      count('strokeErase');
    } else {
      doc.transact(() => strokes.push([strokeOf(card.type === 'plan')]));
      count('stroke');
    }
  };
  const tableRows = (doc: Y.Doc) => {
    const rows = elementsOf(doc).get(tableId)?.get('rows');
    return rows instanceof Y.Array ? (rows as Y.Array<Y.Map<unknown>>) : null;
  };
  const editTable = (doc: Y.Doc) => {
    const rows = tableRows(doc);
    if (!rows) return move(doc);
    const roll = random();
    if (rows.length < spec.tableRows && roll < 0.55) {
      const row = { id: id(), cells: { [pick(columnIds)]: sentence() } };
      doc.transact(() => rows.insert(int(0, rows.length), [tableRowMap(row)]));
      count('rowInsert');
    } else if (rows.length > 0 && roll < 0.6) {
      doc.transact(() => rows.delete(int(0, rows.length - 1), 1));
      count('rowDelete');
    } else if (rows.length > 0) {
      const cells = rows.get(int(0, rows.length - 1)).get('cells') as Y.Map<string>;
      doc.transact(() => cells.set(pick(columnIds), sentence()));
      count('cellEdit');
    } else return move(doc);
  };
  const writeNote = (doc: Y.Doc) => {
    const note = elementsOf(doc).get(pick(richNotes));
    const body = note?.get('body');
    if (!(body instanceof Y.XmlFragment)) return move(doc);
    const roll = random();
    doc.transact(() => {
      if (roll < 0.35 || body.length === 0) {
        body.insert(int(0, body.length), [paragraph(sentence())]);
      } else if (roll < 0.5) {
        const list = new Y.XmlElement('taskList');
        const item = new Y.XmlElement('taskItem');
        item.setAttribute('checked', (random() < 0.5) as unknown as string);
        item.insert(0, [paragraph(sentence())]);
        list.insert(0, [item]);
        body.insert(int(0, body.length), [list]);
      } else if (roll < 0.62) {
        const p = new Y.XmlElement('paragraph');
        const mention = new Y.XmlElement('mention');
        mention.setAttribute('id', uuid());
        mention.setAttribute('label', pick(['Anna', 'Luca', 'Giulia', 'Marco']));
        p.insert(0, [new Y.XmlText(`${sentence()} `), mention]);
        body.insert(int(0, body.length), [p]);
      } else if (roll < 0.7) {
        const picture = new Y.XmlElement('noteImage');
        picture.setAttribute('assetId', uuid());
        body.insert(int(0, body.length), [picture]);
      } else if (roll < 0.9) {
        // Typing into an existing paragraph, sometimes with the ink mark.
        const first = body.get(int(0, body.length - 1));
        const text = first instanceof Y.XmlElement ? first.get(0) : null;
        if (text instanceof Y.XmlText) {
          const ink = random() < 0.3 ? { noteInk: { color: 'red', highlight: null } } : undefined;
          text.insert(int(0, text.length), `${pick(words)} `, ink);
        } else body.insert(body.length, [paragraph(sentence())]);
      } else {
        body.delete(int(0, body.length - 1), 1);
      }
    });
    count('noteEdit');
  };

  const createHeavy = (doc: Y.Doc, elementId: string) => {
    doc.transact(() => {
      if (elementId === tableId) {
        addElement(doc, {
          ...base(tableId),
          type: 'table',
          header: true,
          columns: columnIds.map((c) => ({ id: c })),
          rows: [],
        });
        return;
      }
      const card = drawn.find((d) => d.id === elementId);
      if (card?.type === 'frame')
        addElement(doc, { ...base(elementId), type: 'frame', action: sentence() });
      else if (card) {
        addElement(doc, {
          ...base(elementId),
          type: 'plan',
          title: sentence().slice(0, 200),
          icons: Array.from({ length: int(3, 20) }, () => ({
            id: id(),
            kind: pick(['camera', 'actor', 'light'] as const),
            color: color(),
            x: int(0, 4096),
            y: int(0, 4096),
            rotation: int(0, 359),
          })),
        });
      } else {
        const map = addElement(doc, { ...base(elementId), type: 'note' });
        (map.get('body') as Y.XmlFragment).insert(0, [paragraph(sentence())]);
      }
    });
    count('create');
  };

  // Setup: one device creates the board, the heavy cards appear over the first rounds.
  session(replicas[0]!);
  initBoardDoc(replicas[0]!, boardId);
  sync();
  const heavyQueue = [...heavy];

  // The work of the whole history, shuffled and cut into sessions of uneven length.
  const strokeOps = Math.ceil(drawn.reduce((sum, d) => sum + d.target, 0) * 1.25);
  const tableOps = Math.ceil(spec.tableRows * 2.2);
  const noteOps = spec.richNotes * 12;
  const lightCreates = spec.elements - heavy.size + spec.deletions;
  const plan: Array<(doc: Y.Doc) => void> = [
    ...Array<typeof createLight>(lightCreates).fill(createLight),
    ...Array<typeof remove>(spec.deletions).fill(remove),
    ...Array<typeof move>(spec.moves).fill(move),
    ...Array<typeof draw>(strokeOps).fill(draw),
    ...Array<typeof editTable>(tableOps).fill(editTable),
    ...Array<typeof writeNote>(noteOps).fill(writeNote),
  ];
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [plan[i], plan[j]] = [plan[j]!, plan[i]!];
  }
  const cuts = Array.from({ length: spec.sessions - 1 }, () => int(1, plan.length - 1)).sort(
    (a, b) => a - b,
  );
  const chunks: Array<Array<(doc: Y.Doc) => void>> = [];
  let from = 0;
  for (const cut of [...cuts, plan.length]) {
    chunks.push(plan.slice(from, cut));
    from = cut;
  }
  for (let round = 0; round * spec.replicas < chunks.length; round++) {
    for (let r = 0; r < spec.replicas; r++) {
      const chunk = chunks[round * spec.replicas + r];
      if (!chunk) break;
      const doc = replicas[r]!;
      session(doc);
      const next = heavyQueue.shift();
      if (next) createHeavy(doc, next);
      for (const op of chunk) op(doc);
    }
    sync();
  }

  // Settle: one last session brings every count to its target, as editing would.
  const doc = replicas[0]!;
  session(doc);
  for (const next of heavyQueue.splice(0)) createHeavy(doc, next);
  const elements = elementsOf(doc);
  while (elements.size > spec.elements) remove(doc);
  while (elements.size < spec.elements) createLight(doc);
  for (const card of drawn) {
    const strokes = elements.get(card.id)!.get('strokes') as Y.Array<Stroke>;
    while (strokes.length > card.target) {
      doc.transact(() => strokes.delete(strokes.length - 1, 1));
      count('strokeErase');
    }
    while (strokes.length < card.target) {
      doc.transact(() => strokes.push([strokeOf(card.type === 'plan')]));
      count('stroke');
    }
  }
  const rows = tableRows(doc)!;
  while (rows.length > spec.tableRows) {
    doc.transact(() => rows.delete(rows.length - 1, 1));
    count('rowDelete');
  }
  while (rows.length < spec.tableRows) {
    const row = { id: id(), cells: { [pick(columnIds)]: sentence() } };
    doc.transact(() => rows.push([tableRowMap(row)]));
    count('rowInsert');
  }
  // Each rich note shows every custom node at least once.
  for (const noteId of richNotes) {
    const body = elements.get(noteId)!.get('body') as Y.XmlFragment;
    const names = new Set(body.toArray().map((n) => (n instanceof Y.XmlElement ? n.nodeName : '')));
    if (!names.has('taskList') || !names.has('noteImage') || !body.toString().includes('<mention'))
      doc.transact(() => {
        const list = new Y.XmlElement('taskList');
        const item = new Y.XmlElement('taskItem');
        item.insert(0, [paragraph(sentence())]);
        list.insert(0, [item]);
        const p = new Y.XmlElement('paragraph');
        const mention = new Y.XmlElement('mention');
        mention.setAttribute('id', uuid());
        mention.setAttribute('label', 'Anna');
        p.insert(0, [new Y.XmlText('Chiedere a '), mention]);
        const picture = new Y.XmlElement('noteImage');
        picture.setAttribute('assetId', uuid());
        body.insert(body.length, [list, p, picture]);
        count('noteEdit');
      });
  }

  const update = Y.encodeStateAsUpdate(doc);
  const byType: Record<string, number> = {};
  for (const map of elements.values()) {
    const type = String(map.get('type'));
    byType[type] = (byType[type] ?? 0) + 1;
  }
  const strokeCounts = drawn.map(
    (d) => (elements.get(d.id)!.get('strokes') as Y.Array<unknown>).length,
  );
  const summary: ReferenceBoardSummary = {
    size,
    seed,
    boardId,
    updateBytes: update.byteLength,
    elements: { total: elements.size, byType },
    drawn: {
      cards: drawn.length,
      strokes: strokeCounts.reduce((a, b) => a + b, 0),
      minStrokes: Math.min(...strokeCounts),
      maxStrokes: Math.max(...strokeCounts),
    },
    richNotes: richNotes.length,
    table: { rows: rows.length, columns: columnIds.length },
    bench: { frameId: drawn[0]!.id, tableId },
    history: {
      operations: Object.values(byKind).reduce((a, b) => a + b, 0),
      byKind,
      sessions,
      clientIds: Y.decodeStateVector(Y.encodeStateVector(doc)).size,
    },
  };
  for (const replica of replicas) replica.destroy();
  return { update, summary };
}
