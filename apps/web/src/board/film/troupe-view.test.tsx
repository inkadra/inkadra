// @vitest-environment happy-dom
import type { CrewMember } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api, RequestError } from '../../lib/api.ts';
import { BoardStore } from '../store.ts';
import { emptyCrewMember, TroupeView } from './TroupeView.tsx';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../lib/phone.ts', () => ({ useIsPhone: () => false }));
const dispose: Array<() => void> = [];
afterEach(() => {
  for (const fn of dispose.splice(0).reverse()) fn();
  vi.restoreAllMocks();
});
const member: CrewMember = {
  ...emptyCrewMember('Anna', 0),
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  revision: 1,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
};
async function mount(readOnly = false) {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  dispose.push(() => {
    act(() => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  });
  await act(async () =>
    root.render(
      <TroupeView store={store} boardId="board" projectId={member.projectId} readOnly={readOnly} />,
    ),
  );
  return host;
}
const button = (host: ParentNode, text: string) =>
  [...host.querySelectorAll('button')].find((el) => el.textContent === text)!;
it('groups loaded people and saves a field on blur with its revision', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [member], nextCursor: null });
  const save = vi.spyOn(api, 'put').mockResolvedValue({ ...member, role: 'DIT', revision: 2 });
  const host = await mount();
  await act(async () => (host.querySelector('.troupe__person') as HTMLButtonElement).click());
  const input = host.querySelector('input[id$="-role"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'DIT');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(save).toHaveBeenCalledWith(
    `/projects/${member.projectId}/crew/${member.id}`,
    expect.objectContaining({ role: 'DIT', revision: 1 }),
  );
});
it('viewers see contacts with disabled fields and no paste or add actions', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [member], nextCursor: null });
  const host = await mount(true);
  expect(button(host, 'troupe.paste')).toBeUndefined();
  expect(button(host, 'troupe.add')).toBeUndefined();
  await act(async () => (host.querySelector('.troupe__person') as HTMLButtonElement).click());
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
});
it('offers retry after a loading error', async () => {
  let failed = false;
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path.endsWith('/characters')) return { items: [] };
    if (!failed) {
      failed = true;
      throw new RequestError(500, 'internal', 'error');
    }
    return { items: [], nextCursor: null };
  });
  const host = await mount();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => button(host, 'troupe.retry').click());
  expect(host.textContent).toContain('troupe.empty');
});

it('retains a conflicting draft until the user reloads or explicitly keeps it', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [member], nextCursor: null });
  const current = { ...member, role: 'Gaffer', revision: 2 };
  const save = vi
    .spyOn(api, 'put')
    .mockRejectedValueOnce(new RequestError(409, 'conflict', 'changed', { current }))
    .mockResolvedValue({ ...member, onSetContact: true, revision: 3 });
  const host = await mount();
  await act(async () => (host.querySelector('.troupe__person') as HTMLButtonElement).click());
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  expect(host.textContent).toContain('troupe.conflict');
  expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  await act(async () => button(host, 'troupe.keepMine').click());
  expect(save).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ revision: 2, onSetContact: true }),
  );
});

it('opens the row menu and confirms removal before deleting', async () => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.spyOn(api, 'get').mockResolvedValue({ items: [member], nextCursor: null });
  const remove = vi.spyOn(api, 'delete').mockResolvedValue(null);
  const host = await mount();
  await act(async () =>
    (host.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement).click(),
  );
  await act(async () => button(host, 'troupe.remove').click());
  expect(remove).not.toHaveBeenCalled();
  const dialog = host.querySelector('dialog');
  expect(dialog?.open).toBe(true);
  await act(async () => button(dialog!, 'troupe.remove').click());
  expect(remove).toHaveBeenCalledWith(expect.stringContaining(member.id), { revision: 1 });
});

it('lets a removed character card be unlinked', async () => {
  const linkedMember = { ...member, character: { boardId: 'board', elementId: 'removed-card' } };
  vi.spyOn(api, 'get').mockImplementation(async (path) => ({
    items: path.endsWith('/characters') ? [] : [linkedMember],
    nextCursor: null,
  }));
  const save = vi.spyOn(api, 'put').mockResolvedValue({ ...member, revision: 2 });
  const host = await mount();
  await act(async () => (host.querySelector('.troupe__person') as HTMLButtonElement).click());
  const select = host.querySelector('select')!;
  expect(select.value).toBe('board/removed-card');
  await act(async () => {
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(save).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ character: null }),
  );
});
