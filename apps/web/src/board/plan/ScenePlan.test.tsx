// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { BoardStore } from '../store.ts';
import { ScenePlan } from './ScenePlan.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));
vi.mock('./project-kit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./project-kit.ts')>()),
  useOtherKits: () => ({ entries: [], scope: 'local' }),
}));
vi.mock('./PlanExport.tsx', () => ({
  downloadPlanSheet: vi.fn(),
  planSheetEnv: () => ({}),
  planSheetRequest: () => ({}),
}));

it('opens a plan whose lists the server has not prepared read-only from a scene, saying why', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const doc = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
  const { id } = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  // Icons an older writer left as plain JSON.
  (roots(doc).elements.get(id) as Y.Map<unknown>).set('icons', [
    { id: 'lampLegacyAAA', kind: 'fresnel', color: '#FFFFFF', x: 100, y: 100 },
  ]);
  const store = new BoardStore(doc);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[`/?plan=${id}`]}>
        <ScenePlan store={store} projectId="p" boardId="b" userId="u" readOnly={false} ready />
      </MemoryRouter>,
    ),
  );
  expect(document.body.textContent).toContain('board.planListsNotReady');
  // The viewer, not the editor: no tool bar of the editor.
  expect(document.querySelector('.plan-view__top')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
  store.destroy();
});
