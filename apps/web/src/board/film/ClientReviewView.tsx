// SPDX-License-Identifier: AGPL-3.0-only
import { formatDuration } from '@inkadra/canvas-core';
import { SHOT_SIZES } from '@inkadra/doc-schema';
import type { ReviewStatus } from '@inkadra/shared';
import { Button, EmptyState, Select } from '@inkadra/ui';
import { type KeyboardEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../../lib/api.ts';
import { ReviewChip } from '../CardReview.tsx';
import { Thread } from '../CommentsPanel.tsx';
import { ReviewSection } from '../ReviewSection.tsx';
import { canComment, refreshReviews, useReviews } from '../review-store.ts';
import type { BoardStore } from '../store.ts';
import { useBoardAspect } from './aspect.ts';
import { FramePicture } from './FramePicture.tsx';
import { usePresetText } from './fields.tsx';
import { useStoryboard } from './storyboard-data.ts';
import './film.css';

const filters = ['all', 'pending', 'approved', 'changes_requested'] as const;
type Filter = (typeof filters)[number];
const decisions = ['approved', 'changes_requested'] as const;

/** Arrow keys step through the frames, except while typing. */
function typing(target: EventTarget) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function ClientReviewView({
  store,
  boardId,
}: {
  store: BoardStore;
  projectId?: string;
  boardId?: string;
  userId?: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const presetText = usePresetText();
  const { frames, labels } = useStoryboard(store);
  const aspect = useBoardAspect(store.doc);
  const state = useReviews((s) => s);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [threadFilter, setThreadFilter] = useState('open');
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const ready =
    !!boardId && state.boardId === boardId && !state.preview && state.reviewsStatus === 'ready';
  const statusOf = (elementId: string) => state.reviews.get(elementId)?.status ?? 'none';
  const matchesPending = (status: string) =>
    status !== 'approved' && status !== 'changes_requested';
  const matches = (elementId: string) => {
    const status = statusOf(elementId);
    return filter === 'all' || (filter === 'pending' ? matchesPending(status) : status === filter);
  };
  const visible = frames.filter((f) => !ready || matches(f.id));
  const currentIndex = Math.max(
    0,
    visible.findIndex((f) => f.id === selected),
  );
  const current = visible[currentIndex];
  const approved = frames.filter((f) => statusOf(f.id) === 'approved').length;
  const changes = frames.filter((f) => statusOf(f.id) === 'changes_requested').length;
  const writable = ready && canComment(state.role);
  const threads = state.threads.filter(
    (thread) =>
      state.boardId === boardId &&
      !state.preview &&
      thread.elementId === current?.id &&
      thread.visibility === 'everyone' &&
      (threadFilter === 'all' || (threadFilter === 'resolved') === !!thread.resolvedAt),
  );
  const step = (offset: number) => {
    const next = visible[currentIndex + offset];
    if (next) setSelected(next.id);
  };
  async function decide(elementId: string, status: ReviewStatus) {
    if (statusOf(elementId) === status) return;
    setDeciding(true);
    setDecisionError(null);
    try {
      await api.put(`/boards/${boardId}/elements/${elementId}/review`, { status });
      refreshReviews('reviews');
    } catch (err) {
      setDecisionError(
        t(
          err instanceof RequestError && err.status === 429
            ? 'comments.rateLimited'
            : 'review.error',
        ),
      );
    } finally {
      setDeciding(false);
    }
  }
  if (state.preview)
    return (
      <section className="client-review">
        <div className="board-state">
          <EmptyState icon="comment" title={t('film.views.review')}>
            {t('clientReview.liveOnly')}
          </EmptyState>
        </div>
      </section>
    );
  const shot = current ? presetText('film.shot', SHOT_SIZES, current.shot) : '';
  return (
    <section
      onKeyDown={(e: KeyboardEvent) => {
        e.stopPropagation();
        if (typing(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowRight') step(1);
      }}
      onKeyUp={(e) => e.stopPropagation()}
      className="client-review"
      aria-label={t('film.views.review')}
    >
      <div className="story__bar" data-chrome>
        <fieldset className="story__modes" aria-label={t('review.filter')} disabled={!ready}>
          {filters.map((value) => (
            <button
              type="button"
              key={value}
              className="story__mode"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(`clientReview.filters.${value}`)}
            </button>
          ))}
        </fieldset>
        <span className="ink-header__spacer" />
        {!ready && (
          <span
            className="story__total"
            role={state.reviewsStatus === 'error' ? 'alert' : 'status'}
          >
            {t(state.reviewsStatus === 'error' ? 'review.loadError' : 'comments.loading')}
          </span>
        )}
        {state.reviewsStatus === 'error' && (
          <Button onClick={() => refreshReviews('reviews')}>{t('comments.retry')}</Button>
        )}
      </div>
      <div className="story__main">
        <section aria-label={t('nav.shotlist')} className="client-review__frames" data-scroll>
          {visible.length === 0 && (
            <p className="schedule__hint">
              {t(frames.length ? 'review.filteredEmpty' : 'shells.noShots')}
            </p>
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
              <span className="client-review__frame-meta">
                <strong>{labels.get(frame.id)}</strong>
                {ready && (
                  <ReviewChip
                    status={statusOf(frame.id)}
                    compact
                    // "Pending" groups the open statuses, as the filter above does.
                    label={
                      matchesPending(statusOf(frame.id))
                        ? t('clientReview.filters.pending')
                        : undefined
                    }
                  />
                )}
              </span>
              {frame.action && <span className="client-review__frame-action">{frame.action}</span>}
            </button>
          ))}
        </section>
        <div className="client-review__stage" data-scroll>
          {current ? (
            <>
              <div className="client-review__picture">
                <Button
                  variant="ghost"
                  className="client-review__step"
                  aria-label={t('clientReview.previous')}
                  data-ink-tooltip={t('clientReview.previous')}
                  disabled={currentIndex === 0}
                  onClick={() => step(-1)}
                >
                  ‹
                </Button>
                <FramePicture
                  key={current.id}
                  assetId={current.assetId}
                  aspect={current.aspect}
                  boardAspect={aspect}
                  strokes={current.strokes}
                  pixels={960}
                />
                <Button
                  variant="ghost"
                  className="client-review__step"
                  aria-label={t('clientReview.next')}
                  data-ink-tooltip={t('clientReview.next')}
                  disabled={currentIndex >= visible.length - 1}
                  onClick={() => step(1)}
                >
                  ›
                </Button>
              </div>
              <p className="client-review__caption">
                <strong>{labels.get(current.id)}</strong>
                {shot && <span>{shot}</span>}
                {current.durationMs !== undefined && (
                  <span className="story__tile-duration">{formatDuration(current.durationMs)}</span>
                )}
                {current.action && (
                  <span className="client-review__caption-action">{current.action}</span>
                )}
                <span className="ink-header__spacer" />
                <span className="story__tile-duration">
                  {t('clientReview.position', {
                    index: currentIndex + 1,
                    total: visible.length,
                  })}
                </span>
              </p>
            </>
          ) : (
            <div className="board-state">
              <EmptyState icon="storyboard" title={t('film.views.review')}>
                {t(frames.length ? 'review.filteredEmpty' : 'shells.noShots')}
              </EmptyState>
            </div>
          )}
        </div>
        {(current || ready) && (
          <aside
            className="client-review__panel"
            aria-label={current ? labels.get(current.id) : t('film.views.review')}
            key={current?.id ?? ''}
          >
            {current && (
              <div className="client-review__panel-body" data-scroll>
                <header className="client-review__panel-head">
                  <h2>{labels.get(current.id)}</h2>
                  {writable && <span className="ink-muted">{t('clientReview.yourDecision')}</span>}
                </header>
                {writable && (
                  <fieldset
                    className="story__modes client-review__decision"
                    aria-label={t('clientReview.yourDecision')}
                  >
                    {decisions.map((value) => (
                      <button
                        type="button"
                        key={value}
                        className="story__mode"
                        aria-pressed={statusOf(current.id) === value}
                        disabled={deciding}
                        onClick={() => void decide(current.id, value)}
                      >
                        {t(value === 'approved' ? 'shells.approve' : 'shells.requestChanges')}
                      </button>
                    ))}
                  </fieldset>
                )}
                {decisionError && (
                  <p role="alert" className="review-error">
                    {decisionError}
                  </p>
                )}
                {ready && <ReviewSection elementId={current.id} />}
                <div className="client-review__threads-head">
                  <h3>{t('clientReview.guestThreads')}</h3>
                  <Select
                    className="ink-input"
                    aria-label={t('comments.filter')}
                    value={threadFilter}
                    onChange={(e) => setThreadFilter(e)}
                  >
                    {['open', 'resolved', 'all'].map((value) => (
                      <option key={value} value={value}>
                        {t(`comments.filterStatus.${value}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <p className="schedule__hint">{t('clientReview.audienceHint')}</p>
                {state.status === 'loading' && (
                  <p role="status" className="schedule__hint">
                    {t('comments.loading')}
                  </p>
                )}
                {state.status === 'error' && (
                  <p role="alert" className="review-error">
                    {t('comments.loadError')}{' '}
                    <Button variant="ghost" onClick={() => refreshReviews('comments')}>
                      {t('comments.retry')}
                    </Button>
                  </p>
                )}
                {state.status === 'ready' && threads.length === 0 && (
                  <p className="schedule__hint">{t('comments.empty')}</p>
                )}
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
              </div>
            )}
            {ready && (
              <footer className="client-review__progress">
                <div className="client-review__progress-row">
                  <label htmlFor={`${id}-progress`}>
                    {t('clientReview.progress', { approved, total: frames.length })}
                  </label>
                  <span className="ink-muted">
                    {t('clientReview.breakdown', {
                      changes,
                      pending: frames.length - approved - changes,
                    })}
                  </span>
                </div>
                <progress id={`${id}-progress`} max={Math.max(1, frames.length)} value={approved} />
              </footer>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
