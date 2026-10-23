import { z } from 'zod';

/**
 * Plain (JSON) view of the elements stored in a board document.
 * In the Y.Doc each element is a Y.Map with these fields; rich text lives in a Y.XmlFragment
 * under `body`, so it is not part of the plain view.
 */

/** Element id: 21 url-safe characters, generated on the client (see newElementId). */
export const ElementId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** Parent of the elements waiting in the "Non ordinati" column of a board. */
export const UNSORTED = 'unsorted';

const Base = z.object({
  id: ElementId,
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive().finite(),
  h: z.number().nonnegative().finite().optional().describe('Omitted = height follows content.'),
  z: z.string().min(1).describe('Fractional index; higher draws on top.'),
  parent: z
    .string()
    .nullable()
    .describe('Column element id, UNSORTED, or null when placed on the canvas.'),
  locked: z.boolean().optional(),
  createdBy: z.string().nullable(),
  createdAt: z.number().int(),
});

export const NoteElement = Base.extend({
  type: z.literal('note'),
  color: z.string().optional(),
});
export const ImageElement = Base.extend({
  type: z.literal('image'),
  assetId: z.string(),
  caption: z.string().max(2000).optional(),
});
export const LinkElement = Base.extend({
  type: z.literal('link'),
  url: z.url(),
  title: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  imageAssetId: z.string().optional(),
});
export const FileElement = Base.extend({
  type: z.literal('file'),
  assetId: z.string(),
});
export const TodoItem = z.object({ id: ElementId, text: z.string().max(2000), done: z.boolean() });
export const TodoElement = Base.extend({
  type: z.literal('todo'),
  title: z.string().max(200).optional(),
  items: z.array(TodoItem),
});
export const ColorElement = Base.extend({
  type: z.literal('color'),
  hex: z.string().regex(/^#[0-9A-F]{6}$/),
  label: z.string().max(80).optional(),
});
export const ColumnElement = Base.extend({
  type: z.literal('column'),
  title: z.string().max(200),
  collapsed: z.boolean().optional(),
});
export const BoardLinkElement = Base.extend({
  type: z.literal('board'),
  boardId: z.uuid(),
});

export const Element = z.discriminatedUnion('type', [
  NoteElement,
  ImageElement,
  LinkElement,
  FileElement,
  TodoElement,
  ColorElement,
  ColumnElement,
  BoardLinkElement,
]);
export type Element = z.infer<typeof Element>;
export type ElementType = Element['type'];

export const ELEMENT_TYPES = Element.options.map((o) => o.shape.type.value) as ElementType[];
