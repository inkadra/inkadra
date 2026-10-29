import { DEFAULT_CLASSIFICATIONS } from '@inkadra/shared';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { instanceSetting } from '../db/schema.ts';
import { errorHandler, HttpError } from './errors.ts';
import { registerInstanceAdminRoutes } from './instance-admin-routes.ts';

vi.mock('./auth-routes.ts', () => ({
  requireActor: async (_auth: unknown, req: { headers: Record<string, string> }) => {
    if (!req.headers.role) throw new HttpError('unauthorized', 'Sign in.');
    return { id: 'admin', role: req.headers.role };
  },
  requireSession: async (_auth: unknown, req: { headers: Record<string, string> }) => {
    if (!req.headers.role) throw new HttpError('unauthorized', 'Sign in.');
    return { user: { id: 'admin', role: req.headers.role } };
  },
}));
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
function setup() {
  let value: unknown;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () =>
          table === instanceSetting
            ? value
              ? [{ value }]
              : []
            : [{ role: 'admin', deactivatedAt: null }],
      }),
    }),
    execute: async () => {},
    insert: () => ({
      values: (row: { value: unknown }) => ({
        onConflictDoUpdate: async () => {
          value = structuredClone(row.value);
        },
      }),
    }),
    transaction: async (run: (tx: unknown) => unknown) => run(db),
  };
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler(errorHandler);
  registerInstanceAdminRoutes(app, {
    db: db as unknown as Database,
    auth: {} as Auth,
    config: {} as Config,
  });
  return app;
}
describe('classification HTTP permissions and persistence', () => {
  it('requires authentication for reads and admin permissions for writes', async () => {
    const app = setup();
    expect((await app.inject('/api/v1/instance/classifications')).statusCode).toBe(401);
    expect(
      (
        await app.inject({ url: '/api/v1/instance/classifications', headers: { role: 'member' } })
      ).json(),
    ).toEqual(DEFAULT_CLASSIFICATIONS);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/instance/classifications',
          headers: { role: 'member' },
          payload: DEFAULT_CLASSIFICATIONS,
        })
      ).statusCode,
    ).toBe(403);
  });
  it('persists updates, refuses stale revisions and preserves default IDs', async () => {
    const app = setup();
    const draft = structuredClone(DEFAULT_CLASSIFICATIONS);
    draft.projectTypes.push({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'Feature',
      archived: false,
    });
    const request = {
      method: 'PUT' as const,
      url: '/api/v1/instance/classifications',
      headers: { role: 'admin' },
      payload: draft,
    };
    const saved = await app.inject(request);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().revision).toBe(1);
    expect((await app.inject({ url: request.url, headers: { role: 'member' } })).json()).toEqual(
      saved.json(),
    );
    expect((await app.inject(request)).statusCode).toBe(409);
    const removed = saved.json();
    removed.projectTypes.shift();
    expect((await app.inject({ ...request, payload: removed })).statusCode).toBe(400);
  });
});
