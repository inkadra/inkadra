import { linkedLocation, linkedPlan } from '@inkadra/canvas-core';
import { compareZ, type Element, readElement, roots } from '@inkadra/doc-schema';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import { docCounts } from '../board-preview.ts';
import { reviveUsed } from '../classifications.ts';
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
    frames.sort(compareZ);
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
    case 'section':
      return { ...base, title: el.title, text: join(el.title) };
    case 'board':
      return { ...base, title: '', text: '' };
    case 'map':
      return {
        ...base,
        title: el.name || el.address || '',
        text: join(el.name, el.address),
        assetId: uuidOrNull(el.imageAssetId),
      };
    case 'plan': {
      // Labels of icons and the texts written on the plan, as on the card; makes and notes of
      // icons and labels of walls and openings (decision 0104); the notes of blocking positions,
      // the last one's in `stepNote` since version 26 (decision 0119).
      const words = [
        ...(el.icons ?? []).flatMap((i) => [
          i.label,
          i.make,
          i.note,
          i.stepNote,
          ...(i.steps ?? []).map((step) => step.note),
        ]),
        ...(el.shapes ?? []).map((s) => s.text),
        ...(el.walls ?? []).map((w) => w.label),
        ...(el.openings ?? []).map((o) => o.label),
      ].filter((w): w is string => !!w);
      // `autoLabel`: the name of the location it links to.
      return { ...base, title: el.title ?? '', text: join(el.title, autoLabel, words) };
    }
    case 'table': {
      const cells = el.rows.flatMap((r) => el.columns.map((c) => r.cells[c.id] ?? ''));
      return { ...base, title: cells.find(Boolean) ?? '', text: join(cells) };
    }
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
          el.nickname,
          el.profession,
          el.origin,
          el.appearance,
          el.wants,
          el.fears,
          el.arc,
          el.costume,
          el.relations?.map((r) => r.label),
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
        text: join(el.name, el.address, el.light, el.availability, el.contact, el.notes, el.scenes),
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
  // A plan is found by the live names of what it links to (decision 0104): the characters its
  // actors play and its location, as they read now.
  const byId = new Map(read.map((r) => [r.el.id, r.el]));
  return read.map(({ el, map }) => {
    const body = map.get('body');
    const text = body instanceof Y.XmlFragment ? fragmentText(body) : '';
    if (el.type === 'plan')
      return entryFor(linkedPlan(el, byId), text, linkedLocation(el, byId)?.name);
    return entryFor(el, text, labels.get(el.id));
  });
}

/** What a row says, the same however Postgres orders the keys of its jsonb data. */
function rowKey(r: Omit<IndexEntry, 'elementId'> & { projectId: string }): string {
  const sorted = (_key: string, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value;
  return JSON.stringify(
    [r.projectId, r.type, r.title, r.text, r.tags, r.assetId ?? null, r.data ?? null],
    sorted,
  );
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Makes the index rows of a board match the content of `doc`, writing only the rows that differ.
 * Idempotent: running it twice on the same document leaves the same rows, and writes none.
 * Holds the board's document row until the transaction ends: two writes of the same board (a
 * store and the backfill, or a retried store) take turns, and each reads `doc` only once it has
 * the turn. A caller that read the stored state itself rereads it after this lock
 * (backfillIndex), so an older state never lands after a newer one.
 */
export async function writeBoardIndex(tx: Tx | Database, boardId: string, doc: Y.Doc) {
  await tx
    .select({ boardId: boardDoc.boardId })
    .from(boardDoc)
    .where(eq(boardDoc.boardId, boardId))
    .for('update');
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
  // A tag or storyboard value removed while this document still held it comes back (0126).
  await reviveUsed(tx, {
    tags: entries.flatMap((e) => e.tags),
    text: entries.flatMap((e) => (e.type === 'frame' ? [e.text] : [])),
  });
  // #797: only the rows that changed are written. Rewriting every row of the board on every
  // store churned the GIN indexes and the WAL in proportion to the board, not to the edit.
  // shortcut: the rows are read back to compare them, which costs no WAL; keep the last indexed
  // rows in memory per open board if that read ever shows up.
  const kept = await tx
    .select({
      elementId: boardElementIndex.elementId,
      projectId: boardElementIndex.projectId,
      type: boardElementIndex.type,
      title: boardElementIndex.title,
      text: boardElementIndex.text,
      tags: boardElementIndex.tags,
      assetId: boardElementIndex.assetId,
      data: boardElementIndex.data,
    })
    .from(boardElementIndex)
    .where(eq(boardElementIndex.boardId, boardId));
  const was = new Map(kept.map((r) => [r.elementId, rowKey(r)]));
  const rows = entries.map((e) => ({ ...e, boardId, projectId: row.projectId }));
  const changed = rows.filter((r) => was.get(r.elementId) !== rowKey(r));
  const live = new Set(entries.map((e) => e.elementId));
  const gone = kept.flatMap((r) => (live.has(r.elementId) ? [] : [r.elementId]));
  for (let i = 0; i < gone.length; i += 500) {
    await tx
      .delete(boardElementIndex)
      .where(
        and(
          eq(boardElementIndex.boardId, boardId),
          inArray(boardElementIndex.elementId, gone.slice(i, i + 500)),
        ),
      );
  }
  for (let i = 0; i < changed.length; i += 500) {
    await tx
      .insert(boardElementIndex)
      .values(changed.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [boardElementIndex.boardId, boardElementIndex.elementId],
        set: {
          projectId: sql`excluded.project_id`,
          type: sql`excluded.type`,
          title: sql`excluded.title`,
          text: sql`excluded.text`,
          tags: sql`excluded.tags`,
          assetId: sql`excluded.asset_id`,
          data: sql`excluded.data`,
          updatedAt: new Date(),
        },
      });
  }
  // Keep updated_at as it is: it says when the document changed, not the index.
  await tx
    .update(boardDoc)
    .set({ indexedAt: new Date(), counts: docCounts(doc), updatedAt: sql`${boardDoc.updatedAt}` })
    .where(eq(boardDoc.boardId, boardId));
  return entries.length;
}

/**
 * Indexes boards stored before the index existed, or whose last indexing failed; at most
 * `limit` boards per call, in board order after `after`. A board that cannot be indexed is
 * listed in `failed` and skipped (#815): pass `last` as `after` to go on with the next ones.
 */
export async function backfillIndex(db: Database, limit = 200, after?: string) {
  const stale = await db
    .select({ boardId: boardDoc.boardId, state: boardDoc.state })
    .from(boardDoc)
    .where(
      and(
        sql`(${boardDoc.indexedAt} is null or ${boardDoc.indexedAt} < ${boardDoc.updatedAt})`,
        after ? gt(boardDoc.boardId, after) : undefined,
      ),
    )
    .orderBy(boardDoc.boardId)
    .limit(limit);
  let indexed = 0;
  const failed: Array<{ boardId: string; err: unknown }> = [];
  for (const row of stale) {
    const doc = new Y.Doc();
    try {
      // Reread under the lock: a store may have written a newer state and its index since.
      const done = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({
            state: boardDoc.state,
            indexedAt: boardDoc.indexedAt,
            updatedAt: boardDoc.updatedAt,
          })
          .from(boardDoc)
          .where(eq(boardDoc.boardId, row.boardId))
          .for('update');
        if (!locked || (locked.indexedAt && locked.indexedAt >= locked.updatedAt)) return false;
        Y.applyUpdate(doc, locked.state);
        await writeBoardIndex(tx, row.boardId, doc);
        return true;
      });
      if (done) indexed += 1;
    } catch (err) {
      failed.push({ boardId: row.boardId, err });
    } finally {
      doc.destroy();
    }
  }
  return { indexed, failed, last: stale.at(-1)?.boardId };
}

/** Session lock key: one search-index backfill at a time across processes (#815). */
const BACKFILL_LOCK = 10895;

/**
 * Run by the collaboration server, which writes the index: catches up at start, then every
 * hour for boards whose indexing failed.
 */
export function startIndexBackfill(db: Database, log: Logger, everyMs = 60 * 60 * 1000) {
  let stopped = false;
  let running = false;
  const run = async () => {
    // Several collab or all-in-one processes share the database: one backfill at a time
    // (#815). The lock lives in the session of one reserved connection.
    if (running) return;
    running = true;
    let reserved: Awaited<ReturnType<Database['$client']['reserve']>> | undefined;
    try {
      reserved = await db.$client.reserve();
      const [lock] = await reserved<
        { ok: boolean }[]
      >`select pg_try_advisory_lock(${BACKFILL_LOCK}) as ok`;
      if (!lock?.ok) return;
      let total = 0;
      let after: string | undefined;
      for (;;) {
        const batch = await backfillIndex(db, 200, after);
        total += batch.indexed;
        for (const { boardId, err } of batch.failed)
          log.error({ err, boardId }, 'board not indexed for search: retried in an hour');
        if (!batch.last || stopped) break;
        after = batch.last;
      }
      if (total > 0) log.info({ boards: total }, 'board search index caught up');
    } catch (err) {
      log.error({ err }, 'board search index backfill failed');
    } finally {
      if (reserved) {
        await reserved`select pg_advisory_unlock_all()`.catch(() => {});
        reserved.release();
      }
      running = false;
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
