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
  TRUST_PROXY: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

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
