import i18next from 'i18next';
import { expect, it } from 'vitest';
import en from '../i18n/en.json';
import itLocale from '../i18n/it.json';
import { addedSummary } from './added-summary.ts';

it('counts each kind and makes the verb agree with them', async () => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'it',
    resources: { en: { translation: en }, it: { translation: itLocale } },
  });
  const t = i18n.t.bind(i18n);
  const boards = [...Array(5).fill('board'), ...Array(12).fill('frame')];
  expect(addedSummary(t, 'it', boards)).toBe('Aggiunti 5 board e 12 inquadrature');
  expect(addedSummary(t, 'it', Array(8).fill('image'))).toBe('Aggiunte 8 immagini');
  expect(addedSummary(t, 'it', ['image'])).toBe('Aggiunta 1 immagine');
  expect(addedSummary(t, 'it', ['file', 'file', 'file', 'link', 'link'], 'pasted')).toBe(
    'Incollati 3 file e 2 link',
  );
  // Kinds without a name of their own count as items.
  expect(addedSummary(t, 'it', ['table', 'arrow'])).toBe('Aggiunti 2 elementi');
  await i18n.changeLanguage('en');
  expect(addedSummary(t, 'en', boards)).toBe('Added 5 boards and 12 frames');
  expect(addedSummary(t, 'en', ['scene', 'frame', 'note'])).toBe(
    'Added 1 scene, 1 frame, and 1 note',
  );
});
