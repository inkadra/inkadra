// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import './film.css';

export function MoodboardView({ onClose }: { projectId: string; onClose?: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="film-shell" aria-label={t('nav.moodboard')}>
      <header>
        <h1>{t('nav.moodboard')}</h1>
        <span className="film-shell__badge">{t('shells.demo')}</span>
        {onClose && <Button onClick={onClose}>{t('shells.close')}</Button>}
      </header>
      <h2>{t('shells.noReferences')}</h2>
      <p>{t('shells.referencesUnavailable')}</p>
    </section>
  );
}
