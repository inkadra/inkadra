// SPDX-License-Identifier: MPL-2.0
import { z } from './common.ts';
export const CalendarFeed = z
  .object({ enabled: z.boolean(), url: z.url().nullable() })
  .openapi('CalendarFeed');
export type CalendarFeed = z.infer<typeof CalendarFeed>;
