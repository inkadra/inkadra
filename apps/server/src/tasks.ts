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
function* eachTodoItem(doc: Y.Doc) {
  for (const map of roots(doc).elements.values()) {
    const list = map.get('items');
    if (map.get('type') !== 'todo' || !(list instanceof Y.Array)) continue;
    for (const item of list)
      if (item instanceof Y.Map) {
        const elementId = String(map.get('id'));
        const itemId = String(item.get('id'));
        yield { key: `${elementId}:${itemId}`, elementId, itemId, item, card: map };
      }
  }
}

function rawTodoItems(doc: Y.Doc) {
  const items = new Map<string, { elementId: string; itemId: string; item: Y.Map<unknown> }>();
  for (const { key, ...entry } of eachTodoItem(doc)) items.set(key, entry);
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

/**
 * Keys under which a change at any depth can change what the task check reads: an id kept in a
 * shared type (a Y.Text) is read with String.
 */
const VALUE_KEYS = new Set(['assigneeId', 'dueDate', 'id', 'type']);

type Struct = ReturnType<typeof Y.decodeUpdate>['structs'][number];
/** Where an item sits: the item of the type that holds it (null: a root type) and its map key. */
type Place = { parent: Y.Item | null; key: string | null; root?: unknown } | undefined;

/**
 * Whether an update can assign a task or set a due date (#755), read from the update without
 * applying it: the full check, which copies the whole board, runs only then. An item can change
 * what the check reads only by where it goes: under one of TASK_KEYS, or anywhere inside a type
 * held under one of VALUE_KEYS. A first value carries its place; a new value of a key that had one,
 * and content inside a type, carry only their origin, which sits in the same place: in the
 * document, earlier in the update, or in the structs Yjs holds back. A deletion is read the same
 * way, from the items it removes; one removed with its parent (a whole card, a whole item) changes
 * nothing that remains. Anything that can't be resolved here gets the full check.
 */
export function mayTouchTasks(document: Y.Doc, update: Uint8Array): boolean {
  const { store } = document;
  try {
    // decodeUpdate fails on some structs that applyUpdate reads (caught below).
    const { structs, ds } = Y.decodeUpdate(update);
    // Structs Yjs holds back (pending) were never checked (they could not be read yet). The next
    // update integrates them once a clock they wait for is there: one it brings, or one the
    // server wrote itself since. They count as part of such an update (#880 review); any other
    // update leaves them where they are.
    const pending = store.pendingStructs;
    let held: Struct[] | undefined;
    const heldStructs = () => {
      held ??= pending ? Y.decodeUpdateV2(pending.update).structs : [];
      return held;
    };
    // How far each client's clocks reach once the update is in: Yjs integrates a client's structs
    // only in order from the clock it has, so a sender past a gap reaches no further.
    const reach = (client: number) => reached.get(client) ?? Y.getState(store, client);
    const reached = new Map<number, number>();
    for (const s of [...structs].sort((a, b) => a.id.clock - b.id.clock))
      if (s.id.clock <= reach(s.id.client))
        reached.set(s.id.client, Math.max(reach(s.id.client), s.id.clock + s.length));
    const releases =
      pending !== null && [...pending.missing].some(([client, clock]) => clock < reach(client));
    // The structs of each client in clock order, for a binary search: those of the update, then
    // the held ones, decoded only when an origin is not found elsewhere.
    const index = (list: Struct[]) => {
      const byClient = new Map<number, Struct[]>();
      for (const s of list) {
        const structs = byClient.get(s.id.client);
        if (structs) structs.push(s);
        else byClient.set(s.id.client, [s]);
      }
      for (const structs of byClient.values()) structs.sort((a, b) => a.id.clock - b.id.clock);
      return byClient;
    };
    const search = (byClient: Map<number, Struct[]>, id: Y.ID) => {
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
    const sent = index(structs);
    // decodeUpdate yields every block of a client, where applyUpdate keeps the last: two structs
    // with the same clocks can't tell which one an origin names.
    for (const list of sent.values())
      for (let i = 1, end = list[0]?.id.clock ?? 0; i <= list.length; i++) {
        const next = list[i - 1];
        if (!next || (i > 1 && next.id.clock < end)) return true;
        end = next.id.clock + next.length;
      }
    let heldIndex: Map<number, Struct[]> | undefined;
    const find = (id: Y.ID): Struct | undefined => {
      if (id.clock < Y.getState(store, id.client)) return Y.getItem(store, id);
      const found = search(sent, id);
      if (found || !pending) return found;
      heldIndex ??= index(heldStructs());
      return search(heldIndex, id);
    };
    // Longer than anything there is to read, nesting of the board included: a cycle, which only a
    // malformed update makes. The held structs are fewer than their bytes.
    const limit = structs.length + (pending?.update.length ?? 0) + 1000;
    // The place of each item read so far: a chain of origins is walked once, not once per item,
    // so a long chained update stays linear (#880 review).
    const places = new Map<Struct, Place>();
    const placeOf = (first: Struct | undefined): Place => {
      const chain: Struct[] = [];
      let s = first;
      let place: Place;
      for (;;) {
        if (!(s instanceof Y.Item)) break;
        if (places.has(s)) {
          place = places.get(s);
          break;
        }
        // In the document, or a decoded item that names a root type itself.
        if (s.parent instanceof Y.AbstractType) {
          place = {
            parent: s.parent._item,
            key: s.parentSub,
            root: s.parent._item ? undefined : s.parent,
          };
          break;
        }
        chain.push(s);
        // A decoded item names its parent and key only when it has no origin.
        const origin = s.origin ?? s.rightOrigin;
        if (!origin) {
          const parent = s.parent as Y.ID | string | null;
          if (typeof parent === 'string')
            place = { parent: null, key: s.parentSub, root: document.share.get(parent) ?? parent };
          else if (parent) {
            const type = find(parent);
            if (type instanceof Y.Item) place = { parent: type, key: s.parentSub };
          }
          break;
        }
        s = find(origin);
        if (chain.length > limit) break;
      }
      for (const c of chain) places.set(c, place);
      return place;
    };
    /** Whether a type is held, at any depth, under one of VALUE_KEYS. */
    const inValue = new Map<Y.Item, boolean>();
    const heldInValue = (type: Y.Item | null): boolean => {
      const path: Y.Item[] = [];
      let found = false;
      while (type) {
        const known = inValue.get(type);
        if (known !== undefined) {
          found = known;
          break;
        }
        path.push(type);
        const place = placeOf(type);
        if (!place || (place.key !== null && VALUE_KEYS.has(place.key)) || path.length > limit) {
          found = true;
          break;
        }
        type = place.parent;
      }
      for (const t of path) inValue.set(t, found);
      return found;
    };
    const touches = (place: Place) =>
      !place || (place.key !== null && TASK_KEYS.has(place.key)) || heldInValue(place.parent);
    // Ids are not unique on every board, and by key the last of the items that share one is the
    // one shown: removing it, or the card that holds it, shows another's assignee. The items and
    // cards concerned, read only when an update removes or replaces a card or an item.
    let sharing: Set<unknown> | undefined;
    const showsAnother = (item: Y.Item | undefined) => {
      if (!(item?.content instanceof Y.ContentType)) return false;
      if (!sharing) {
        sharing = new Set();
        const byKey = new Map<string, Array<{ item: Y.Map<unknown>; card: Y.Map<unknown> }>>();
        for (const entry of eachTodoItem(document)) {
          const list = byKey.get(entry.key);
          if (list) list.push(entry);
          else byKey.set(entry.key, [entry]);
        }
        for (const list of byKey.values())
          if (list.length > 1) for (const { item, card } of list) sharing.add(item).add(card);
      }
      return sharing.has(item.content.type);
    };
    const elements = roots(document).elements;
    /** A card that a new value of its key in `elements` replaces. */
    const replaced = (place: Place) =>
      place?.parent === null && place.key !== null ? elements._map.get(place.key) : undefined;

    /** Whether an item names the place of the one Yjs puts it after when it overlaps that one. */
    const sameAs = (s: Y.Item, left: Struct | undefined) => {
      const a = placeOf(s);
      const b = left instanceof Y.Item ? placeOf(left) : undefined;
      return !!a && !!b && a.parent === b.parent && a.key === b.key && a.root === b.root;
    };
    /**
     * Whether an item can change what the check reads. One that overlaps clocks the board holds
     * goes after the item before them: when it names another place, or that one is gone, the
     * full check (which also refuses an item held in another place than it is stored) reads it.
     */
    const read = (s: Struct, released: boolean) => {
      if (!(s instanceof Y.Item)) return false;
      const { client, clock } = s.id;
      const state = Y.getState(store, client);
      const end = clock + s.length;
      if (clock < state && end > state && !sameAs(s, find(Y.createID(client, state - 1))))
        return true;
      // Released after this update's structs of its client: after any of those it overlaps.
      if (released && clock < reach(client) && end > state)
        for (const u of sent.get(client) ?? [])
          if (u.id.clock <= end - 2 && u.id.clock + u.length > clock && !sameAs(s, u)) return true;
      const place = placeOf(s);
      return touches(place) || showsAnother(replaced(place));
    };
    // Structs past a sender's gap are held back with the rest, and read when those are released.
    // An item of no length at the end of what a client has is integrated too.
    const readAll = (list: Struct[], released: boolean) =>
      list.some((s) => (releases || s.id.clock <= reach(s.id.client)) && read(s, released));
    if (readAll(structs, false) || (releases && readAll(heldStructs(), true))) return true;

    // Deletions of items the document holds, with those Yjs holds back (applied with every update).
    // Those of items it doesn't have yet apply to the structs read above, in the place read there.
    const deletions = [ds.clients];
    if (store.pendingDs) deletions.push(Y.decodeUpdateV2(store.pendingDs).ds.clients);
    const removed = new Set<Y.Item>();
    for (const [client, ranges] of deletions.flatMap((clients) => [...clients])) {
      const list = store.clients.get(client);
      if (!list) continue;
      const state = Y.getState(store, client);
      for (const { clock, len } of ranges) {
        const end = Math.min(clock + len, state);
        if (clock >= end) continue;
        for (let i = Y.findIndexSS(list, clock); i < list.length; i++) {
          const s = list[i];
          if (!s || s.id.clock >= end) break;
          if (s instanceof Y.Item && !s.deleted) removed.add(s);
        }
      }
    }
    for (const item of removed) {
      const parent = (item.parent as Y.AbstractType<unknown>)._item;
      if (parent && removed.has(parent)) continue;
      if (touches(placeOf(item)) || showsAnother(item)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * A copy of the board that holds back what the board holds back, as it holds it: encoding the
 * board merges those structs into its state, which can place them otherwise.
 */
function copyOf(document: Y.Doc) {
  const { store } = document;
  const { pendingStructs, pendingDs } = store;
  let state: Uint8Array;
  try {
    store.pendingStructs = null;
    store.pendingDs = null;
    state = Y.encodeStateAsUpdate(document);
  } finally {
    store.pendingStructs = pendingStructs;
    store.pendingDs = pendingDs;
  }
  const copy = new Y.Doc({ gc: document.gc });
  Y.applyUpdate(copy, state);
  if (pendingStructs) Y.applyUpdateV2(copy, pendingStructs.update);
  if (pendingDs) Y.applyUpdateV2(copy, pendingDs);
  return copy;
}

/**
 * Whether every item integrated since `before` sits where it is written: in the parent and under
 * the key of its origins. Yjs writes an item with its origin only, so every copy read from what
 * the server stores or sends places it there; an item that overlaps clocks already held is kept
 * under the parent it names instead, which no Yjs client writes.
 */
function placedAsWritten(doc: Y.Doc, before: Map<number, number>) {
  for (const [client, structs] of doc.store.clients) {
    const from = before.get(client) ?? 0;
    if (from >= Y.getState(doc.store, client)) continue;
    for (let i = Y.findIndexSS(structs, from); i < structs.length; i++) {
      const item = structs[i];
      if (!(item instanceof Y.Item)) continue;
      for (const id of [item.origin, item.rightOrigin]) {
        const next = id && Y.getItem(doc.store, id);
        if (
          next instanceof Y.Item &&
          (next.parent !== item.parent || next.parentSub !== item.parentSub)
        )
          return false;
      }
    }
  }
  return true;
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
  if (!mayTouchTasks(document, update)) return;
  const candidate = copyOf(document);
  try {
    const integratedFrom = Y.decodeStateVector(Y.encodeStateVector(candidate));
    Y.applyUpdate(candidate, update);
    if (!placedAsWritten(candidate, integratedFrom))
      throw new Error('Update places items elsewhere than it stores them');
    let assigns = false;
    const check = (item: Y.Map<unknown>, was: Y.Map<unknown> | undefined) => {
      const assigneeId = item.get('assigneeId');
      const dueDate = item.get('dueDate');
      const newAssignee = assigneeId !== was?.get('assigneeId');
      // What is already stored can't be helped by refusing this sender.
      if (!newAssignee && dueDate === was?.get('dueDate')) return;
      TaskFields.parse({ assigneeId, dueDate });
      if (newAssignee && assigneeId) assigns = true;
    };
    const stored = rawTodoItems(document);
    for (const [key, { item }] of rawTodoItems(candidate)) check(item, stored.get(key)?.item);
    // Ids are not unique on every board: an item that shares one with another hides it from the
    // check by key above. Each item also against itself, by its Yjs id, which is unique; one whose
    // key changed counts as new there, as it does by key.
    const yjsId = (item: Y.Map<unknown>) => `${item._item?.id.client}:${item._item?.id.clock}`;
    const before = new Map<string, { key: string; item: Y.Map<unknown> }>();
    for (const entry of eachTodoItem(document)) before.set(yjsId(entry.item), entry);
    for (const { key, item } of eachTodoItem(candidate)) {
      const was = before.get(yjsId(item));
      check(item, was?.key === key ? was.item : undefined);
    }
    if (!assigns) return;
    if (!actorId) throw new Error('Guests cannot assign tasks');
    const access = await boardRole(db, { id: actorId }, boardId);
    if (!access?.role || !atLeast(access.role, 'editor'))
      throw new Error('Assignment requires editor access');
  } finally {
    candidate.destroy();
  }
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
