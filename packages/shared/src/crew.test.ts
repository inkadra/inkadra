// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import {
  BulkCreateCrew,
  CrewMemberInput,
  canMergeCrew,
  mergeCrewInputs,
  UpdateCrewMember,
} from './crew.ts';

const input = {
  name: ' Anna ',
  role: '1° AC',
  department: 'Camera',
  phone: 'Agent: +39 123456789',
  email: '',
  pickup: '',
  notes: '',
  userId: null,
  character: null,
  onSetContact: false,
  position: 0,
};
it('validates free text, optional links and trimmed names', () => {
  expect(CrewMemberInput.parse(input).name).toBe('Anna');
});
it('rejects untrusted fields and invalid links', () => {
  for (const change of [
    { name: ' ' },
    { email: 'invalid' },
    { userId: 'not-an-id' },
    { position: -1 },
    { notes: 'x'.repeat(10001) },
    { admin: true },
  ])
    expect(CrewMemberInput.safeParse({ ...input, ...change }).success).toBe(false);
});
it('requires a positive revision for updates and bounds bulk requests', () => {
  expect(UpdateCrewMember.safeParse(input).success).toBe(false);
  expect(UpdateCrewMember.safeParse({ ...input, revision: 1 }).success).toBe(true);
  expect(BulkCreateCrew.safeParse({ items: [] }).success).toBe(false);
  expect(BulkCreateCrew.safeParse({ items: Array(501).fill(input) }).success).toBe(false);
});
it('merges two rows without losing a link', () => {
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  const card = { boardId: a, elementId: 'el1' };
  expect(canMergeCrew({ userId: a, character: null }, { userId: null, character: card })).toBe(
    true,
  );
  expect(canMergeCrew({ userId: a, character: card }, { userId: a, character: { ...card } })).toBe(
    true,
  );
  expect(canMergeCrew({ userId: a, character: null }, { userId: b, character: null })).toBe(false);
  expect(
    canMergeCrew(
      { userId: null, character: card },
      { userId: null, character: { ...card, elementId: 'el2' } },
    ),
  ).toBe(false);
  const kept = { ...input, name: 'Anna', phone: '', pickup: 'Hotel', userId: null };
  const other = {
    ...input,
    phone: '333',
    pickup: 'Home',
    userId: a,
    character: card,
    onSetContact: true,
  };
  expect(mergeCrewInputs(kept, other)).toMatchObject({
    name: 'Anna',
    phone: '333',
    pickup: 'Hotel',
    userId: a,
    character: card,
    onSetContact: true,
    position: 0,
  });
});
