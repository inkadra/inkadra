// SPDX-License-Identifier: MPL-2.0
import { Id, orNull, Timestamp, z } from './common.ts';

/**
 * The load test run from Settings → Server (#908): the CLI's presets (#902) as a worker job of
 * the instance itself, with its own test account and project, stopped early when real people
 * feel it. Administrators only, signed-in session.
 */
export const LOAD_TEST_CAPABILITY = 'load-test';

export const LOAD_TEST_PRESETS = ['small', 'medium', 'large'] as const;
export const LoadTestPreset = z.enum(LOAD_TEST_PRESETS);
export type LoadTestPreset = z.infer<typeof LoadTestPreset>;

export const LoadTestLimits = z
  .object({
    editP95Ms: z.number(),
    editP99Ms: z.number(),
    deliveryP95Ms: z.number(),
    storeP95Ms: z.number(),
    poolWaitMaxMs: z.number(),
    rssMiB: z.number(),
    perBoardMiB: z.number(),
    docPerBoardKiB: z
      .number()
      .optional()
      .openapi({ description: 'Absent in reports of runs before it existed (#911).' }),
    errors: z.number(),
    reconnects: z.number(),
  })
  .openapi('LoadTestLimits');
export type LoadTestLimits = z.infer<typeof LoadTestLimits>;

const Times = z.object({
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  p99: z.number().nullable(),
  n: z.int().min(0),
});

/** The fields and limits of the CLI report (`pnpm loadtest`), and its text. */
export const LoadTestReport = z
  .object({
    preset: LoadTestPreset,
    durationS: z.number(),
    editors: z.int(),
    readers: z.int(),
    boards: z.int(),
    edits: z.int(),
    switches: z.int(),
    uploads: z.object({ ok: z.int(), failed: z.int() }),
    editMs: Times,
    deliveryMs: Times,
    errors: z.int().min(0),
    reconnects: z.int().min(0),
    server: z
      .object({
        baselineRssMiB: z.number(),
        peakRssMiB: z.number(),
        peakOpenBoards: z.number(),
        perBoardMiB: z.number().nullable().openapi({
          description: 'Resident memory growth at the peak over the boards open then.',
        }),
        perBoardInfo: z
          .string()
          .nullable()
          .optional()
          .openapi({
            description:
              'Why `perBoardMiB` is information only and not a limit: `shared_process`, the ' +
              'boards share an `all` ' +
              'process with other roles (and the load clients of a run from the settings), or ' +
              '`few_boards`, fewer than 20 were open at the peak. Null: it decides. Absent in older reports ' +
              '(#911); unknown values may come later.',
          }),
        docPerBoardKiB: z
          .number()
          .nullable()
          .optional()
          .openapi({
            description:
              'Largest mean encoded size of an open board document (Yjs) over the run; null when ' +
              'the server does not report it, absent in older reports (#911).',
          }),
        storeP95Ms: z.number().nullable(),
        storeMaxMs: z.number().nullable(),
        poolWaitMaxMs: z.number().nullable(),
        peakDbConnections: z.number().nullable(),
      })
      .nullable(),
    limits: LoadTestLimits,
    failures: z.array(z.string()).openapi({ description: 'Each limit exceeded, in English.' }),
    text: z.string().openapi({ description: 'The report as the CLI prints it.' }),
  })
  .openapi('LoadTestReport');
export type LoadTestReport = z.infer<typeof LoadTestReport>;

export const LoadTestProgress = z
  .object({
    phase: z.enum(['seeding', 'running', 'cleaning']),
    seeded: z.int().min(0).openapi({ description: 'Boards created so far.' }),
    boards: z.int().min(0),
    elapsedS: z.number().min(0).openapi({ description: 'Seconds of the run phase so far.' }),
    durationS: z.number(),
    edits: z.int().min(0),
    editP95Ms: z.number().nullable(),
    deliveryP95Ms: z.number().nullable(),
    errors: z.int().min(0),
    reconnects: z.int().min(0),
    storeP95Ms: z.number().nullable().openapi({ description: 'Board saves, all sessions.' }),
    apiP95Ms: z
      .number()
      .nullable()
      .openapi({ description: 'API answers to everyone but the test, last 30 s.' }),
  })
  .openapi('LoadTestProgress');
export type LoadTestProgress = z.infer<typeof LoadTestProgress>;

export const LOAD_TEST_STATUSES = [
  'scheduled',
  'running',
  'passed',
  'failed',
  'aborted',
  'stopped',
  'cancelled',
  'refused',
  'interrupted',
] as const;
export type LoadTestStatus = (typeof LOAD_TEST_STATUSES)[number];

/** Why a run was stopped by the guard (`aborted`) or not started (`refused`). */
export const LOAD_TEST_REASONS = [
  'store_slow',
  'api_slow',
  'api_errors',
  'edits_slow',
  'backup_running',
  'transfer_running',
  'loadtest_running',
  'under_load',
  'no_worker',
  'no_metrics',
  'shared_process',
  'internal',
] as const;

export const LoadTestRun = z
  .object({
    id: Id,
    preset: LoadTestPreset,
    status: z.enum(LOAD_TEST_STATUSES).openapi({
      description:
        '`aborted`: stopped by the guard because real people were affected (see `reason`); ' +
        '`stopped`: by an administrator; `refused`: not started (see `reason`); ' +
        '`interrupted`: the worker stopped during the run. Clients must treat unknown values ' +
        'as finished.',
    }),
    reason: z
      .string()
      .nullable()
      .openapi({
        description: `One of ${LOAD_TEST_REASONS.join(', ')}; unknown values may come later.`,
      }),
    scheduledFor: Timestamp.nullable().openapi({ description: 'Null for a run started now.' }),
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    progress: orNull(LoadTestProgress),
    report: orNull(LoadTestReport),
    cleanedUp: z.boolean().openapi({
      description: 'The test account, its project, boards and files are deleted.',
    }),
  })
  .openapi('LoadTestRun');
export type LoadTestRun = z.infer<typeof LoadTestRun>;

/** When the guard stops a run: two readings in a row past one of these. */
export const LoadTestGuard = z
  .object({
    storeP95Ms: z.number(),
    apiP95Ms: z.number(),
    apiErrorRate: z.number(),
    editP95Ms: z.number(),
  })
  .openapi('LoadTestGuard');
export type LoadTestGuard = z.infer<typeof LoadTestGuard>;

export const LoadTests = z
  .object({
    available: z
      .boolean()
      .openapi({ description: 'False without a worker (no REDIS_URL): runs cannot start.' }),
    timeZone: z.string().openapi({ description: 'Time zone of the server for `at`.' }),
    presets: z.array(
      z.object({
        name: LoadTestPreset,
        editors: z.int(),
        readers: z.int(),
        boards: z.int(),
        durationS: z.int(),
      }),
    ),
    guard: LoadTestGuard,
    separateWorker: z.boolean().openapi({
      description:
        'A worker role runs apart from the web and collaboration roles. Without one (`all` ' +
        'mode) the load clients share the live server’s event loop, and `large` is refused ' +
        '(`shared_process`).',
    }),
    items: z.array(LoadTestRun).openapi({ description: 'Newest first, at most 10.' }),
  })
  .openapi('LoadTests');
export type LoadTests = z.infer<typeof LoadTests>;

export const StartLoadTest = z
  .object({
    preset: LoadTestPreset,
    at: z
      .object({
        date: z.iso.date(),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .nullable()
      .optional()
      .openapi({
        description:
          'Wall-clock date and time in `timeZone`, within the next 7 days; absent or null: now.',
      }),
  })
  .strict()
  .openapi('StartLoadTest');
export type StartLoadTest = z.infer<typeof StartLoadTest>;
