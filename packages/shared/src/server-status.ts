// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';
import { DiagnosticCheck } from './instance.ts';

/**
 * The Server page of the settings (#514): health, resources, jobs, problems and alerts of the
 * instance, for administrators only. Every role (web, collab, worker) samples its own container
 * every 5 s; the history keeps 7 days, coarser for the longer ranges. Texts are not part of
 * the payload: clients translate kinds and statuses. Nothing here carries board content.
 */

export const ServerRole = z.enum(['web', 'collab', 'worker', 'all']).openapi({
  description: '`all`: one process runs every role (the single-container setup).',
});
export type ServerRole = z.infer<typeof ServerRole>;

export const ServerRange = z.enum(['15m', '1h', '24h', '7d']);
export type ServerRange = z.infer<typeof ServerRange>;

export const ServerStatusQuery = z.object({ range: ServerRange.default('1h') });

export const ServerSample = z
  .object({
    t: Timestamp,
    cpu: z.number().nullable().openapi({ description: 'Percent of the cores Inkadra may use.' }),
    memory: z.number().int().nullable().openapi({ description: 'Bytes in use.' }),
    in: z.number().nullable().openapi({ description: 'Bytes per second received.' }),
    out: z.number().nullable().openapi({ description: 'Bytes per second sent.' }),
    p95: z.number().nullable().openapi({ description: 'Milliseconds, 95th percentile.' }),
    errors: z.number().nullable().openapi({ description: 'Share of answers that failed, 0–1.' }),
    people: z.number().int().nullable().openapi({ description: 'People on boards.' }),
  })
  .openapi('ServerSample');
export type ServerSample = z.infer<typeof ServerSample>;

export const ServerEvent = z
  .object({
    t: Timestamp,
    kind: z.enum(['videos', 'backup', 'backup_failed']),
    count: z.number().int().openapi({ description: 'Videos converted in that slice; 1 else.' }),
  })
  .openapi('ServerEvent');
export type ServerEvent = z.infer<typeof ServerEvent>;

export const ServerProcess = z
  .object({
    role: ServerRole,
    host: z.string().openapi({ description: 'Host name of the container.' }),
    startedAt: Timestamp,
    lastSeenAt: Timestamp,
    status: z.enum(['ok', 'late', 'down']).openapi({
      description: '`late`: no signal for 30 s; `down`: none for 90 s.',
    }),
    cpu: z.number().nullable().openapi({ description: 'Cores used by this process.' }),
    memory: z.number().int().nullable().openapi({ description: 'Resident bytes.' }),
  })
  .openapi('ServerProcess');
export type ServerProcess = z.infer<typeof ServerProcess>;

export const ServerServiceId = z.enum([
  'web',
  'collab',
  'worker',
  'database',
  'queue',
  'configuration',
]);
export type ServerServiceId = z.infer<typeof ServerServiceId>;

export const ServerService = z
  .object({
    id: ServerServiceId,
    status: z.enum(['ok', 'warning', 'down', 'off']).openapi({
      description: '`off`: not part of this setup (no queue without REDIS_URL).',
    }),
    since: Timestamp.nullable().openapi({ description: 'Last signal of a process role.' }),
    detail: z.string().nullable().openapi({ description: 'Versions, as `PostgreSQL 18`.' }),
  })
  .openapi('ServerService');
export type ServerService = z.infer<typeof ServerService>;

export const ServerNow = z
  .object({
    cpu: z.object({
      used: z.number().openapi({ description: 'Cores in use.' }),
      cores: z.number().openapi({ description: 'Cores Inkadra may use (cgroup limit or host).' }),
    }),
    memory: z.object({
      used: z.number().int(),
      limit: z.number().int().nullable(),
    }),
    network: z
      .object({
        in: z.number(),
        out: z.number(),
        todayIn: z.number(),
        todayOut: z.number(),
      })
      .nullable()
      .openapi({ description: 'Bytes per second and today, the Inkadra containers only.' }),
    responses: z.object({
      p95: z.number().nullable(),
      errors: z.number().nullable(),
    }),
  })
  .openapi('ServerNow');
export type ServerNow = z.infer<typeof ServerNow>;

export const ServerStorage = z
  .object({
    driver: z.enum(['local', 's3']),
    location: z.string().openapi({ description: 'DATA_DIR or the bucket name.' }),
    total: z.number().int().nullable().openapi({ description: 'Null on S3.' }),
    free: z.number().int().nullable(),
    used: z.number().int().openapi({ description: 'The whole disk locally; files on S3.' }),
    originals: z.number().int(),
    copies: z.number().int().openapi({ description: 'Playable video and audio copies.' }),
    previews: z.number().int().openapi({ description: 'Thumbnails and waveforms.' }),
    growthPerMonth: z.number().int().nullable().openapi({
      description: 'Originals added in the last 30 days.',
    }),
    monthsLeft: z.number().nullable().openapi({ description: 'Null without a total.' }),
  })
  .openapi('ServerStorage');
export type ServerStorage = z.infer<typeof ServerStorage>;

export const ServerBackup = z
  .object({
    enabled: z.boolean(),
    lastAt: Timestamp.nullable(),
    lastStatus: z.enum(['running', 'ready', 'failed']).nullable(),
    size: z.number().int().nullable(),
    nextAt: Timestamp.nullable(),
    lastSuccessAt: Timestamp.nullable().optional().openapi({
      description:
        'When the last backup that succeeded finished; null without one. Older servers leave ' +
        'it out.',
    }),
  })
  .openapi('ServerBackup');
export type ServerBackup = z.infer<typeof ServerBackup>;

export const ServerQueueId = z.enum([
  'proxies',
  'media',
  'office',
  'transfers',
  'email',
  'maintenance',
]);
export type ServerQueueId = z.infer<typeof ServerQueueId>;

export const ServerQueue = z
  .object({
    id: ServerQueueId,
    waiting: z.number().int(),
    active: z.number().int(),
    failed24h: z.number().int(),
  })
  .openapi('ServerQueue');
export type ServerQueue = z.infer<typeof ServerQueue>;

export const ServerTranscode = z
  .object({
    assetId: Id,
    name: z.string().nullable().openapi({
      description: 'Null for a file of a project the administrator is not a member of.',
    }),
    progress: z.number().int().min(0).max(100),
    secondsLeft: z.number().int().nullable(),
    speed: z.number().nullable().openapi({ description: 'Times real time.' }),
    source: z.string().nullable().openapi({ description: 'Codec and lines, as `prores 2160p`.' }),
    target: z.string().nullable().openapi({ description: 'As `h264 1080p`.' }),
  })
  .openapi('ServerTranscode');
export type ServerTranscode = z.infer<typeof ServerTranscode>;

export const ServerTranscodes = z
  .object({
    active: z.array(ServerTranscode),
    waiting: z.number().int(),
    readyToday: z.number().int(),
    failedToday: z.number().int(),
    averageSeconds: z.number().nullable(),
  })
  .openapi('ServerTranscodes');
export type ServerTranscodes = z.infer<typeof ServerTranscodes>;

export const ServerPresenceBoard = z
  .object({
    boardId: Id.nullable().openapi({
      description: 'Null, as title and project, on a board the administrator cannot open.',
    }),
    title: z.string().nullable(),
    projectName: z.string().nullable(),
    since: Timestamp,
    count: z.number().int(),
    people: z
      .array(z.object({ id: Id, name: z.string(), image: z.string().nullable() }))
      .openapi({ description: 'Empty on a board the administrator cannot open.' }),
  })
  .openapi('ServerPresenceBoard');
export type ServerPresenceBoard = z.infer<typeof ServerPresenceBoard>;

export const ServerProblemKind = z
  .enum([
    'video_failed',
    'preview_failed',
    'office_failed',
    'email_failed',
    'transfer_failed',
    'job_failed',
    'backup_failed',
    'disk_full',
    'service_down',
    'server_error',
    'config_check',
  ])
  .openapi({
    description:
      'Open list: clients show a kind they do not know with the generic text. `config_check`: ' +
      'a failing diagnostic check (`checkId`), gone once it passes; it cannot be marked seen.',
  });
export type ServerProblemKind = z.infer<typeof ServerProblemKind>;

export const ServerProblem = z
  .object({
    id: z.string().min(1).max(200),
    kind: ServerProblemKind,
    severity: z.enum(['error', 'warning']),
    role: ServerRole,
    firstAt: Timestamp,
    lastAt: Timestamp,
    count: z.number().int(),
    seen: z.boolean().openapi({ description: 'Marked seen and not happened again since.' }),
    retry: z.boolean().openapi({ description: 'Whether `retry` can run it again.' }),
    technical: z.string().max(2000).openapi({
      description: 'Where and what failed, without file contents, names or addresses.',
    }),
    checkId: z.string().nullable(),
    service: ServerServiceId.nullable(),
    file: z.string().nullable().openapi({
      description: 'File the problem is about; null when the administrator cannot see it.',
    }),
    board: z.string().nullable().openapi({ description: 'Its board, under the same rule.' }),
  })
  .openapi('ServerProblem');
export type ServerProblem = z.infer<typeof ServerProblem>;

export const ServerAlerts = z
  .object({
    enabled: z.boolean().openapi({
      description:
        'Tell every administrator when the disk is almost full, a service stops answering, a ' +
        'backup fails or an error keeps happening.',
    }),
    email: z.boolean().openapi({
      description: 'Email too, for serious problems only and at most once an hour.',
    }),
  })
  .openapi('ServerAlerts');
export type ServerAlerts = z.infer<typeof ServerAlerts>;

export const UpdateServerAlerts = ServerAlerts.partial().openapi('UpdateServerAlerts');
export type UpdateServerAlerts = z.infer<typeof UpdateServerAlerts>;

export const DEFAULT_SERVER_ALERTS: ServerAlerts = { enabled: true, email: false };

export const ServerStatus = z
  .object({
    checkedAt: Timestamp,
    version: z.string(),
    image: z
      .string()
      .nullable()
      .openapi({ description: 'Image flavour: `standard` or `office`; null outside Docker.' }),
    startedAt: Timestamp.nullable().openapi({ description: 'Oldest running process.' }),
    range: ServerRange,
    step: z.number().int().openapi({ description: 'Seconds between history points.' }),
    history: z.array(ServerSample),
    events: z.array(ServerEvent),
    now: ServerNow,
    processes: z.array(ServerProcess),
    services: z.array(ServerService),
    storage: ServerStorage,
    backup: ServerBackup,
    database: z.object({
      version: z.string().nullable(),
      size: z.number().int().nullable(),
      connections: z.number().int().nullable(),
    }),
    encoder: z.object({ backend: z.string(), label: z.string() }).nullable(),
    queues: z.array(ServerQueue),
    transcodes: ServerTranscodes,
    presence: z.object({
      people: z.number().int(),
      boards: z.array(ServerPresenceBoard),
      peak: z.number().int().nullable().openapi({ description: 'Most people at once in range.' }),
    }),
    checks: z.array(DiagnosticCheck),
    problems: z.array(ServerProblem),
    alerts: ServerAlerts,
  })
  .openapi('ServerStatus');
export type ServerStatus = z.infer<typeof ServerStatus>;

/**
 * Capability on `GET /instance/version` of servers that answer `GET /instance/server/live`: the
 * values of now and the newest history points, read from the monitor store alone (no database).
 */
export const SERVER_LIVE_CAPABILITY = 'server-live';

export const ServerLive = z
  .object({
    checkedAt: Timestamp,
    range: ServerRange,
    step: z.number().int().openapi({ description: 'Seconds between history points.' }),
    history: z.array(ServerSample).openapi({
      description:
        'The newest points of `range`, at its step: a point replaces the one of the same `t` ' +
        'in the full history, the others come after it.',
    }),
    now: z.object({
      cpu: ServerNow.shape.cpu,
      memory: ServerNow.shape.memory,
      network: z
        .object({ in: z.number(), out: z.number() })
        .nullable()
        .openapi({ description: 'Bytes per second; today’s totals stay in the full status.' }),
      p95: z.number().nullable().openapi({ description: 'Milliseconds, the last 5 minutes.' }),
    }),
  })
  .openapi('ServerLive');
export type ServerLive = z.infer<typeof ServerLive>;

export const RetriedProblems = z.object({ retried: z.number().int() }).openapi('RetriedProblems');
export type RetriedProblems = z.infer<typeof RetriedProblems>;

/** What a `server_alert` notification is about (#514). */
export const ServerAlert = z
  .object({
    kind: z
      .enum([
        'disk_full',
        'service_down',
        'backup_failed',
        'repeated_errors',
        'storage_limit',
        'storage_request',
      ])
      .openapi({
        description:
          '`storage_limit`: the instance total passed the warning share (`free` left of ' +
          '`total`); `storage_request`: the actor asks for more space. Both open Settings ' +
          'Storage and Members; added with storage limits.',
      }),
    service: ServerServiceId.nullable(),
    free: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Bytes left, for `disk_full` and `storage_limit`.' }),
    total: z.number().int().nullable(),
    weeksLeft: z.number().nullable(),
    count: z.number().int().nullable().openapi({ description: 'For `repeated_errors`.' }),
  })
  .openapi('ServerAlert');
export type ServerAlert = z.infer<typeof ServerAlert>;
