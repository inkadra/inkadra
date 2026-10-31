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
  api: {
    post: vi.fn(),
    get: vi.fn(async (path: string) =>
      path.startsWith('/users/search')
        ? {
            items: [
              { id: 'u1', name: 'Giulia Rossi', email: 'giulia@example.com', image: null },
              { id: 'u2', name: 'Giorgio Bianchi', email: 'giorgio@example.com', image: null },
            ],
          }
        : structuredClone(DEFAULT_CLASSIFICATIONS),
    ),
  },
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
    host.querySelector<HTMLInputElement>('input[name="projectTemplate"][value="blank"]')?.click(),
  );
}
async function openDetails() {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('.project-setup__disclosure')?.click(),
  );
}
const people = 'input[role="combobox"]';
const submit = () =>
  act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
it('shows only the name and the templates until Details opens', async () => {
  expect(host.querySelector('input[name="projectType"]')).toBeNull();
  expect(host.querySelector('input[type="date"]')).toBeNull();
  expect(host.querySelector(people)).toBeNull();
  expect(host.textContent).not.toContain('onboarding.skip');
  await openDetails();
  expect(host.querySelector('.project-setup__disclosure')?.getAttribute('aria-expanded')).toBe(
    'true',
  );
  expect(host.querySelectorAll('input[type="date"]')).toHaveLength(2);
  expect(host.querySelector(people)).not.toBeNull();
});
it('cancels without creating data', async () => {
  await act(async () => button('project.cancel')?.click());
  expect(close).toHaveBeenCalledOnce();
  expect(api.post).not.toHaveBeenCalled();
});
it('creates metadata, waits for root sync, then opens the real project', async () => {
  await blank();
  await openDetails();
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
  await openDetails();
  for (const email of ['one@example.com', 'two@example.com']) {
    await input(people, email);
    await act(async () => button('onboarding.add')?.click());
  }
  expect(button('onboarding.createAndInvite')).toBeDefined();
  const p = { id: 'p', rootBoardId: 'root' } as Project;
  const invitation = {
    id: 'i',
    email: 'one@example.com',
    emailSent: false,
    url: 'https://example.com/join/one',
  };
  vi.mocked(api.post)
    .mockResolvedValueOnce(p)
    .mockResolvedValueOnce({ status: 'invited', invitation })
    .mockRejectedValueOnce(new Error('offline'));
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(async () => advance());
  expect(host.textContent).toContain('onboarding.partialError');
  expect(host.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(invitation.url);
  vi.mocked(api.post).mockResolvedValueOnce({
    status: 'added',
    entry: { user: { id: 'u2', name: 'Two', email: 'two@example.com' } },
  });
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
  expect(host.textContent).toContain('one@example.com · onboarding.copyLink');
  expect(host.textContent).toContain('share.added');
  await act(async () => button('projectsPage.open')?.click());
  expect(created).toHaveBeenCalledWith(p);
});

it('does not let a half-typed email block Create, and invites a complete one', async () => {
  await blank();
  await openDetails();
  await input(people, 'team@');
  expect(host.textContent).not.toContain('onboarding.pendingEmail');
  expect(button('project.create')?.disabled).toBe(false);
  await act(async () => button('onboarding.add')?.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('onboarding.invalidEmail');
  await input(people, 'team@example.com');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  // A complete address left in the field is invited with the project.
  expect(button('onboarding.createAndInvite')?.disabled).toBe(false);
  vi.mocked(api.post).mockResolvedValueOnce({ id: 'p', rootBoardId: 'root' } as Project);
  vi.mocked(api.post).mockResolvedValueOnce({
    status: 'invited',
    invitation: { id: 'i', email: 'team@example.com', emailSent: true, url: null },
  });
  await submit();
  await act(async () => advance());
  expect(api.post).toHaveBeenCalledWith('/invitations', {
    kind: 'email',
    projectId: 'p',
    email: 'team@example.com',
    role: 'editor',
  });
});

it('suggests people on the instance and leaves out those already added', async () => {
  await blank();
  await openDetails();
  await input(people, 'gi');
  await act(async () => new Promise((r) => setTimeout(r, 300)));
  expect(api.get).toHaveBeenCalledWith('/users/search?q=gi');
  const options = () =>
    [...host.querySelectorAll('[role="option"] .people-picker__name')].map((o) => o.textContent);
  expect(options()).toEqual(['Giulia Rossi', 'Giorgio Bianchi']);
  await act(async () => host.querySelector<HTMLElement>('[role="option"]')?.click());
  expect(host.querySelector('.project-setup__people-list')?.textContent).toContain('Giulia Rossi');
  expect(host.querySelector<HTMLInputElement>(people)?.value).toBe('');
  await input(people, 'gio');
  await act(async () => new Promise((r) => setTimeout(r, 300)));
  expect(options()).toEqual(['Giorgio Bianchi']);
});

it('defaults to blank without creating child boards or template content', async () => {
  const choices = host.querySelectorAll<HTMLInputElement>('input[name="projectTemplate"]');
  expect([...choices].map((choice) => choice.checked)).toEqual([
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
  expect(host.querySelector('.project-setup__hint')?.textContent).toBe(
    'onboarding.templates.blank.body',
  );
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
  await openDetails();
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
it('starts from the template picked on Home', async () => {
  // A new form: the template is only where it starts.
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () =>
    root.render(<ProjectSetupForm template="moodboard" onClose={close} onCreated={created} />),
  );
  const checked = host.querySelector<HTMLInputElement>('input[name="projectTemplate"]:checked');
  const radios = [...host.querySelectorAll<HTMLInputElement>('input[name="projectTemplate"]')];
  expect(radios.indexOf(checked as HTMLInputElement)).toBe(2);
});
