import { roots, TodoItem } from '@inkadra/doc-schema';
import type { MyTask } from '@inkadra/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import { activeMember, atLeast, boardRole, boardRoles, projectRole } from './access.ts';
import { type OpenTask, openTasks } from './board-preview.ts';
import type { Database } from './db/client.ts';
import { board, boardDoc, project, projectMember } from './db/schema.ts';
import { notify, Recipients } from './notifications.ts';

/** Read raw: one item that no longer fits the schema must not hide or block the others. */
function rawTodoItems(doc: Y.Doc) {
  const items = new Map<string, { elementId: string; itemId: string; item: Y.Map<unknown> }>();
  for (const map of roots(doc).elements.values()) {
    const list = map.get('items');
    if (map.get('type') !== 'todo' || !(list instanceof Y.Array)) continue;
    for (const item of list)
      if (item instanceof Y.Map) {
        const elementId = String(map.get('id'));
        const itemId = String(item.get('id'));
        items.set(`${elementId}:${itemId}`, { elementId, itemId, item });
      }
  }
  return items;
}

export function assignedItems(doc: Y.Doc) {
  const items = new Map<string, { elementId: string; itemId: string; assigneeId: string }>();
  for (const [key, { elementId, itemId, item }] of rawTodoItems(doc)) {
    const assigneeId = item.get('assigneeId');
    if (typeof assigneeId === 'string') items.set(key, { elementId, itemId, assigneeId });
  }
  return items;
}

/** Recheck both sides at the notification boundary; share-link guests have no actor id. */
export async function notifyAssignment(
  db: Database,
  boardId: string,
  elementId: string,
  assigneeId: string,
  actorId: string,
) {
  const access = await boardRole(db, { id: actorId }, boardId);
  if (!access?.role || !atLeast(access.role, 'editor')) return false;
  if (!(await projectRole(db, { id: assigneeId }, access.projectId))) return false;
  await notify(
    db,
    { actor: { userId: actorId }, projectId: access.projectId, boardId, elementId },
    new Recipients(actorId).add(assigneeId, 'task_assigned'),
  );
  return true;
}

export function tasksInDoc(
  doc: Y.Doc,
  userId: string,
  place: Omit<MyTask, 'itemId' | 'elementId' | 'text' | 'dueDate'>,
): MyTask[] {
  return mine(openTasks(doc), userId, place);
}

function mine(
  tasks: OpenTask[],
  userId: string,
  place: Omit<MyTask, 'itemId' | 'elementId' | 'text' | 'dueDate'>,
): MyTask[] {
  return tasks
    .filter((t) => t.assigneeId === userId)
    .map(({ assigneeId: _, ...task }) => ({ ...place, ...task }));
}

/**
 * The person's open tasks across their projects: from the tasks stored with each document at
 * its last indexing (#803), decoding only documents stored since. Boards whose stored tasks
 * name someone else are never read.
 */
export async function myTasks(db: Database, userId: string): Promise<MyTask[]> {
  const fresh = sql`(coalesce(${boardDoc.indexedAt} >= ${boardDoc.updatedAt}, false)
    and ${boardDoc.tasks} is not null)`;
  const rows = await db
    .select({
      board,
      projectName: project.name,
      tasks: sql<OpenTask[] | null>`case when ${fresh} then ${boardDoc.tasks} end`,
      state: sql<Uint8Array | null>`case when ${fresh} then null else ${boardDoc.state} end`,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .innerJoin(board, eq(board.projectId, project.id))
    .innerJoin(boardDoc, eq(boardDoc.boardId, board.id))
    .where(
      and(
        eq(projectMember.userId, userId),
        activeMember(),
        isNull(project.archivedAt),
        isNull(board.deletedAt),
        sql`(not ${fresh} or ${boardDoc.tasks} @> ${JSON.stringify([{ assigneeId: userId }])}::jsonb)`,
      ),
    );
  const readable = await boardRoles(
    db,
    { id: userId },
    rows.map((r) => r.board.id),
  );
  const items: MyTask[] = [];
  for (const row of rows) {
    if (!readable.has(row.board.id)) continue;
    const place = {
      projectId: row.board.projectId,
      projectName: row.projectName,
      boardId: row.board.id,
      boardTitle: row.board.title,
    };
    if (row.tasks) {
      items.push(...mine(row.tasks, userId, place));
      continue;
    }
    if (!row.state) continue;
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, row.state);
      items.push(...tasksInDoc(doc, userId, place));
    } finally {
      doc.destroy();
    }
  }
  return items.sort(
    (a, b) =>
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.text.localeCompare(b.text),
  );
}

const TaskFields = TodoItem.pick({ assigneeId: true, dueDate: true });

/**
 * Keys whose new value can change what the task check reads: the task fields themselves, and
 * what makes a map a todo item under its key (`id`, `type`, `items`).
 */
const TASK_KEYS = new Set(['assigneeId', 'dueDate', 'id', 'type', 'items']);

/**
 * Whether a transaction can change what `assignedItems` reads: a card added or removed, an item
 * added to or removed from a list of items, or a write under one of TASK_KEYS. Yjs records only
 * the types that existed before the transaction, so what goes into a new type shows on the one
 * that holds it. It cannot see a change inside an id held in a shared type (a Y.Text, which
 * `assignedItems` reads with String): trackAssignments reads such a board every time.
 */
export function changesTasks(transaction: Y.Transaction): boolean {
  const { elements } = roots(transaction.doc);
  for (const [type, keys] of transaction.changed) {
    if ((type as unknown) === elements) return true;
    if (type instanceof Y.Array && type._item?.parentSub === 'items') return true;
    for (const key of keys) if (key !== null && TASK_KEYS.has(key)) return true;
  }
  return false;
}

/** Whether every id `assignedItems` reads on a board is a plain value, not a shared type. */
function plainTodoIds(doc: Y.Doc) {
  for (const map of roots(doc).elements.values()) {
    const list = map.get('items');
    if (map.get('type') !== 'todo' || !(list instanceof Y.Array)) continue;
    if (map.get('id') instanceof Y.AbstractType) return false;
    for (const item of list)
      if (item instanceof Y.Map && item.get('id') instanceof Y.AbstractType) return false;
  }
  return true;
}

/**
 * The assignments of a board, read again only after a transaction that can change them
 * (changesTasks), instead of walking every card on each edit. Conservative: a board where an id
 * read by `assignedItems` is a shared type is read again every time, as before.
 */
export function trackAssignments(doc: Y.Doc): () => ReturnType<typeof assignedItems> {
  let items = assignedItems(doc);
  let stale = !plainTodoIds(doc);
  doc.on('afterTransaction', (transaction: Y.Transaction) => {
    if (changesTasks(transaction)) stale = true;
  });
  return () => {
    if (stale) {
      items = assignedItems(doc);
      stale = !plainTodoIds(doc);
    }
    return items;
  };
}

type TaskValues = { assigneeId: unknown; dueDate: unknown };
const TASK_FIELDS = ['assigneeId', 'dueDate'] as const;

/** Whether a map of the board is a to-do item `rawTodoItems` reads, and still is after `ds`. */
function isTodoItem(
  document: Y.Doc,
  map: Y.Map<unknown>,
  ds: ReturnType<typeof Y.decodeUpdate>['ds'],
) {
  // First: until a root is read by its type, Yjs keeps a placeholder as the parent of its items.
  const { elements } = roots(document);
  const list = map._item?.parent;
  const card = list instanceof Y.Array ? list._item?.parent : undefined;
  if (
    !(list instanceof Y.Array) ||
    !(card instanceof Y.Map) ||
    card._item?.parent !== elements ||
    card.get('type') !== 'todo' ||
    card.get('items') !== list
  )
    return false;
  return [map._item, list._item, card._item].every(
    (i) => i && !i.deleted && !Y.isDeleted(ds, i.id),
  );
}

/**
 * What the to-do check has to read in an update (#755). Todo items are Y.Maps, so a write that
 * can assign a task or set a due date is always a value under one of TASK_KEYS. A first value
 * carries its key and parent; a new value of a key that had one carries only its origin, the
 * value it replaces, so both are read from that item, in the document or earlier in the update.
 * A deletion alone assigns nobody.
 *
 * Usually the answer is the fields, once the update is applied, of the to-do items it writes
 * `assigneeId` or `dueDate` on, each new value placed right after the board's last one for its
 * key (so it is the value Yjs keeps, with no tie to break). An update that only adds cards or
 * items without those fields, or changes nothing they hold, gives none. Anything else (a gap,
 * held-back structs, a new card that comes with assignees, a changed id, type or list of items,
 * a value concurrent with one the board holds) is 'full': only applying it to a copy of the
 * board can tell.
 *
 * shortcut: reads updates the way Yjs clients write them; a crafted one is out of scope
 * (decision 0139).
 */
export function taskWrites(
  document: Y.Doc,
  update: Uint8Array,
): 'full' | Map<Y.Map<unknown>, TaskValues> {
  // Structs or deletions held back for a missing earlier update were never checked against this
  // test (they could not be read yet): an update that fills the gap integrates them, so the full
  // check, whose candidate includes them, has to run (#880 review).
  if (document.store.pendingStructs || document.store.pendingDs) return 'full';
  try {
    const { structs, ds } = Y.decodeUpdate(update);
    const inDocument = (id: Y.ID) => id.clock < Y.getState(document.store, id.client);
    // The structs of each client, in clock order as an update lists them, for a binary search.
    const byClient = new Map<number, Array<(typeof structs)[number]>>();
    for (const s of structs) {
      const list = byClient.get(s.id.client);
      // A gap, inside the update or before a client's first struct: Yjs holds back what follows.
      if (s instanceof Y.Skip) return 'full';
      if (list) list.push(s);
      else if (s.id.clock > Y.getState(document.store, s.id.client)) return 'full';
      else byClient.set(s.id.client, [s]);
    }
    const sent = (id: Y.ID) => {
      const list = byClient.get(id.client);
      if (!list) return undefined;
      let lo = 0;
      let hi = list.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const s = list[mid]!;
        if (id.clock < s.id.clock) hi = mid - 1;
        else if (id.clock >= s.id.clock + s.length) lo = mid + 1;
        else return s;
      }
      return undefined;
    };
    /** The type a decoded item names as parent: one of the board, or 'new' when the update adds it. */
    const parentType = (parent: unknown): unknown => {
      if (typeof parent === 'string') return document.share.get(parent);
      if (!(parent instanceof Y.ID)) return undefined;
      if (!inDocument(parent)) return 'new';
      const holder = Y.getItem(document.store, parent);
      return holder instanceof Y.Item && holder.content instanceof Y.ContentType
        ? holder.content.type
        : undefined;
    };
    type Place = {
      /** The map key, null when it is not a map value, undefined when unknown. */
      key: string | null | undefined;
      /** The type of the board it goes in, or 'new' when the update adds that type. */
      parent?: unknown;
    };
    // The place of each item read so far: a chain of origins is walked once, not once per item,
    // so a long chained update stays linear (#880 review).
    const places = new Map<unknown, Place>();
    const placeOf = (first: (typeof structs)[number] | undefined): Place => {
      const chain: unknown[] = [];
      let item = first;
      let place: Place;
      for (;;) {
        if (!(item instanceof Y.Item)) {
          place = { key: undefined };
          break;
        }
        const known = places.get(item);
        if (known) {
          place = known;
          break;
        }
        chain.push(item);
        if (item.parentSub !== null) {
          place = { key: item.parentSub, parent: parentType(item.parent) };
          break;
        }
        // Read from the document: a decoded item names neither its key nor its parent.
        if (item.parent !== null && item.origin === null && item.rightOrigin === null) {
          place = { key: null };
          break;
        }
        const origin = item.origin ?? item.rightOrigin;
        if (!origin) {
          place = { key: null };
          break;
        }
        if (inDocument(origin)) {
          const stored = Y.getItem(document.store, origin);
          place =
            stored instanceof Y.Item
              ? { key: stored.parentSub, parent: stored.parent }
              : { key: undefined };
          break;
        }
        item = sent(origin);
        // Longer than the update: a cycle, which only a malformed update makes.
        if (chain.length > structs.length) {
          place = { key: undefined };
          break;
        }
      }
      for (const c of chain) places.set(c, place);
      return place;
    };
    const written = new Map<Y.Map<unknown>, Map<string, Y.Item[]>>();
    for (const s of structs) {
      // Already on the board (a resend): Yjs skips it.
      if (
        !(s instanceof Y.Item) ||
        s.id.clock + s.length <= Y.getState(document.store, s.id.client)
      )
        continue;
      const { key, parent } = placeOf(s);
      if (key === undefined) return 'full';
      if (key === null || !TASK_KEYS.has(key)) continue;
      // What a new card or item is made of: without assignees or due dates, nothing to check.
      if (parent === 'new' && key !== 'assigneeId' && key !== 'dueDate') continue;
      if (
        (key !== 'assigneeId' && key !== 'dueDate') ||
        !(parent instanceof Y.Map) ||
        !isTodoItem(document, parent, ds) ||
        s.rightOrigin
      )
        return 'full';
      const keys = written.get(parent) ?? new Map<string, Y.Item[]>();
      written.set(parent, keys);
      keys.set(key, [...(keys.get(key) ?? []), s]);
    }
    const values = new Map<Y.Map<unknown>, TaskValues>();
    for (const [map, keys] of written) {
      const now = taskValues(map);
      for (const field of TASK_FIELDS) {
        const current = map._map.get(field);
        if (current && Y.isDeleted(ds, current.id)) now[field] = undefined;
      }
      for (const [key, items] of keys) {
        // Each value after the one before, starting from the board's last: a chain with no ties.
        const after = new Map(
          items.map((i) => [i.origin && `${i.origin.client}:${i.origin.clock}`, i]),
        );
        let last = map._map.get(key) ?? null;
        for (let n = 0; n < items.length; n++) {
          const next = after.get(last && `${last.lastId.client}:${last.lastId.clock}`);
          if (!next) return 'full';
          last = next;
        }
        now[key as keyof TaskValues] =
          last && !Y.isDeleted(ds, last.id) ? last.content.getContent()[0] : undefined;
      }
      values.set(map, now);
    }
    return values;
  } catch {
    return 'full';
  }
}

/** Whether an update needs the task check at all. */
export function mayTouchTasks(document: Y.Doc, update: Uint8Array): boolean {
  const writes = taskWrites(document, update);
  return writes === 'full' || writes.size > 0;
}

const taskValues = (item: Y.Map<unknown>): TaskValues => ({
  assigneeId: item.get('assigneeId'),
  dueDate: item.get('dueDate'),
});

/** Whether a to-do item's new fields assign someone; throws on a value of the wrong format. */
function assignsTask(was: TaskValues | undefined, now: TaskValues) {
  const newAssignee = now.assigneeId !== was?.assigneeId;
  // What is already stored can't be helped by refusing this sender.
  if (!newAssignee && now.dueDate === was?.dueDate) return false;
  TaskFields.parse(now);
  return newAssignee && !!now.assigneeId;
}

/** The task check on a copy of the whole board with the update applied. */
function assignsOnCopy(document: Y.Doc, update: Uint8Array) {
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
    Y.applyUpdate(candidate, update);
    const stored = rawTodoItems(document);
    let assigns = false;
    for (const [key, { item }] of rawTodoItems(candidate)) {
      const was = stored.get(key)?.item;
      if (assignsTask(was && taskValues(was), taskValues(item))) assigns = true;
    }
    return assigns;
  } finally {
    candidate.destroy();
  }
}

/**
 * Refuse a prospective CRDT update only for what its sender may not do. It has to stay that way:
 * a refused update closes the document, and the client resends it forever with all its other edits.
 * Who can be assigned changes while a client is offline, so that is corrected afterwards instead
 * (dropRemovedAssignees).
 */
export async function validateTaskUpdate(
  db: Database,
  boardId: string,
  actorId: string | undefined,
  document: Y.Doc,
  update: Uint8Array,
) {
  const writes = taskWrites(document, update);
  let assigns = false;
  if (writes === 'full') assigns = assignsOnCopy(document, update);
  else for (const [item, now] of writes) if (assignsTask(taskValues(item), now)) assigns = true;
  if (!assigns) return;
  if (!actorId) throw new Error('Guests cannot assign tasks');
  const access = await boardRole(db, { id: actorId }, boardId);
  if (!access?.role || !atLeast(access.role, 'editor'))
    throw new Error('Assignment requires editor access');
}

/**
 * An applied update assigned someone who isn't in the project (any more): put back the assignee it
 * replaced, or none, for every client. Runs after the update is shared, so others can see the name
 * for a moment; Tasks and notifications check membership themselves.
 */
export async function dropRemovedAssignees(
  db: Database,
  boardId: string,
  document: Y.Doc,
  before: ReturnType<typeof assignedItems>,
  after: ReturnType<typeof assignedItems>,
) {
  const changed = [...after].filter(([key, a]) => before.get(key)?.assigneeId !== a.assigneeId);
  if (!changed.length) return;
  const [row] = await db
    .select({ projectId: board.projectId })
    .from(board)
    .where(eq(board.id, boardId));
  if (!row) return;
  const isMember = (id: string) => projectRole(db, { id }, row.projectId);
  for (const [key, { assigneeId }] of changed) {
    if (await isMember(assigneeId)) continue;
    const previous = before.get(key)?.assigneeId;
    const restore = previous && (await isMember(previous)) ? previous : null;
    // Reread after the queries: a newer edit may already have changed it.
    const { item } = rawTodoItems(document).get(key) ?? {};
    if (item?.get('assigneeId') !== assigneeId) continue;
    document.transact(() => {
      if (restore) item?.set('assigneeId', restore);
      else item?.delete('assigneeId');
    });
  }
}
