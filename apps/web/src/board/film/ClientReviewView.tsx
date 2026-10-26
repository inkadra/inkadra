// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import type { BoardStore } from '../store.ts';
import { useStoryboard } from './StoryboardView.tsx';
import './film.css';

export function ClientReviewView({
  store,
  projectName,
}: {
  store: BoardStore;
  projectName?: string;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { frames, labels } = useStoryboard(store);
  return (
    <section className="film-shell" aria-label={t('film.views.review')}>
      <header>
        <h1>
          {t('film.views.review')} {projectName}
        </h1>
        <span className="film-shell__badge">{t('shells.demo')}</span>
      </header>
      <p id="review-unavailable">{t('shells.reviewUnavailable')}</p>
      <Button disabled aria-describedby="review-unavailable">
        {t('shells.submitReview')}
      </Button>
      <div className="film-shell__columns">
        <section>
          <h2>{t('nav.shotlist')}</h2>
          {frames.length === 0 && <p>{t('shells.noShots')}</p>}
          {frames.map((frame) => (
            <article className="film-shell__card" key={frame.id}>
              <h3>{labels.get(frame.id)}</h3>
              <p>{frame.action}</p>
              <Button disabled>{t('shells.approve')}</Button>
              <Button disabled>{t('shells.requestChanges')}</Button>
            </article>
          ))}
        </section>
        <section>
          <h2>{t('shells.comments')}</h2>
          <p>{t('shells.noComments')}</p>
          <textarea disabled aria-label={t('shells.comments')} />
        </section>
      </div>
    </section>
  );
}
