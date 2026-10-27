// @vitest-environment happy-dom
import { DEFAULT_CLASSIFICATIONS, type Project } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBoard } from '../board/boards.ts';
import { api } from '../lib/api.ts';
import { ProjectSetupForm } from './NewProjectDialog.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ user: { id: 'me' }, instance: { auth: { email: false } } }),
}));
vi.mock('../lib/api.ts', () => ({
  api: { post: vi.fn(), get: vi.fn(async () => structuredClone(DEFAULT_CLASSIFICATIONS)) },
}));
vi.mock('../board/boards.ts', () => ({ createBoard: vi.fn() }));
// Collaboration seeding is covered separately; advance only when this test asks.
let advance: () => void;
vi.mock('./ProjectSetupSeed.tsx', () => ({
  ProjectSetupSeed: ({ done }: { done: () => void }) => {
    advance = done;
    return null;
  },
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const close = vi.fn();
const created = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ProjectSetupForm onClose={close} onCreated={created} />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function input(selector: string, value: string) {
  await act(async () => {
    const el = host.querySelector<HTMLInputElement>(selector);
    if (!el) throw new Error(selector);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (key: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === key);
async function blank() {
  await input('input[maxlength="120"]', 'Last Run');
  await act(async () =>
    host.querySelectorAll<HTMLInputElement>('input[name="projectTemplate"]')[5]?.click(),
  );
}
it('skips without creating data', async () => {
  await act(async () => button('onboarding.skip')?.click());
  expect(close).toHaveBeenCalledOnce();
  expect(api.post).not.toHaveBeenCalled();
});
it('creates metadata, waits for root sync, then opens the real project', async () => {
  await blank();
  await input('input[type="date"]', '2026-11-02');
  await act(async () => host.querySelector<HTMLInputElement>('input[name="projectType"]')?.click());
  vi.mocked(api.post).mockResolvedValueOnce({ id: 'p', rootBoardId: 'root' } as Project);
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(api.post).toHaveBeenCalledWith('/projects', {
    name: 'Last Run',
    type: 'short_film',
    shootingStart: '2026-11-02',
    shootingEnd: null,
  });
  expect(created).not.toHaveBeenCalled();
  await act(async () => advance());
  expect(created).toHaveBeenCalledWith({ id: 'p', rootBoardId: 'root' });
});
it('keeps a project and successful invites on failure; retries only missing invitations', async () => {
  await blank();
  for (const email of ['one@example.com', 'two@example.com']) {
    await input('input[type="email"]', email);
    await act(async () => button('onboarding.add')?.click());
  }
  const p = { id: 'p', rootBoardId: 'root' } as Project;
  const invitation = {
    id: 'i',
    email: 'one@example.com',
    emailSent: false,
    url: 'https://example.com/join/one',
  };
  vi.mocked(api.post)
    .mockResolvedValueOnce(p)
    .mockResolvedValueOnce(invitation)
    .mockRejectedValueOnce(new Error('offline'));
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(async () => advance());
  expect(host.textContent).toContain('onboarding.partialError');
  expect(host.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(invitation.url);
  vi.mocked(api.post).mockResolvedValueOnce({ ...invitation, id: 'i2', email: 'two@example.com' });
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/projects')).toHaveLength(1);
  expect(
    vi
      .mocked(api.post)
      .mock.calls.filter(([, body]) => (body as { email?: string }).email === 'one@example.com'),
  ).toHaveLength(1);
  await act(async () => button('projectsPage.open')?.click());
  expect(created).toHaveBeenCalledWith(p);
});

it('explains why an unadded email blocks project creation', async () => {
  await blank();
  await input('input[type="email"]', 'team@example.com');
  expect(host.textContent).toContain('onboarding.pendingEmail');
  expect(button('project.create')?.disabled).toBe(true);
  await input('input[type="email"]', '');
  expect(host.textContent).not.toContain('onboarding.pendingEmail');
  expect(button('project.create')?.disabled).toBe(false);
});

it('defaults to blank without creating child boards or template content', async () => {
  const choices = host.querySelectorAll<HTMLInputElement>('input[name="projectTemplate"]');
  expect([...choices].map((choice) => choice.checked)).toEqual([
    false,
    false,
    false,
    false,
    false,
    true,
  ]);
  await input('input[maxlength="120"]', 'Blank project');
  const project = { id: 'p', rootBoardId: 'root' } as Project;
  vi.mocked(api.post).mockResolvedValueOnce(project);
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(createBoard).not.toHaveBeenCalled();
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => advance());
  expect(created).toHaveBeenCalledWith(project);
});

it('offers configured active project types using stable identifiers', async () => {
  const { setClassifications } = await import('../lib/classifications.ts');
  const custom = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Feature', archived: false };
  await act(async () =>
    setClassifications({
      revision: 1,
      tags: [],
      projectTypes: [custom, { ...custom, id: 'retired', label: 'Retired', archived: true }],
    }),
  );
  expect(host.textContent).toContain('Feature');
  expect(host.textContent).not.toContain('Retired');
  await blank();
  await act(async () => host.querySelector<HTMLInputElement>('input[name="projectType"]')?.click());
  vi.mocked(api.post).mockResolvedValueOnce({ id: 'p', rootBoardId: 'root' } as Project);
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(api.post).toHaveBeenCalledWith('/projects', expect.objectContaining({ type: custom.id }));
  await act(async () => setClassifications(structuredClone(DEFAULT_CLASSIFICATIONS)));
});
