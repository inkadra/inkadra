// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { GuestPlanSheetQuery, PlanSheetQuery } from './plan-sheet.ts';

it('defaults to all setups, the team copy and the plan’s own parts', () => {
  expect(PlanSheetQuery.parse({})).toEqual({ setups: 'all', audience: 'team' });
  expect(GuestPlanSheetQuery.parse({})).toEqual({ setups: 'all' });
});

it('reads include as a set of known parts', () => {
  const query = PlanSheetQuery.parse({ include: 'legend,grid,legend', setups: 'this' });
  expect(query.include).toEqual(new Set(['legend', 'grid']));
  expect(PlanSheetQuery.parse({ include: '' }).include).toEqual(new Set());
  expect(PlanSheetQuery.safeParse({ include: 'legend,map' }).success).toBe(false);
});

it('takes only the app languages', () => {
  expect(PlanSheetQuery.parse({ lang: 'pt' }).lang).toBe('pt');
  expect(PlanSheetQuery.safeParse({ lang: 'ja' }).success).toBe(false);
  expect(PlanSheetQuery.safeParse({ lang: 'en-US' }).success).toBe(false);
});

it('lets members choose the audience, never guests', () => {
  expect(PlanSheetQuery.parse({ audience: 'client' }).audience).toBe('client');
  expect(PlanSheetQuery.safeParse({ audience: 'crew' }).success).toBe(false);
  expect(GuestPlanSheetQuery.safeParse({ audience: 'team' }).success).toBe(false);
  expect(GuestPlanSheetQuery.safeParse({ audience: 'client' }).success).toBe(false);
});
