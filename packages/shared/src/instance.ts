import { Timestamp, z } from './common.ts';

export const Health = z
  .object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    checks: z.object({
      database: z.enum(['ok', 'error']),
      queue: z.enum(['ok', 'error', 'disabled']),
    }),
  })
  .openapi('Health');
export type Health = z.infer<typeof Health>;

export const RegistrationMode = z.enum(['first-user', 'invite', 'open']).openapi({
  description:
    '`first-user`: nobody has an account yet and the first sign-up becomes administrator. ' +
    '`invite`: only invited people can sign up. `open`: anyone can sign up.',
});

export const Instance = z
  .object({
    name: z.string(),
    version: z.string(),
    publicUrl: z.url(),
    setupRequired: z.boolean(),
    registration: RegistrationMode,
    auth: z.object({
      emailPassword: z.boolean(),
      google: z.boolean(),
      oidc: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
    collabPath: z.string().openapi({ example: '/collab' }),
    serverTime: Timestamp,
  })
  .openapi('Instance');
export type Instance = z.infer<typeof Instance>;
