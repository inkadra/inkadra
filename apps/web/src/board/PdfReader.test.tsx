// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PdfReader } from './PdfReader.tsx';

const mock = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: mock.getDocument }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.useRealTimers();
  vi.clearAllMocks();
});
it('shows an error and destroys a PDF load that stalls', async () => {
  vi.useFakeTimers();
  const destroy = vi.fn();
  mock.getDocument.mockReturnValue({ promise: new Promise(() => {}), destroy });
  await act(async () => root.render(<PdfReader url="/pdf" name="Script" />));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('viewer.pdfError');
  expect(destroy).toHaveBeenCalledOnce();
});
it('surfaces unreadable PDF errors instead of leaving a loader', async () => {
  mock.getDocument.mockReturnValue({
    promise: Promise.reject(new Error('Invalid PDF')),
    destroy: vi.fn(),
  });
  await act(async () => root.render(<PdfReader url="/pdf" name="Script" />));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[role="status"]')).toBeNull();
});
