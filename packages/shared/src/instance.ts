// SPDX-License-Identifier: MPL-2.0
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
      oidc: z.array(z.object({ id: z.string(), name: z.string() })).openapi({
        description: 'Sign in with `POST /api/auth/sign-in/social` and `provider: id`.',
      }),
      magicLink: z.boolean().openapi({
        description: 'Sign-in links by email. Needs SMTP, so it is false without it.',
      }),
      email: z.boolean().openapi({
        description: 'The instance can send email (invitations, sign-in links).',
      }),
    }),
    collabPath: z.string().openapi({ example: '/collab' }),
    media: z
      .object({
        videoPosters: z.boolean().openapi({
          description: 'The worker has ffmpeg: videos get poster thumbnails and a duration.',
        }),
        rawPreviews: z.boolean().openapi({
          description: 'The worker can decode camera RAW files into thumbnails.',
        }),
      })
      .openapi({ description: 'Media tools available on this server (image tag `-media`).' }),
    limits: z.object({
      uploadMaxBytes: z
        .int()
        .min(0)
        .openapi({ description: 'Largest file an upload may have; 0 means no limit.' }),
    }),
    serverTime: Timestamp,
  })
  .openapi('Instance');
export type Instance = z.infer<typeof Instance>;

export const DiagnosticId = z
  .enum([
    'public_url_https',
    'public_url_matches_request',
    'proxy_trusted',
    'database',
    'queue',
    'data_dir_writable',
    'storage',
  ])
  .openapi({
    description:
      '`public_url_https`: PUBLIC_URL uses HTTPS (warning otherwise, except on localhost). ' +
      '`public_url_matches_request`: the scheme and host the server sees, after the proxy ' +
      'headers, match PUBLIC_URL (error otherwise: secure cookies break). `proxy_trusted`: a ' +
      'request carrying X-Forwarded-For comes from a peer that TRUST_PROXY accepts. `database`, ' +
      '`queue`: as in Health. `data_dir_writable`: DATA_DIR accepts writes. `storage`: a test ' +
      'file can be written to and removed from the configured storage.',
  });
export type DiagnosticId = z.infer<typeof DiagnosticId>;

export const DiagnosticCheck = z
  .object({
    id: DiagnosticId,
    status: z.enum(['ok', 'warning', 'error']),
    expected: z.string().nullable().openapi({
      description: 'What the check wanted. Always null while the instance has no accounts.',
    }),
    actual: z.string().nullable().openapi({
      description: 'What the check found. Always null while the instance has no accounts.',
    }),
  })
  .openapi('DiagnosticCheck');
export type DiagnosticCheck = z.infer<typeof DiagnosticCheck>;

/**
 * Installation self-check. Texts are not part of the payload: clients translate `id` and
 * `status` and show `expected` and `actual` as they are.
 */
export const Diagnostics = z
  .object({
    version: z.string(),
    checkedAt: Timestamp,
    request: z
      .object({
        protocol: z.enum(['http', 'https']),
        host: z.string(),
        clientIp: z.string(),
        peerAddress: z.string().openapi({ description: 'Address of the TCP peer: the proxy.' }),
        forwardedFor: z.string().nullable().openapi({ description: 'Raw X-Forwarded-For.' }),
        proxyTrusted: z.boolean(),
      })
      .openapi({ description: 'The request of the caller, as the server sees it.' }),
    checks: z.array(DiagnosticCheck),
  })
  .openapi('Diagnostics');
export type Diagnostics = z.infer<typeof Diagnostics>;
