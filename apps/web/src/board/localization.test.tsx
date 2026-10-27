// @vitest-environment happy-dom
import { addFrame, addScene, frameLabels, storyboardOf } from '@inkadra/canvas-core';
import i18next from 'i18next';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import en from '../i18n/en.json';
import itLocale from '../i18n/it.json';
import { ShotList } from './film/ShotList.tsx';
import { PresentationView } from './PresentationView.tsx';
import { BoardStore } from './store.ts';

it('localizes presentation presets, note action and singular/plural counts in both shot list modes', async () => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en }, it: { translation: itLocale } },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    for (const language of ['en', 'it']) {
      await i18n.changeLanguage(language);
      expect(i18n.t('board.menu.openDoc')).toBe(
        language === 'en' ? 'Open document' : 'Apri documento',
      );
      for (const count of [0, 1, 3]) {
        const doc = new Y.Doc();
        const store = new BoardStore(doc);
        try {
          const scene = addScene(doc, {}, { userId: null });
          for (let n = 0; n < count; n++)
            addFrame(doc, scene.id, null, { shot: 'ews', movement: 'handheld' }, { userId: null });
          await act(async () =>
            root.render(
              <I18nextProvider i18n={i18n}>
                <ShotList key={`${language}-${count}`} store={store} boardTitle="Test" readOnly />
              </I18nextProvider>,
            ),
          );
          const expected = i18n.t('film.list.totalShots', { count });
          for (const mode of ['table', 'kanban']) {
            await act(async () =>
              [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
                .find((b) => b.textContent === i18n.t(`film.list.${mode}`))
                ?.click(),
            );
            expect(host.querySelector('.shots__footer > span')?.textContent?.trim()).toBe(expected);
          }
          if (count === 1) {
            const groups = storyboardOf([...store.getSnapshot().byId.values()]);
            await act(async () =>
              root.render(
                <I18nextProvider i18n={i18n}>
                  <PresentationView
                    store={store}
                    groups={groups}
                    labels={frameLabels(groups)}
                    boardTitle="Test"
                    onClose={() => {}}
                  />
                </I18nextProvider>,
              ),
            );
            expect(host.textContent).toContain(i18n.t('film.shot.ews'));
            expect(host.textContent).toContain(i18n.t('film.movement.handheld'));
            expect(host.textContent).not.toContain('film.shots.');
            expect(host.textContent).not.toContain('film.movements.');
          }
          await act(async () => root.render(null));
        } finally {
          store.destroy();
          doc.destroy();
        }
      }
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
