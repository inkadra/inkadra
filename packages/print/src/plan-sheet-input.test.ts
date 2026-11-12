// SPDX-License-Identifier: MPL-2.0
import { listElements, PLAN_WORDS_EN, SHEET_WORDS_EN } from '@inkadra/canvas-core';
import { planSheetFixture } from '@inkadra/canvas-core/fixtures/plan-sheet';
import { wordsOf } from '@inkadra/canvas-core/fixtures/plan-words';
import { expect, it } from 'vitest';
import { PLAN_SHEET_INCLUDE } from './plan-sheet.ts';
import { planSheetInput, planSheetInputOf } from './plan-sheet-input.ts';

it("prints the shooting day of the plan's scene at the foot, for the team only", () => {
  const fixture = planSheetFixture();
  const request = {
    elements: listElements(fixture.doc),
    planIds: fixture.planIds,
    area: null,
    include: PLAN_SHEET_INCLUDE,
    t: wordsOf({ ...PLAN_WORDS_EN, ...SHEET_WORDS_EN }),
    locale: 'en',
    days: fixture.days,
  };
  const team = { audience: 'team', hideGuestHidden: false } as const;
  // The scene is first shot on the second day by date (and again on the third).
  expect(planSheetInput({ ...request, filter: team }).input.place).toBe(
    'Tavola calda Rosa · Day 2',
  );
  // Guests cannot read the schedule: their sheet prints no day, whatever it is given.
  const client = { audience: 'client', hideGuestHidden: true } as const;
  expect(planSheetInput({ ...request, filter: client }).input.place).toBe('Tavola calda Rosa');
  // Without "Date and scene", or without a day that shoots the scene, no day either.
  const without = { ...PLAN_SHEET_INCLUDE, dateScene: false };
  expect(planSheetInput({ ...request, include: without, filter: team }).input.place).toBe(
    'Tavola calda Rosa',
  );
  expect(planSheetInput({ ...request, days: [], filter: team }).input.place).toBe(
    'Tavola calda Rosa',
  );
});

it('prints no day on a client sheet built from its cards, whatever days it is given', () => {
  const fixture = planSheetFixture();
  const elements = listElements(fixture.doc);
  const request = {
    cards: new Map(elements.map((el) => [el.id, el])),
    labels: new Map<string, string>(),
    planIds: fixture.planIds,
    area: null,
    include: PLAN_SHEET_INCLUDE,
    t: wordsOf({ ...PLAN_WORDS_EN, ...SHEET_WORDS_EN }),
    locale: 'en',
    days: fixture.days,
  };
  // The team's, by default.
  expect(planSheetInputOf(request).place).toBe('Tavola calda Rosa · Day 2');
  expect(planSheetInputOf({ ...request, audience: 'team' }).place).toBe(
    'Tavola calda Rosa · Day 2',
  );
  // A caller that passes the schedule by mistake still prints no day for a guest (decision 0122).
  expect(planSheetInputOf({ ...request, audience: 'client' }).place).toBe('Tavola calda Rosa');
});
