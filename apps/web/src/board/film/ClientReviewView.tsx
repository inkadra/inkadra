// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@inkadra/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReviewChip } from '../CardReview.tsx';
import { Thread } from '../CommentsPanel.tsx';
import { ReviewSection } from '../ReviewSection.tsx';
import { canComment, refreshReviews, useReviews } from '../review-store.ts';
import type { BoardStore } from '../store.ts';
import { useBoardAspect } from './aspect.ts';
import { FramePicture } from './FramePicture.tsx';
import { useStoryboard } from './StoryboardView.tsx';
import './film.css';

const filters = ['all', 'pending', 'approved', 'changes_requested'] as const;
type Filter = (typeof filters)[number];
export function ClientReviewView({
  store,
  projectName,
  boardId,
}: {
  store: BoardStore;
  projectName?: string;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { frames, labels } = useStoryboard(store);
  const aspect = useBoardAspect(store.doc);
  const state = useReviews((s) => s);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [threadFilter, setThreadFilter] = useState('open');
  const ready =
    !!boardId && state.boardId === boardId && !state.preview && state.reviewsStatus === 'ready';
  const statusOf = (elementId: string) => state.reviews.get(elementId)?.status ?? 'none';
  const matches = (elementId: string) => {
    const status = statusOf(elementId);
    return (
      filter === 'all' ||
      (filter === 'pending'
        ? status !== 'approved' && status !== 'changes_requested'
        : status === filter)
    );
  };
  const visible = frames.filter((f) => !ready || matches(f.id));
  const current = visible.find((f) => f.id === selected) ?? visible[0];
  const approved = frames.filter((f) => statusOf(f.id) === 'approved').length;
  const threads = state.threads.filter(
    (thread) =>
      state.boardId === boardId &&
      !state.preview &&
      thread.elementId === current?.id &&
      thread.visibility === 'everyone' &&
      (threadFilter === 'all' || (threadFilter === 'resolved') === !!thread.resolvedAt),
  );
  if (state.preview)
    return (
      <section className="film-shell">
        <p>{t('clientReview.liveOnly')}</p>
      </section>
    );
  return (
    <section
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      className="film-shell client-review"
      aria-label={t('film.views.review')}
    >
      <header>
        <h1>
          {t('film.views.review')} {projectName}
        </h1>
      </header>
      <p id={`${id}-unavailable`}>{t('clientReview.roundsUnavailable')}</p>
      <Button disabled aria-describedby={`${id}-unavailable`}>
        {t('shells.submitReview')}
      </Button>
      {ready ? (
        <div className="client-review__progress">
          <label htmlFor={`${id}-progress`}>
            {t('clientReview.progress', { approved, total: frames.length })}
          </label>
          <progress id={`${id}-progress`} max={Math.max(1, frames.length)} value={approved} />
        </div>
      ) : (
        <p role={state.reviewsStatus === 'error' ? 'alert' : 'status'}>
          {t(state.reviewsStatus === 'error' ? 'review.loadError' : 'comments.loading')}
          {state.reviewsStatus === 'error' && (
            <Button onClick={() => refreshReviews('reviews')}>{t('comments.retry')}</Button>
          )}
        </p>
      )}
      <fieldset className="review-segments" disabled={!ready}>
        <legend>{t('review.filter')}</legend>
        {filters.map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {t(`clientReview.filters.${value}`)}
          </button>
        ))}
      </fieldset>
      <div className="client-review__layout">
        <section aria-label={t('nav.shotlist')} className="client-review__frames">
          {visible.length === 0 && (
            <p>{t(frames.length ? 'review.filteredEmpty' : 'shells.noShots')}</p>
          )}
          {visible.map((frame) => (
            <button
              type="button"
              className="client-review__frame"
              key={frame.id}
              aria-pressed={current?.id === frame.id}
              onClick={() => setSelected(frame.id)}
            >
              <FramePicture
                assetId={frame.assetId}
                aspect={frame.aspect}
                boardAspect={aspect}
                strokes={frame.strokes}
                pixels={360}
              />
              <strong>{labels.get(frame.id)}</strong>
              <span>{frame.action}</span>
              {ready &&
                (['none', 'in_review'].includes(statusOf(frame.id)) ? (
                  <span className="review-chip">{t('clientReview.filters.pending')}</span>
                ) : (
                  <ReviewChip status={statusOf(frame.id)} />
                ))}
            </button>
          ))}
        </section>
        {current && (
          <section
            className="client-review__detail"
            aria-label={labels.get(current.id)}
            key={current.id}
          >
            <h2>{labels.get(current.id)}</h2>
            <FramePicture
              assetId={current.assetId}
              aspect={current.aspect}
              boardAspect={aspect}
              strokes={current.strokes}
              pixels={960}
            />
            {ready && <ReviewSection elementId={current.id} />}
            <h3>{t('clientReview.guestThreads')}</h3>
            <p>{t('clientReview.audienceHint')}</p>
            <label>
              {t('comments.filter')}{' '}
              <select value={threadFilter} onChange={(e) => setThreadFilter(e.target.value)}>
                {['open', 'resolved', 'all'].map((value) => (
                  <option key={value} value={value}>
                    {t(`comments.filterStatus.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            {state.status === 'loading' && <p role="status">{t('comments.loading')}</p>}
            {state.status === 'error' && (
              <p role="alert">
                {t('comments.loadError')}{' '}
                <Button onClick={() => refreshReviews('comments')}>{t('comments.retry')}</Button>
              </p>
            )}
            {state.status === 'ready' && threads.length === 0 && <p>{t('comments.empty')}</p>}
            {state.status === 'ready' &&
              threads.map((thread) => (
                <Thread
                  key={thread.id}
                  thread={thread}
                  writable={canComment(state.role) && !state.preview}
                  targetLabel={labels.get(current.id) ?? ''}
                  pinNumber={0}
                  showTarget={false}
                  canJump={false}
                  onJump={() => {}}
                />
              ))}
          </section>
        )}
      </div>
    </section>
  );
}
