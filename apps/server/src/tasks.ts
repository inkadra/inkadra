import { roots, TodoItem } from '@inkadra/doc-schema';
import type { MyTask } from '@inkadra/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import { type OpenTask, openTasks } from './board-preview.ts';
import { activeMember, atLeast, boardRole, boardRoles, projectRole } from './access.ts';
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
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
    Y.applyUpdate(candidate, update);
    const stored = rawTodoItems(document);
    let assigns = false;
    for (const [key, { item }] of rawTodoItems(candidate)) {
      const was = stored.get(key)?.item;
      const assigneeId = item.get('assigneeId');
      const dueDate = item.get('dueDate');
      const newAssignee = assigneeId !== was?.get('assigneeId');
      // What is already stored can't be helped by refusing this sender.
      if (!newAssignee && dueDate === was?.get('dueDate')) continue;
      TaskFields.parse({ assigneeId, dueDate });
      if (newAssignee && assigneeId) assigns = true;
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
