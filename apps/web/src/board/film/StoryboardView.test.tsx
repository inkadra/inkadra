// @vitest-environment happy-dom
import { addFrame, addScene } from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { chooseSelect } from '../../test/select.ts';
import { BoardStore } from '../store.ts';
import { StoryboardView } from './StoryboardView.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('shares the scene filter between compact and desktop navigation without modifying read-only documents', async () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const a = addScene(doc, { number: '1', title: 'Opening' }, { userId: null });
  const b = addScene(doc, { number: '2', title: 'Ending' }, { userId: null });
  addFrame(doc, a.id, null, {}, { userId: null });
  addFrame(doc, b.id, null, {}, { userId: null });
  addFrame(doc, null, null, {}, { userId: null });
  const before = Y.encodeStateAsUpdate(doc);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<StoryboardView store={store} projectId="p" boardId="b" userId="u" readOnly />),
    );
    const picker = host.querySelector<HTMLButtonElement>('.story__scene-picker .ink-select');
    expect(picker?.getAttribute('aria-haspopup')).toBe('listbox');
    expect(host.querySelector(`label[for="${picker?.id}"]`)).not.toBeNull();
    expect(host.querySelectorAll('.story__tile')).toHaveLength(3);
    await act(async () => {
      if (picker) {
        chooseSelect(picker, b.id);
      }
    });
    expect(host.querySelectorAll('.story__tile')).toHaveLength(1);
    expect(host.querySelector('.story__side-item[aria-pressed="true"]')?.textContent).toContain(
      'Ending',
    );
    const all = host.querySelector<HTMLButtonElement>('.story__side-item');
    await act(async () => all?.click());
    expect(picker?.value).toBe('');
    expect(host.querySelectorAll('.story__tile')).toHaveLength(3);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    store.destroy();
    doc.destroy();
  }
});
