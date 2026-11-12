// SPDX-License-Identifier: MPL-2.0
import { z } from './common.ts';

/**
 * The set plan sheet as a PDF rendered by the server (decision 0122), for clients that cannot
 * lay it out themselves (the mobile app first). Same pages as the web's Export → PDF.
 */

/** Capability on `GET /instance/version` of servers that answer the `…/plans/{planId}/sheet` routes. */
export const PLAN_SHEET_PDF_CAPABILITY = 'plan-sheet-pdf';

/** The languages of the app; the sheet's words exist in each. */
export const PlanSheetLanguage = z.enum(['en', 'it', 'es', 'de', 'fr', 'pt']);
export type PlanSheetLanguage = z.infer<typeof PlanSheetLanguage>;

/** Optional parts of the sheet, as the web dialog's switches. */
export const PlanSheetPart = z.enum([
  'legend',
  'kit',
  'power',
  'notes',
  'scale',
  'background',
  'dateScene',
  'grid',
]);
export type PlanSheetPart = z.infer<typeof PlanSheetPart>;

const include = z
  .string()
  .max(200)
  .transform((value, ctx) => {
    const parts = new Set<PlanSheetPart>();
    for (const item of value.split(',')) {
      const name = item.trim();
      if (name === '') continue;
      const part = PlanSheetPart.safeParse(name);
      if (part.success) parts.add(part.data);
      else ctx.addIssue({ code: 'custom', message: `Unknown part: ${name.slice(0, 20)}.` });
    }
    return parts;
  })
  .openapi({
    type: 'string',
    description:
      'Comma-separated parts to print (spaces around names are ignored): legend, kit, power, ' +
      'notes, scale, background, dateScene, grid. Empty prints none of them. Absent: the parts ' +
      'saved on the plan, as the web dialog opens with.',
    example: 'legend,kit,power,scale',
  });

const guestFields = {
  setups: z
    .enum(['this', 'all'])
    .default('all')
    .openapi({
      description:
        '`this`: only this plan. `all`: its family of setups, base first. A family of more than ' +
        '20 setups answers 400 with `all`; export it with `this`.',
    }),
  include: include.optional(),
  lang: PlanSheetLanguage.optional().openapi({
    description:
      'Language of the words on the sheet. Absent: the account language, then ' +
      '`Accept-Language`, then `en` (guests skip the account).',
  }),
};

/**
 * Query of `GET /boards/{boardId}/plans/{planId}/sheet`. Unknown parameters are ignored, as on
 * every route: clients find newer options through capabilities.
 */
export const PlanSheetQuery = z.object({
  ...guestFields,
  audience: z
    .enum(['team', 'client'])
    .default('team')
    .openapi({
      description:
        '`team`: every card, and "Day N" from the schedule. `client`: the client copy, ' +
        'without cards hidden from guests and without "Day N".',
    }),
});
export type PlanSheetQuery = z.infer<typeof PlanSheetQuery>;

/** Query of the guest route: no audience, the guest route always renders the client copy. */
export const GuestPlanSheetQuery = z.object(guestFields);
export type GuestPlanSheetQuery = z.infer<typeof GuestPlanSheetQuery>;
