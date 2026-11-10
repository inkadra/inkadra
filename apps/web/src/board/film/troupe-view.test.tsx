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
const device = vi.hoisted(() => ({ phone: false }));
vi.mock('../../lib/phone.ts', () => ({ useIsPhone: () => device.phone }));
const dispose: Array<() => void> = [];
afterEach(() => {
  for (const fn of dispose.splice(0).reverse()) fn();
  vi.restoreAllMocks();
  device.phone = false;
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

it('merges a duplicate row of the same person from the row menu', async () => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  const account = (id: string) => ({ id, name: id, image: null });
  const kept = { ...member, userId: 'u1', account: account('u1') };
  const twin = { ...member, id: crypto.randomUUID(), name: ' anna', phone: '333' };
  // Linked to another account: merging would lose a link, so it is not offered.
  const other = { ...member, id: crypto.randomUUID(), userId: 'u2', account: account('u2') };
  const luca = { ...member, id: crypto.randomUUID(), name: 'Luca' };
  vi.spyOn(api, 'get').mockResolvedValue({ items: [kept, twin, other, luca], nextCursor: null });
  const merge = vi.spyOn(api, 'post').mockResolvedValue({ ...kept, phone: '333', revision: 2 });
  const host = await mount();
  const menus = [...host.querySelectorAll<HTMLButtonElement>('[aria-haspopup="menu"]')];
  await act(async () => menus[3]?.click());
  expect(button(host, 'troupe.merge')).toBeUndefined();
  await act(async () => menus[0]?.click());
  await act(async () => button(host, 'troupe.merge').click());
  const dialog = host.querySelector('dialog');
  expect([...(dialog?.querySelectorAll('input[type="radio"]') ?? [])]).toHaveLength(1);
  await act(async () => button(dialog!, 'troupe.mergeAction').click());
  expect(merge).toHaveBeenCalledWith(`/projects/${member.projectId}/crew/${kept.id}/merge`, {
    revision: 1,
    from: twin.id,
    fromRevision: 1,
  });
  expect(host.querySelectorAll('.troupe__row')).toHaveLength(3);
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
  expect(host.textContent).toContain('troupe.characterUnavailable');
  await act(async () => button(host, 'troupe.unlinkShort').click());
  expect(save).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ character: null }),
  );
});

it('links a character card from the menu and tags the row', async () => {
  const ref = { boardId: crypto.randomUUID(), elementId: crypto.randomUUID() };
  const card = { ...ref, name: 'Mara', actor: 'Giulia', contact: '' };
  vi.spyOn(api, 'get').mockImplementation(async (path) => ({
    items: path.endsWith('/characters') ? [card] : [member],
    nextCursor: null,
  }));
  const save = vi.spyOn(api, 'put').mockResolvedValue({ ...member, character: ref, revision: 2 });
  const host = await mount();
  await act(async () => (host.querySelector('.troupe__person') as HTMLButtonElement).click());
  await act(async () => button(host, 'troupe.link').click());
  await act(async () => button(host, 'Mara').click());
  expect(save).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ character: ref }),
  );
  expect(host.querySelector('.troupe__chip--character')).not.toBeNull();
  expect(host.textContent).toContain('Giulia');
});

const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const blur = (input: HTMLElement) =>
  act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

it('keeps the fields usable while saving and sends quick edits in order', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [member], nextCursor: null });
  let finish: (row: CrewMember) => void = () => {};
  const save = vi
    .spyOn(api, 'put')
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve as typeof finish)))
    .mockResolvedValue({ ...member, role: 'DIT', pickup: 'Hotel', revision: 3 });
  const host = await mount();
  await act(async () => (host.querySelector('.troupe__person') as HTMLButtonElement).click());
  const role = host.querySelector('input[id$="-role"]') as HTMLInputElement;
  const pickup = host.querySelector('input[id$="-pickup"]') as HTMLInputElement;
  await type(role, 'DIT');
  await blur(role);
  // Tab moved on while the first save runs: the fieldset stays enabled.
  expect(host.querySelector('fieldset')?.disabled).toBe(false);
  expect(host.textContent).toContain('troupe.saving');
  await type(pickup, 'Hotel');
  await blur(pickup);
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...member, role: 'DIT', revision: 2 }));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ role: 'DIT', pickup: 'Hotel', revision: 2 }),
  );
});

it('explains why a paste of more than 500 people cannot be added', async () => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.spyOn(api, 'get').mockResolvedValue({ items: [], nextCursor: null });
  const host = await mount();
  await act(async () => button(host, 'troupe.paste').click());
  const dialog = host.querySelector('dialog')!;
  const text = Array.from({ length: 501 }, (_, i) => `Person ${i}\tGrip`).join('\n');
  await type(dialog.querySelector('textarea')!, text);
  expect(dialog.textContent).toContain('troupe.tooMany');
  expect(dialog.querySelectorAll('.troupe__preview-row').length).toBeLessThanOrEqual(501);
  expect(button(dialog, 'troupe.addPeople')?.disabled).toBe(true);
});

it('keeps a conflicting draft when another person is selected', async () => {
  const other = { ...member, id: crypto.randomUUID(), name: 'Bruno' };
  vi.spyOn(api, 'get').mockResolvedValue({ items: [member, other] });
  vi.spyOn(api, 'put').mockRejectedValue(
    new RequestError(409, 'conflict', 'changed', { current: { ...member, revision: 2 } }),
  );
  const host = await mount();
  const select = (n: number) =>
    act(async () => host.querySelectorAll<HTMLButtonElement>('.troupe__person')[n]?.click());
  await select(0);
  await type(host.querySelector('input[id$="-role"]')!, 'DIT');
  await blur(host.querySelector('input[id$="-role"]')!);
  await select(1);
  await select(0);
  expect(host.querySelector<HTMLInputElement>('input[id$="-role"]')?.value).toBe('DIT');
  expect(host.textContent).toContain('troupe.conflict');
});

it.each(['unsaved', 'offline', 'conflict'])(
  'keeps a phone draft when closed and reopened (%s)',
  async (mode) => {
    device.phone = true;
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.open = true;
    });
    vi.spyOn(api, 'get').mockResolvedValue({ items: [member] });
    vi.spyOn(api, 'put').mockRejectedValue(
      mode === 'conflict'
        ? new RequestError(409, 'conflict', 'changed', { current: { ...member, revision: 2 } })
        : new Error('offline'),
    );
    const host = await mount();
    const open = () =>
      act(async () => (host.querySelector('.troupe__person') as HTMLButtonElement).click());
    await open();
    const role = host.querySelector<HTMLInputElement>('input[id$="-role"]')!;
    await type(role, 'DIT');
    if (mode !== 'unsaved') await blur(role);
    await act(async () => button(host, 'troupe.close').click());
    await open();
    expect(host.querySelector<HTMLInputElement>('input[id$="-role"]')?.value).toBe('DIT');
    if (mode === 'conflict') expect(host.textContent).toContain('troupe.conflict');
  },
);
