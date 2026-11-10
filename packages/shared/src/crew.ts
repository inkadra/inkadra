// SPDX-License-Identifier: MPL-2.0
import { ElementRef } from './comments.ts';
import { Id, z } from './common.ts';
import { UserSummary } from './users.ts';

export const CrewMemberInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().max(500),
    department: z.string().trim().max(120),
    phone: z.string().max(500),
    email: z.union([z.email(), z.literal('')]),
    pickup: z.string().max(1000),
    notes: z.string().max(10000),
    userId: Id.nullable(),
    character: z.object({ boardId: Id, elementId: ElementRef }).strict().nullable(),
    onSetContact: z.boolean(),
    position: z.number().int().min(0),
  })
  .strict()
  .openapi('CrewMemberInput');
export type CrewMemberInput = z.infer<typeof CrewMemberInput>;
export const CrewMember = CrewMemberInput.extend({
  id: Id,
  projectId: Id,
  account: UserSummary.nullable().optional(),
  revision: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).openapi('CrewMember');
export type CrewMember = z.infer<typeof CrewMember>;
export const UpdateCrewMember = CrewMemberInput.extend({
  revision: z.number().int().min(1),
}).openapi('UpdateCrewMember');
/** Merges the row `from` into the row of the path, which is kept; both revisions are checked. */
export const MergeCrewMember = z
  .object({
    revision: z.number().int().min(1),
    from: Id,
    fromRevision: z.number().int().min(1),
  })
  .strict()
  .openapi('MergeCrewMember');
export type MergeCrewMember = z.infer<typeof MergeCrewMember>;

type CrewLinks = Pick<CrewMemberInput, 'userId' | 'character'>;
const sameCharacter = (a: CrewLinks['character'], b: CrewLinks['character']) =>
  a?.boardId === b?.boardId && a?.elementId === b?.elementId;
/**
 * Two rows can become one when no link is lost: a row holds one account and one character, so
 * rows linked to two different accounts or characters stay separate (one row per character, 0091).
 */
export const canMergeCrew = (a: CrewLinks, b: CrewLinks) =>
  (!a.userId || !b.userId || a.userId === b.userId) &&
  (!a.character || !b.character || sameCharacter(a.character, b.character));
/** The kept row's values win; its blanks are filled from the other row. */
export const mergeCrewInputs = (kept: CrewMemberInput, other: CrewMemberInput): CrewMemberInput => {
  const text = (key: 'role' | 'department' | 'phone' | 'email' | 'pickup' | 'notes') =>
    kept[key].trim() ? kept[key] : other[key];
  return {
    ...kept,
    role: text('role'),
    department: text('department'),
    phone: text('phone'),
    email: text('email'),
    pickup: text('pickup'),
    notes: text('notes'),
    userId: kept.userId ?? other.userId,
    character: kept.character ?? other.character,
    onSetContact: kept.onSetContact || other.onSetContact,
  };
};
export const BulkCreateCrew = z
  .object({ items: z.array(CrewMemberInput).min(1).max(500) })
  .strict()
  .openapi('BulkCreateCrew');
export const Crew = z.object({ items: z.array(CrewMember), nextCursor: z.null() }).openapi('Crew');
export type Crew = z.infer<typeof Crew>;

/** Character contacts are private too; the live board overrides this stored-board preview. */
export const CrewCharacter = z
  .object({
    boardId: Id,
    elementId: ElementRef,
    name: z.string(),
    actor: z.string(),
    contact: z.string(),
  })
  .openapi('CrewCharacter');
export type CrewCharacter = z.infer<typeof CrewCharacter>;
export const CrewCharacters = z.object({ items: z.array(CrewCharacter) }).openapi('CrewCharacters');
