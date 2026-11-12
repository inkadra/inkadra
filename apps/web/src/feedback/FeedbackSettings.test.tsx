// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, RequestError } from '../lib/api.ts';
import { FeedbackInbox, FeedbackSettings } from './FeedbackSettings.tsx';

// The same function every render: the page loads again when `t` changes.
const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));
vi.mock('../lib/api.ts', async (actual) => ({
  ...(await actual<typeof import('../lib/api.ts')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const report = (id: string, title: string) => ({
  id,
  reference: `#local-${id}`,
  delivery: 'inbox',
  duplicate: false,
  issueUrl: null,
  reporter: 'Member (member)',
  failure: null,
  createdAt: '2026-11-01T10:00:00Z',
  report: { title, description: '', diagnostics: {}, attachments: [] },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  });
  vi.mocked(api.get).mockImplementation(async (path: string) =>
    path === '/feedback/reports'
      ? { items: [report('1', 'First'), report('2', 'Second')] }
      : { destination: 'inbox', repository: null, guests: false, retentionDays: 90 },
  );
});

async function open() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<FeedbackSettings />));
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === label || b.getAttribute('aria-label') === label,
    );
  return { host, root, button };
}

it('deletes a report only once the confirmation is accepted, and says GitHub keeps its copy', async () => {
  vi.mocked(api.delete).mockResolvedValue(undefined);
  const { host, root, button } = await open();
  const del = button('feedback.delete: #local-1 · First');
  // Beside the summary, not inside it: pressing it does not fold the row.
  expect(del?.closest('summary')).toBeNull();
  await act(async () => del?.click());
  expect(host.querySelector('dialog')?.open).toBe(true);
  expect(host.querySelector('dialog')?.textContent).toContain('feedback.deleteBody');
  expect(api.delete).not.toHaveBeenCalled();

  await act(async () => button('project.cancel')?.click());
  expect(host.querySelector('dialog')?.open).toBe(false);
  expect(api.delete).not.toHaveBeenCalled();

  await act(async () => del?.click());
  await act(async () => button('feedback.deleteConfirm')?.click());
  expect(api.delete).toHaveBeenCalledWith('/feedback/reports/1');
  expect(host.querySelector('dialog')?.open).toBe(false);
  expect(host.textContent).not.toContain('First');
  expect(host.textContent).toContain('Second');
  // The button that had the focus is gone with the row.
  expect(document.activeElement).toBe(host.querySelector('.feedback-reports'));
  await act(async () => root.unmount());
  host.remove();
});

it('keeps the report when deleting fails, and treats one already gone as deleted', async () => {
  vi.mocked(api.delete).mockRejectedValueOnce(new RequestError(500, 'internal', 'No'));
  const { host, root, button } = await open();
  await act(async () => button('feedback.delete: #local-1 · First')?.click());
  await act(async () => button('feedback.deleteConfirm')?.click());
  expect(host.querySelector('dialog')?.open).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('feedback.deleteFailed');
  expect(host.querySelector('.feedback-reports details')?.textContent).toContain('First');

  vi.mocked(api.delete).mockRejectedValueOnce(new RequestError(404, 'not_found', 'Gone'));
  await act(async () => button('feedback.deleteConfirm')?.click());
  expect(host.querySelector('dialog')?.open).toBe(false);
  expect(host.textContent).not.toContain('First');
  await act(async () => root.unmount());
  host.remove();
});

it('offers no deletion in the copy of the list that a notification opens', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<FeedbackInbox />));
  expect(host.textContent).toContain('First');
  expect(host.querySelector('.feedback-reports__delete')).toBeNull();
  await act(async () => root.unmount());
});

it('shows the relay in one sentence and four facts, and other destinations without them', async () => {
  const settings = { destination: 'relay', repository: null, guests: false, retentionDays: 90 };
  vi.mocked(api.get).mockImplementation(async (path: string) =>
    path === '/feedback/reports' ? { items: [] } : settings,
  );
  const relay = await open();
  expect(relay.host.textContent).toContain('settingsUi.reports.relayHelp');
  expect(relay.host.textContent).not.toContain('feedback.privacyRelay');
  expect(relay.host.querySelectorAll('.feedback-facts li')).toHaveLength(4);
  await act(async () => relay.root.unmount());
  relay.host.remove();

  settings.destination = 'inbox';
  const inbox = await open();
  expect(inbox.host.textContent).toContain('settingsUi.reports.copyHere');
  expect(inbox.host.querySelector('.feedback-facts')).toBeNull();
  await act(async () => inbox.root.unmount());
  inbox.host.remove();
});
