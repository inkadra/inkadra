// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoardConnection } from './connection.ts';
import { useRoleRecheck } from './role-recheck.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
type Conn = Pick<BoardConnection, 'status' | 'readOnly'>;
let root: ReturnType<typeof createRoot> | undefined;
let version = -1;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});
function Page({ conn, roleCanEdit }: { conn: Conn | null; roleCanEdit: boolean | null }) {
  version = useRoleRecheck(conn, roleCanEdit);
  return null;
}
async function render(conn: Conn | null, roleCanEdit: boolean | null) {
  root ??= createRoot(document.createElement('div'));
  await act(async () => root!.render(<Page conn={conn} roleCanEdit={roleCanEdit} />));
  return version;
}

it('reads the role again when a viewer promoted while the board opened gets write access', async () => {
  // The page read `viewer`; the socket is still connecting, and starts out editable.
  const start = await render({ status: 'connecting', readOnly: false }, false);
  // The promotion landed before the socket authenticated: the first answer is read-write.
  expect(await render({ status: 'synced', readOnly: false }, false)).toBe(start + 1);
  // The role read again allows editing: nothing more to read.
  expect(await render({ status: 'synced', readOnly: false }, true)).toBe(start + 1);
});

it('leaves the role alone when the connection agrees with it or proves nothing', async () => {
  const start = await render(null, null);
  expect(await render({ status: 'synced', readOnly: true }, false)).toBe(start);
  expect(await render({ status: 'synced', readOnly: false }, true)).toBe(start);
  // An editor on a frozen board reads only: not a sign the role changed.
  expect(await render({ status: 'synced', readOnly: true }, true)).toBe(start);
  // Before the role is read there is nothing to compare with.
  expect(await render({ status: 'synced', readOnly: false }, null)).toBe(start);
});
