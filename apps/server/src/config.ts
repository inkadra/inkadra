import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PUBLIC_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  INSTANCE_NAME: z.string().min(1).default('Inkadra'),
  REGISTRATION: z.enum(['invite', 'open']).default('invite'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  COLLAB_PORT: z.coerce.number().int().default(3001),
  DATA_DIR: z.string().default('/data'),
  WEB_DIST: z.string().optional(),
  /** Largest file an upload may have: bytes or a size such as `500MB`, `20GB`; 0 = no limit. */
  UPLOAD_MAX_SIZE: z.string().default('20GB').transform(parseSize),
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
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}\nSee .env.example.`);
  }
  return parsed.data;
}

export const VERSION = process.env.INKADRA_VERSION ?? '0.1.0-dev';
