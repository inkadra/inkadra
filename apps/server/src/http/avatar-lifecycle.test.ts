import Fastify from 'fastify';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { userAvatar } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { registerAccountRoutes } from './account-routes.ts';
import { errorHandler } from './errors.ts';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
vi.mock('./auth-routes.ts', () => ({
  requireSession: async () => ({ user: { id: userId } }),
  requireActor: async () => ({ id: userId }),
  toHeaders: () => new Headers(),
}));
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

function setup() {
  let account = {
    id: userId,
    name: 'Alex',
    email: 'alex@example.test',
    image: null as string | null,
    role: 'member',
    locale: 'en',
    createdAt: new Date(),
    updatedAt: new Date(),
    emailVerified: true,
  };
  let avatar: { userId: string; version: string; image: Uint8Array } | null = null;
  let failUpdate = false;
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const rows = () =>
          table === userAvatar ? (avatar ? [{ image: avatar.image }] : []) : [{ id: userId }];
        return {
          where: () => ({ for: async () => rows() }),
          innerJoin: () => ({ where: async () => rows() }),
        };
      },
    }),
    insert: () => ({
      values: (row: NonNullable<typeof avatar>) => ({
        onConflictDoUpdate: async () => {
          avatar = row;
        },
      }),
    }),
    update: () => ({
      set: (patch: Partial<typeof account>) => ({
        where: () => ({
          returning: async () => {
            if (failUpdate) throw new Error('database write failed');
            account = { ...account, ...patch };
            return [account];
          },
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        avatar = null;
      },
    }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const before = { account, avatar };
      try {
        return await run(db);
      } catch (error) {
        account = before.account;
        avatar = before.avatar;
        throw error;
      }
    },
  };
  const app = Fastify({ bodyLimit: 2 * 1024 * 1024 });
  apps.push(app);
  app.setErrorHandler(errorHandler);
  registerAccountRoutes(app, {
    db: db as unknown as Database,
    auth: {} as Auth,
    config: { PUBLIC_URL: 'http://localhost' } as Config,
    jobs: {} as Jobs,
  });
  return {
    app,
    image: () => avatar,
    account: () => account,
    fail: () => {
      failUpdate = true;
    },
  };
}
const payload = async () => ({
  data: (
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
  ).toString('base64'),
});

it('replaces one owned avatar row, serves the normalized bytes and removes it atomically', async () => {
  const state = setup();
  const first = await state.app.inject({
    method: 'PUT',
    url: '/api/v1/me/avatar',
    payload: await payload(),
  });
  expect(first.statusCode).toBe(200);
  const initialVersion = state.image()?.version;
  const second = await state.app.inject({
    method: 'PUT',
    url: '/api/v1/me/avatar',
    payload: await payload(),
  });
  expect(second.statusCode).toBe(200);
  expect(state.image()?.version).not.toBe(initialVersion);
  const result = await state.app.inject(new URL(second.json().image).pathname);
  expect(result.statusCode).toBe(200);
  expect(await sharp(result.rawPayload).metadata()).toMatchObject({
    format: 'webp',
    width: 256,
    height: 256,
  });
  expect((await state.app.inject({ method: 'DELETE', url: '/api/v1/me/avatar' })).statusCode).toBe(
    200,
  );
  expect(state.image()).toBeNull();
  expect(state.account().image).toBeNull();
  expect((await state.app.inject(new URL(second.json().image).pathname)).statusCode).toBe(404);
});
it('rolls back image bytes and metadata together when a replacement fails', async () => {
  const state = setup();
  await state.app.inject({ method: 'PUT', url: '/api/v1/me/avatar', payload: await payload() });
  const previous = state.image();
  const url = state.account().image;
  state.fail();
  const failed = await state.app.inject({
    method: 'PUT',
    url: '/api/v1/me/avatar',
    payload: await payload(),
  });
  expect(failed.statusCode).toBe(500);
  expect(state.image()).toBe(previous);
  expect(state.account().image).toBe(url);
});
