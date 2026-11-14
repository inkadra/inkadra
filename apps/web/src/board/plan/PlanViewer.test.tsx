// @vitest-environment happy-dom
import { createElement, listElements, type PlanElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { BoardStore } from '../store.ts';
import { PlanViewer } from './PlanViewer.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('./PlanExport.tsx', () => ({
  downloadPlanSheet: vi.fn(async () => {
    throw new TypeError('Failed to fetch');
  }),
  planSheetEnv: () => ({}),
  planSheetRequest: () => ({}),
}));

it('says so when the PDF cannot be made (#829)', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const doc = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
  const { id } = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const plan = listElements(doc).find((e) => e.id === id) as PlanElement;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <PlanViewer plan={plan} phone={false} store={new BoardStore(doc)} onClose={() => {}} />,
    ),
  );
  const pdf = [...document.querySelectorAll('button')].find((b) => b.textContent === 'PDF');
  await act(async () => pdf?.click());
  expect(document.body.textContent).toContain('export.failed');
  expect(pdf?.disabled).toBe(false);
  await act(async () => root.unmount());
  host.remove();
});
