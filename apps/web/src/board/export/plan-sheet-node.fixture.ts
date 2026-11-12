// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { PlanElement } from '@inkadra/canvas-core';
import type { PlanSheetFixture } from '@inkadra/canvas-core/fixtures/plan-sheet';
import i18next, { type TFunction } from 'i18next';
import { withManyForms } from '../../i18n/backend.ts';
import en from '../../i18n/en.json';
import it from '../../i18n/it.json';
import { planSheetEnv, planSheetRequest } from '../plan/PlanExport.tsx';
import { BoardStore } from '../store.ts';
import { ExportCache } from './cache.ts';
import { buildPages } from './engine.ts';
import type { Op, Page } from './pages.ts';
import { sheetInclude } from './plan-sheet.ts';

/**
 * For the tests that prove the set plan's sheet is made outside the browser (the server's PDF,
 * step 1): the web's own path from the "PDF" button of the plan's view, `planSheetRequest` and
 * `planSheetEnv` into `buildPages`, with what only a browser gives replaced by files.
 */

const require = createRequire(import.meta.url);

/** A file of a package, read from disk. */
export const packageFile = (path: string): Uint8Array => readFileSync(require.resolve(path));

/** The board the team's sheet reads the shooting schedule of, and the days it answers. */
const SCOPE = { projectId: 'project-fixture', boardId: 'board-fixture' };
let scheduled: PlanSheetFixture['days'] = [];

/**
 * `fetch` as the sheet asks it: the Inter files `fonts.ts` imports with Vite's `?url` are read
 * from `@expo-google-fonts/inter` on disk; the schedule answers the fixture's shooting days; the
 * asset API answers 404, so the background picture is not loaded (its decoder,
 * `createImageBitmap` and `OffscreenCanvas`, exists only in a browser) and a test gives its bytes
 * to the writer itself.
 */
export const fileFetch: typeof fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  const font = /Inter_(\d00[A-Za-z]+)\.ttf(?:\?|$)/.exec(url)?.[1];
  if (font)
    return new Response(
      packageFile(`@expo-google-fonts/inter/${font}/Inter_${font}.ttf`) as BlobPart,
      { status: 200 },
    );
  if (url.endsWith(`/boards/${SCOPE.boardId}/schedule`))
    return Response.json({ items: scheduled, nextCursor: null });
  return new Response(null, { status: 404 });
};

/** The words of the app in `lng`, read as the app reads its catalogues. */
async function words(lng: 'en' | 'it'): Promise<TFunction> {
  const i18n = i18next.createInstance();
  await i18n.init({
    resources: { en: { translation: en }, it: { translation: withManyForms(it) } },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return i18n.t;
}

export type SheetAudience = 'team' | 'guest';

/**
 * The request and environment of the read-only view's "PDF" for the fixture's three setups. The
 * team's reads the fixture's shooting days, when it has them, as a member's view does; a guest's
 * has no board to read them from.
 */
export async function sheetRequest(
  fixture: Pick<PlanSheetFixture, 'doc' | 'planIds'> & Partial<Pick<PlanSheetFixture, 'days'>>,
  audience: SheetAudience,
  lng: 'en' | 'it',
) {
  const store = new BoardStore(fixture.doc);
  const base = store.getSnapshot().byId.get(fixture.planIds[0]) as PlanElement;
  const t = await words(lng);
  const req = planSheetRequest(
    'pdf',
    fixture.planIds,
    null,
    sheetInclude(base),
    audience === 'guest',
  );
  const team = audience === 'team' && fixture.days;
  if (team) scheduled = fixture.days ?? [];
  return {
    req,
    env: planSheetEnv(store, base, t, lng, new ExportCache(), team ? SCOPE : undefined),
  };
}

/** The pages of the fixture's three setups as the read-only view's "PDF" makes them. */
export async function sheetOf(
  fixture: Pick<PlanSheetFixture, 'doc' | 'planIds'> & Partial<Pick<PlanSheetFixture, 'days'>>,
  audience: SheetAudience,
  lng: 'en' | 'it',
) {
  const { req, env } = await sheetRequest(fixture, audience, lng);
  return { req, env, built: await buildPages(req, env) };
}

/** Numbers to a thousandth of a point: a golden file that reads the same on every machine. */
const rounded = (_key: string, value: unknown) =>
  typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;

/**
 * The pages as text, one operation per line, a clip's operations indented under it: the golden
 * file the browser's and Node's sheets are both compared with.
 */
export function sheetText(pages: readonly Page[], missing: readonly string[]): string {
  const lines = missing.length ? [`missing glyphs: ${missing.join(' ')}`] : [];
  const walk = (ops: readonly Op[], indent: string) => {
    for (const op of ops) {
      if (op.kind === 'clip') {
        const { ops: inside, ...box } = op;
        lines.push(indent + JSON.stringify(box, rounded));
        walk(inside, `${indent}  `);
      } else lines.push(indent + JSON.stringify(op, rounded));
    }
  };
  pages.forEach((page, n) => {
    const { ops, ...rest } = page;
    lines.push(`page ${n + 1} ${JSON.stringify(rest, rounded)}`);
    walk(ops, '  ');
  });
  return `${lines.join('\n')}\n`;
}

/** A 48 × 32 JPEG floor plan, the background picture's bytes as the web gives them to the writer. */
export const FLOOR_PLAN_JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABrAAADAQEBAQAAAAAAAAAAAAAFBgABBAIHAQEBAQAAAAAAAAAAAAAAAAAAAQMQAAECAwQJBQEAAAAAAAAAAAECAwAEERVkk+IhBRNTQdGSURIxIrOCNHIRAQEAAAAAAAAAAAAAAAAAAACB/8AAEQgAIAAwAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8A+tzD6ZZpTqwSlNK+NK6SBxI7wJtG6TuDmjdagqknQASfZ6f2mDG3Z3jfUnnGag1o3Sdwc0Vo3Sdwc0GduzvG+pPOLbs7xvqTziwBrRuk7g5oLS76ZlpLqAQlVaeVK6CRwJ7R727O8b6k84D6qBTJNAgg+/1/tUQZrf8AC99PkTDHHFMMJmWlNLJCVUr40roIPEHtAmzr3O42WCmOKFyzr3O42WKzr3O42WAY4XNUfhZ+/wAiorOvc7jZYLS7CZZpLSCSlNaeVK6STwA7wH//2Q==',
  ),
  (c) => c.charCodeAt(0),
);
