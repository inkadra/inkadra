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
