import { readElement, roots, TodoItem } from '@inkadra/doc-schema';
import type { MyTask } from '@inkadra/shared';
import { and, eq, isNull } from 'drizzle-orm';
import * as Y from 'yjs';
import { activeMember, boardRoles, projectRole, boardRole, atLeast } from './access.ts';
import type { Database } from './db/client.ts';
import { board, boardDoc, project, projectMember } from './db/schema.ts';
import { notify, Recipients } from './notifications.ts';

export function assignedItems(doc: Y.Doc) {
  const items = new Map<string, { elementId: string; itemId: string; assigneeId: string }>();
  for (const map of roots(doc).elements.values()) {
    const el = readElement(map);
    if (el?.type !== 'todo') continue;
    for (const item of el.items) if (item.assigneeId)
      items.set(`${el.id}:${item.id}`, { elementId: el.id, itemId: item.id, assigneeId: item.assigneeId });
  }
  return items;
}

/** Recheck both sides at the notification boundary; share-link guests have no actor id. */
export async function notifyAssignment(db: Database, boardId: string, elementId: string, assigneeId: string, actorId: string) {
  const access = await boardRole(db, { id: actorId }, boardId);
  if (!access?.role || !atLeast(access.role, 'editor')) return false;
  if (!await projectRole(db, { id: assigneeId }, access.board.projectId)) return false;
  await notify(db, { actor: { userId: actorId }, projectId: access.board.projectId, boardId, elementId }, new Recipients(actorId).add(assigneeId, 'task_assigned'));
  return true;
}

export function tasksInDoc(doc: Y.Doc, userId: string, place: Omit<MyTask, 'itemId' | 'elementId' | 'text' | 'dueDate'>): MyTask[] {
  const result: MyTask[] = [];
  for (const map of roots(doc).elements.values()) {
    const el = readElement(map);
    if (el?.type !== 'todo') continue;
    for (const item of el.items) if (!item.done && item.assigneeId === userId)
      result.push({ ...place, elementId: el.id, itemId: item.id, text: item.text, ...(item.dueDate ? { dueDate: item.dueDate } : {}) });
  }
  return result;
}

export async function myTasks(db: Database, userId: string): Promise<MyTask[]> {
  const rows = await db.select({ board, projectName: project.name, state: boardDoc.state })
    .from(projectMember).innerJoin(project, eq(project.id, projectMember.projectId))
    .innerJoin(board, eq(board.projectId, project.id)).innerJoin(boardDoc, eq(boardDoc.boardId, board.id))
    .where(and(eq(projectMember.userId, userId), activeMember(), isNull(project.archivedAt), isNull(board.deletedAt)));
  const readable = await boardRoles(db, { id: userId }, rows.map(r => r.board.id));
  const items: MyTask[] = [];
  for (const row of rows) {
    if (!readable.has(row.board.id)) continue;
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, row.state);
      items.push(...tasksInDoc(doc, userId, { projectId: row.board.projectId, projectName: row.projectName, boardId: row.board.id, boardTitle: row.board.title }));
    } finally { doc.destroy(); }
  }
  return items.sort((a,b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.text.localeCompare(b.text));
}

/** Validate a prospective CRDT update before broadcasting or storing it. */
export async function validateTaskUpdate(db: Database, boardId: string, actorId: string | undefined, document: Y.Doc, update: Uint8Array) {
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
    Y.applyUpdate(candidate, update);
    const before = assignedItems(document);
    const changed = new Set<string>();
    for (const map of roots(candidate).elements.values()) {
      if (map.get('type') !== 'todo') continue;
      const items = map.get('items');
      if (!(items instanceof Y.Array)) continue;
      for (const item of items) {
        if (!(item instanceof Y.Map)) continue;
        if (!item.has('assigneeId') && !item.has('dueDate')) continue;
        const parsed = TodoItem.parse(item.toJSON());
        if (parsed.assigneeId && before.get(`${map.get('id')}:${parsed.id}`)?.assigneeId !== parsed.assigneeId)
          changed.add(parsed.assigneeId);
      }
    }
    if (!changed.size) return;
    if (!actorId) throw new Error('Guests cannot assign tasks');
    const access = await boardRole(db, { id: actorId }, boardId);
    if (!access?.role || !atLeast(access.role, 'editor')) throw new Error('Assignment requires editor access');
    for (const id of changed) if (!await projectRole(db, { id }, access.board.projectId)) throw new Error('Assignee must be a project member');
  } finally { candidate.destroy(); }
}
