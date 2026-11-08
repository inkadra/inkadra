// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';

/** The public demo of this server (DEMO_MODE, decision 0084); absent on any other server. */
export const DemoInfo = z
  .object({
    ttlSeconds: z.int().min(60).openapi({ description: 'How long a sandbox lives.' }),
    storageBytes: z.int().min(0).openapi({ description: 'Space of one sandbox.' }),
    fileBytes: z.int().min(0).openapi({ description: 'Largest file of a sandbox.' }),
    maxSandboxes: z.int().min(1),
    full: z.boolean().openapi({ description: 'As many sandboxes are open as the server takes.' }),
    turnstileSiteKey: z.string().nullable().openapi({
      description: 'Cloudflare Turnstile site key: the token goes with POST /demo/sandbox.',
    }),
  })
  .openapi('DemoInfo');
export type DemoInfo = z.infer<typeof DemoInfo>;

/** The Turnstile action of "Try the demo": the server refuses a token made for another. */
export const TURNSTILE_ACTION = 'demo_sandbox';

export const CreateDemoSandbox = z
  .object({ turnstileToken: z.string().min(1).max(2048).optional() })
  .openapi('CreateDemoSandbox');
export type CreateDemoSandbox = z.infer<typeof CreateDemoSandbox>;

/** The sandbox of the signed-in visitor. */
export const DemoSandbox = z
  .object({
    expiresAt: Timestamp.openapi({ description: 'When the sandbox and its files go.' }),
    projectId: Id.nullable(),
    exportUsed: z.boolean().openapi({ description: 'Its one project export is spent.' }),
  })
  .openapi('DemoSandbox');
export type DemoSandbox = z.infer<typeof DemoSandbox>;

/**
 * `details.reason` of a refusal of the demo: `demo_full` (429, too many sandboxes open),
 * `demo_wait` (429, a sandbox from this address a moment ago), `turnstile` (403, the check
 * failed), `demo_off` (403, not in the demo), `demo_export` (429, the export is spent),
 * `demo_limit` (409, past a cap of the demo: boards of a sandbox, size of a board).
 */
export const DemoRefusalReason = z.enum([
  'demo_full',
  'demo_wait',
  'turnstile',
  'demo_off',
  'demo_export',
  'demo_limit',
]);
export type DemoRefusalReason = z.infer<typeof DemoRefusalReason>;
