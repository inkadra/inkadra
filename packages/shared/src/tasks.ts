// SPDX-License-Identifier: MPL-2.0
import { Id, z } from './common.ts';
export const MyTask = z
  .object({
    projectId: Id,
    projectName: z.string(),
    boardId: Id,
    boardTitle: z.string(),
    elementId: z.string(),
    itemId: z.string(),
    text: z.string(),
    dueDate: z.iso.date().optional(),
  })
  .openapi('MyTask');
export type MyTask = z.infer<typeof MyTask>;
export const MyTasks = z.object({ items: z.array(MyTask) }).openapi('MyTasks');
