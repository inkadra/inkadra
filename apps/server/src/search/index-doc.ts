import { type Element, readElement, roots } from '@inkadra/doc-schema';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import type { Database } from '../db/client.ts';
import { asset, board, boardDoc, boardElementIndex } from '../db/schema.ts';

/** One row of board_element_index, before the board and project ids are added. */
export interface IndexEntry {
  elementId: string;
  type: string;
  title: string;
  text: string;
  tags: string[];
  assetId: string | null;
  data: Record<string, unknown> | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 20_000;

/** Plain text of a Tiptap note, paragraphs separated by spaces. */
export function fragmentText(fragment: Y.XmlFragment): string {
  const parts: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment) => {
    if (node instanceof Y.XmlText) {
      parts.push(node.toString().replace(/<[^>]*>/g, ''));
      return;
    }
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText || child instanceof Y.XmlElement) walk(child);
    }
    parts.push(' ');
  };
  walk(fragment);
  return clean(parts.join(''));
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function join(...parts: Array<string | undefined | null | string[]>): string {
  return clean(parts.flat().filter(Boolean).join(' ')).slice(0, MAX_TEXT);
}

function uuidOrNull(id: string | undefined): string | null {
  return id && UUID.test(id) ? id : null;
}

/** A, B, … Z, AA: the same letters as frameLetter in @inkadra/canvas-core. */
function letter(n: number): string {
  let s = '';
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
  return s;
}

/**
 * Shot numbers that frames without a label show (scene number + letter, in order), as the
 * storyboard computes them, so a search finds "4C" too.
 */
export function autoFrameLabels(elements: readonly Element[]): Map<string, string> {
  const scenes = new Map<string, string>();
  for (const el of elements) if (el.type === 'scene') scenes.set(el.id, el.number);
  const byScene = new Map<string, Element[]>();
  for (const el of elements) {
    if (el.type !== 'frame' || !el.parent || !scenes.has(el.parent)) continue;
    byScene.set(el.parent, [...(byScene.get(el.parent) ?? []), el]);
  }
  const labels = new Map<string, string>();
  for (const [sceneId, frames] of byScene) {
    frames.sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1));
    frames.forEach((f, i) => {
      labels.set(f.id, `${scenes.get(sceneId)}${letter(i)}`);
    });
  }
  return labels;
}

/** What search sees of one element. Rich text comes from the note body. */
export function entryFor(el: Element, body: string, autoLabel?: string): IndexEntry {
  const base = {
    elementId: el.id,
    type: el.type,
    tags: [...new Set((el.tags ?? []).map((t) => t.toLowerCase()))],
    assetId: null as string | null,
    data: null as Record<string, unknown> | null,
  };
  switch (el.type) {
    case 'note': {
      const title = body.slice(0, 80);
      return { ...base, title, text: join(body) };
    }
    case 'image':
    case 'file':
      return {
        ...base,
        title: el.caption?.slice(0, 80) ?? '',
        text: join(el.caption),
        assetId: uuidOrNull(el.assetId),
      };
    case 'link':
      return {
        ...base,
        title: el.title ?? el.url,
        text: join(el.title, el.description, el.url),
        assetId: uuidOrNull(el.imageAssetId),
      };
    case 'todo':
      return {
        ...base,
        title: el.title ?? el.items[0]?.text ?? '',
        text: join(
          el.title,
          el.items.map((i) => i.text),
        ),
      };
    case 'color':
      return { ...base, title: el.label ?? el.hex, text: join(el.label, el.hex) };
    case 'column':
      return { ...base, title: el.title, text: join(el.title) };
    case 'board':
      return { ...base, title: '', text: '' };
    case 'scene':
      return {
        ...base,
        title: join(el.number, el.title),
        text: join(el.number, el.title, el.location, el.synopsis),
        data: { number: el.number },
      };
    case 'frame':
      return {
        ...base,
        title: el.label ?? autoLabel ?? '',
        text: join(
          el.label ?? autoLabel,
          el.action,
          el.shot,
          el.angle,
          el.movement,
          el.lens,
          el.audio,
          el.dialogue,
          el.notes,
          el.location,
          el.cast,
        ),
        assetId: uuidOrNull(el.assetId),
        data: {
          scene: el.parent,
          label: el.label ?? null,
          status: el.status ?? 'draft',
          durationMs: el.durationMs ?? null,
        },
      };
    case 'arrow':
      return { ...base, title: el.label ?? '', text: join(el.label) };
    case 'character':
      return {
        ...base,
        title: el.name,
        text: join(
          el.name,
          el.role,
          el.age,
          el.description,
          el.actor,
          el.contact,
          el.notes,
          el.scenes,
        ),
        assetId: uuidOrNull(el.assetId),
        data: { role: el.role ?? null },
      };
    case 'location':
      return {
        ...base,
        title: el.name,
        text: join(
          el.name,
          el.address,
          el.light,
          el.availability,
          el.contact,
          el.notes,
          el.scenes,
        ),
        assetId: uuidOrNull(el.assetId),
        data: { setting: el.setting ?? null },
      };
  }
}

/** Entries for every valid element of a document. Elements a newer client wrote are skipped. */
export function entriesFor(doc: Y.Doc): IndexEntry[] {
  const read: Array<{ el: Element; map: Y.Map<unknown> }> = [];
  for (const map of roots(doc).elements.values()) {
    const el = readElement(map);
    if (el) read.push({ el, map });
  }
  const labels = autoFrameLabels(read.map((r) => r.el));
  return read.map(({ el, map }) => {
    const body = map.get('body');
    return entryFor(el, body instanceof Y.XmlFragment ? fragmentText(body) : '', labels.get(el.id));
  });
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Replaces the index rows of a board with the content of `doc`. Idempotent: running it twice
 * on the same document leaves the same rows.
 */
export async function writeBoardIndex(tx: Tx | Database, boardId: string, doc: Y.Doc) {
  const [row] = await tx
    .select({ projectId: board.projectId })
    .from(board)
    .where(eq(board.id, boardId));
  if (!row) return 0;
  const entries = entriesFor(doc);
  // File cards are searchable by both their file name and their caption.
  const fileIds = entries.flatMap((e) => (e.type === 'file' && e.assetId ? [e.assetId] : []));
  const names = new Map<string, string>();
  if (fileIds.length > 0) {
    const rows = await tx
      .select({ id: asset.id, filename: asset.filename })
      .from(asset)
      .where(inArray(asset.id, fileIds));
    for (const r of rows) names.set(r.id, r.filename);
  }
  for (const e of entries) {
    if (e.type === 'file' && e.assetId) {
      const name = names.get(e.assetId) ?? '';
      e.title = name || e.title;
      e.text = join(name, e.text);
    }
  }
  await tx.delete(boardElementIndex).where(eq(boardElementIndex.boardId, boardId));
  for (let i = 0; i < entries.length; i += 500) {
    await tx
      .insert(boardElementIndex)
      .values(entries.slice(i, i + 500).map((e) => ({ ...e, boardId, projectId: row.projectId })));
  }
  // Keep updated_at as it is: it says when the document changed, not the index.
  await tx
    .update(boardDoc)
    .set({ indexedAt: new Date(), updatedAt: sql`${boardDoc.updatedAt}` })
    .where(eq(boardDoc.boardId, boardId));
  return entries.length;
}

/**
 * Indexes boards stored before the index existed, or whose last indexing failed; at most
 * `limit` boards per call.
 */
export async function backfillIndex(db: Database, limit = 200) {
  const stale = await db
    .select({ boardId: boardDoc.boardId, state: boardDoc.state })
    .from(boardDoc)
    .where(sql`${boardDoc.indexedAt} is null or ${boardDoc.indexedAt} < ${boardDoc.updatedAt}`)
    .limit(limit);
  for (const row of stale) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.state);
    await db.transaction((tx) => writeBoardIndex(tx, row.boardId, doc));
    doc.destroy();
  }
  return { indexed: stale.length };
}

/**
 * Run by the collaboration server, which writes the index: catches up at start, then every
 * hour for boards whose indexing failed.
 */
export function startIndexBackfill(db: Database, log: Logger, everyMs = 60 * 60 * 1000) {
  let stopped = false;
  const run = async () => {
    try {
      let total = 0;
      for (;;) {
        const { indexed } = await backfillIndex(db);
        total += indexed;
        if (indexed === 0 || stopped) break;
      }
      if (total > 0) log.info({ boards: total }, 'board search index caught up');
    } catch (err) {
      log.error({ err }, 'board search index backfill failed');
    }
  };
  void run();
  const timer = setInterval(() => void run(), everyMs);
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
