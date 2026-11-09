// @vitest-environment happy-dom
import type { Project } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeleteProjectDialog } from './DeleteProjectDialog.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./projects.ts', () => ({ deleteProject: vi.fn() }));

const project = { id: 'p1', name: 'Villa Ricci – Ristrutturazione' } as Project;
const writeText = vi.fn();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<DeleteProjectDialog project={project} onClose={vi.fn()} onDeleted={vi.fn()} />),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  writeText.mockReset();
  vi.useRealTimers();
});

const chip = () => host.querySelector<HTMLButtonElement>('.delete-project__chip');
const status = () => host.querySelector('[role="status"]')?.textContent;

it('labels the field with the sentence around the chip', () => {
  const ids = host.querySelector('input')?.getAttribute('aria-labelledby')?.split(' ') ?? [];
  expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
    'projectDelete.confirmBefore',
    project.name,
    'projectDelete.confirmAfter',
  ]);
});

it('copies the whole name from the chip and says so for a moment', async () => {
  vi.useFakeTimers();
  writeText.mockResolvedValue(undefined);
  await act(async () => chip()?.click());
  expect(writeText).toHaveBeenCalledWith(project.name);
  expect(chip()?.classList.contains('is-copied')).toBe(true);
  expect(status()).toBe('projectDelete.copied');
  await act(async () => vi.advanceTimersByTime(1500));
  expect(chip()?.classList.contains('is-copied')).toBe(false);
  expect(status()).toBe('');
});

it('stays as it was when the clipboard refuses', async () => {
  writeText.mockRejectedValue(new Error('denied'));
  await act(async () => chip()?.click());
  expect(chip()?.classList.contains('is-copied')).toBe(false);
  expect(status()).toBe('');
});
