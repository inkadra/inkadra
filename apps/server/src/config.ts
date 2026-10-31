import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optional = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const list = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PUBLIC_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  INSTANCE_NAME: z.string().min(1).default('Inkadra'),
  AUTH_RATE_LIMITS: z.enum(['on', 'off']).default('on'),
  /** Empty when unset: compose passes every variable, set or not. */
  CSP_REPORT_URI: z.preprocess(emptyToUndefined, z.url().optional()),
  CSP_ENFORCE: bool('false'),
  HSTS_ENABLED: bool('false'),
  OIDC_ALLOWED_DOMAINS: list,
  REGISTRATION: z.enum(['invite', 'open', 'closed']).default('invite'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  COLLAB_PORT: z.coerce.number().int().default(3001),
  DATA_DIR: z.string().default('/data'),
  WEB_DIST: z.string().optional(),
  /** Largest file an upload may have: bytes or a size such as `500MB`, `20GB`; 0 = no limit. */
  UPLOAD_MAX_SIZE: z.string().default('20GB').transform(parseSize),
  /** Largest project archive an import accepts, compressed and uncompressed; 0 = no limit. */
  IMPORT_MAX_SIZE: z.string().default('20GB').transform(parseSize),
  /** Where files live: `local` (DATA_DIR/files) or any S3-compatible bucket. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** Empty for AWS; the MinIO, Garage or R2 address otherwise. */
  S3_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** `true` for MinIO and most self-hosted S3 servers. */
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Decode HEIC/HEIF photos (iPhone) to make thumbnails. HEVC is covered by patents in some
   * countries: set to `false` to store HEIC files without previews.
   */
  HEIC_PREVIEWS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /**
   * Thumbnails of camera RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2) from the JPEG
   * preview the camera embedded, read with exiftool where the worker has it (decision 0048).
   */
  RAW_PREVIEWS: bool('true'),
  /** Thumbnails of page 1 of PDFs and their page count, with poppler where the worker has it. */
  PDF_PREVIEWS: bool('true'),
  /**
   * Playable H.264/AAC MP4 copies of videos browsers cannot play (ProRes, MKV, AVI, MXF, HEVC),
   * made by the worker when it has ffmpeg (decision 0048). `false` saves the storage they take.
   */
  VIDEO_PROXIES: bool('true'),
  /** Longest source, in seconds, that gets a copy; 0 = no limit. */
  VIDEO_PROXY_MAX_DURATION: z.coerce.number().int().min(0).default(7200),
  /** Largest source that gets a copy: bytes or a size such as `500MB`, `20GB`; 0 = no limit. */
  VIDEO_PROXY_MAX_SOURCE_SIZE: z.string().default('20GB').transform(parseSize),
  /** Shorter side of the copy, in pixels (1080 makes 1920×1080 at most); never upscaled. */
  VIDEO_PROXY_RESOLUTION: z.coerce.number().int().min(144).max(2160).default(1080),
  /** Peak video bitrate of the copy, as ffmpeg reads it (`5M`, `2500k`). */
  VIDEO_PROXY_BITRATE: z
    .string()
    .regex(/^\d+(\.\d+)?[kKmM]?$/, 'Use a bitrate such as 5M or 2500k')
    .default('5M'),
  /** Copies made at once by each worker; they are CPU heavy. */
  VIDEO_PROXY_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  /**
   * Which peers may set X-Forwarded-For: `false`, or a comma-separated list of addresses,
   * CIDRs or the presets `loopback`, `linklocal`, `uniquelocal` (private networks, where a
   * reverse proxy normally sits). `true` trusts everyone and lets clients pick their address.
   */
  TRUST_PROXY: z
    .string()
    .default('loopback,linklocal,uniquelocal')
    .transform((v): boolean | string => (v === 'true' || v === 'false' ? v === 'true' : v)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Sign in with Google: OAuth client of type "Web application" in Google Cloud. */
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  /** Comma-separated domains (`studio.it`) whose Google accounts may sign in; empty = any. */
  GOOGLE_ALLOWED_DOMAINS: list,
  /** One generic OpenID Connect provider (Authentik, Keycloak, Authelia, Pocket ID…). */
  OIDC_NAME: z.string().min(1).max(40).default('SSO'),
  /** The provider's `.well-known/openid-configuration` address. */
  OIDC_DISCOVERY_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  OIDC_CLIENT_ID: optional,
  OIDC_CLIENT_SECRET: optional,
  OIDC_SCOPES: z.string().default('openid email profile'),
  /** Link OIDC sign-ins to existing accounts with the same email. Only if the provider checks emails. */
  OIDC_TRUST_EMAIL: bool('false'),
  /** `smtp://user:password@host:587` or `smtps://…:465`. Without it no email is sent. */
  SMTP_URL: optional,
  MAIL_FROM: optional,
  /** Chrome extension ids allowed to ask for a token (`https://<id>.chromiumapp.org/`). */
  CLIPPER_EXTENSION_IDS: list,
});

const UNITS: Record<string, number> = {
  '': 1,
  B: 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
};

/** Parses `1048576`, `500MB`, `20 GB` or `2TiB` into bytes, with binary multiples. */
export function parseSize(value: string, ctx: z.RefinementCtx): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([KMGT]?)(?:I?B)?\s*$/i.exec(value);
  const unit = UNITS[m?.[2]?.toUpperCase() ?? ''];
  if (!m || unit === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Use bytes or a size such as 500MB or 20GB' });
    return z.NEVER;
  }
  return Math.floor(Number(m[1]) * unit);
}

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.superRefine((c, ctx) => {
    if (c.STORAGE_DRIVER === 's3' && !c.S3_BUCKET)
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'Required with STORAGE_DRIVER=s3',
      });
    for (const [a, b] of [
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      ['OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'],
      ['OIDC_CLIENT_ID', 'OIDC_DISCOVERY_URL'],
    ] as const) {
      if (Boolean(c[a]) !== Boolean(c[b]))
        ctx.addIssue({
          code: 'custom',
          path: [c[a] ? b : a],
          message: `Set together with ${c[a] ? a : b}`,
        });
    }
    if (c.SMTP_URL && !c.MAIL_FROM)
      ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'Required with SMTP_URL' });
  }).safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}\nSee .env.example.`);
  }
  return parsed.data;
}

export const VERSION = process.env.INKADRA_VERSION ?? '0.1.0-dev';
