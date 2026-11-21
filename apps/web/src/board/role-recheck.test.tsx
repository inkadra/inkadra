// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoardConnection } from './connection.ts';
import { useRoleRecheck } from './role-recheck.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
type Conn = Pick<BoardConnection, 'status' | 'readOnly' | 'accessChangedAt'>;
let root: ReturnType<typeof createRoot> | undefined;
let check: ReturnType<typeof useRoleRecheck>;
const keys: string[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  keys.length = 0;
  vi.useRealTimers();
});
function Page({ conn, roleCanEdit }: { conn: Conn | null; roleCanEdit: boolean | null }) {
  check = useRoleRecheck(conn, roleCanEdit);
  if (keys.at(-1) !== check.key) keys.push(check.key);
  return null;
}
async function render(conn: Conn | null, roleCanEdit: boolean | null) {
  root ??= createRoot(document.createElement('div'));
  await act(async () => root!.render(<Page conn={conn} roleCanEdit={roleCanEdit} />));
  return check.key;
}
const conn = (
  status: Conn['status'],
  readOnly: boolean,
  accessChangedAt: number | null = null,
) => ({
  status,
  readOnly,
  accessChangedAt,
});

it('reads the role again when a viewer promoted while the board opened gets write access', async () => {
  // The page read `viewer`; the socket is still connecting, and starts out editable.
  const start = await render(conn('connecting', false), false);
  // The promotion landed before the socket authenticated: the first answer is read-write.
  const after = await render(conn('synced', false), false);
  expect(after).not.toBe(start);
  // The role read again allows editing: nothing more to read.
  expect(await render(conn('synced', false), true)).toBe(after);
});

it('leaves the role alone when the connection agrees with it or proves nothing', async () => {
  const start = await render(null, null);
  expect(await render(conn('synced', true), false)).toBe(start);
  expect(await render(conn('synced', false), true)).toBe(start);
  // An editor on a frozen board reads only: not a sign the role changed.
  expect(await render(conn('synced', true), true)).toBe(start);
  // Before the role is read there is nothing to compare with.
  expect(await render(conn('synced', false), null)).toBe(start);
});

it('reads the role once when a change of access also shows the mismatch', async () => {
  await render(conn('connecting', false), false);
  // The reconnect reports a change of access and is read-write in the same render.
  await render(conn('synced', false, 1), false);
  expect(keys).toHaveLength(2);
});

it('reads the role again after a failed read while it still disagrees, a few times', async () => {
  vi.useFakeTimers();
  await render(conn('synced', false), false);
  const reads = keys.length;
  // The read failed (a 503): the page keeps `viewer`, and no new event will come.
  for (let i = 1; i <= 3; i++) {
    act(() => check.failed());
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(keys).toHaveLength(reads + i);
  }
  act(() => check.failed());
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(keys).toHaveLength(reads + 3);
  // Once the role agrees, a failure is not retried.
  await render(conn('synced', false), true);
  const settled = keys.length;
  act(() => check.failed());
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(keys).toHaveLength(settled);
});
