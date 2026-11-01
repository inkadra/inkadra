// SPDX-License-Identifier: AGPL-3.0-only
import type { Author, ElementReviewEvent, ReviewStatus } from '@inkadra/shared';
import { Button, ChoiceTile } from '@inkadra/ui';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../lib/api.ts';
import { formatDateTime } from '../lib/datetime.ts';
import { ReviewChip } from './CardReview.tsx';
import { GuestTag } from './GuestTag.tsx';
import { authorName, type Page, REVIEW_STATUSES } from './review-model.ts';
import { canComment, getReviews, refreshReviews, useReviews } from './review-store.ts';

function Attribution({ author, at }: { author: Author; at: string }) {
  const { t } = useTranslation();
  return (
    <span className="comment-author">
      <strong>{authorName(author) ?? t('comments.deletedAuthor')}</strong>
      <GuestTag author={author} />
      <time dateTime={at}>{formatDateTime(at, { dateStyle: 'medium', timeStyle: 'short' })}</time>
    </span>
  );
}

/** Review status of a card in the comments panel: current status, change it, history. */
export function ReviewSection({ elementId }: { elementId: string }) {
  const { t } = useTranslation();
  const current = useReviews((s) => s.reviews.get(elementId));
  const writable = useReviews((s) => canComment(s.role));
  const known = (value: string | undefined): value is ReviewStatus =>
    !!value && (REVIEW_STATUSES as readonly string[]).includes(value);
  const [status, setStatus] = useState<ReviewStatus>('in_review');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  return (
    <section className="review-section" aria-labelledby={`${id}-title`}>
      <div className="review-row review-row--between">
        <h3 id={`${id}-title`}>{t('review.title')}</h3>
        <ReviewChip status={current?.status ?? 'none'} />
      </div>
      {current && (
        <div className="review-current">
          <Attribution author={current.changedBy} at={current.changedAt} />
          {current.note && <p className="comment-body">{current.note}</p>}
        </div>
      )}
      <div className="review-row">
        {/* A status this client does not know is shown without actions. */}
        {writable && known(current?.status ?? 'none') && (
          <Button
            icon="pen"
            aria-expanded={editing}
            onClick={() => {
              if (!editing) setStatus(known(current?.status) ? current.status : 'in_review');
              setEditing((v) => !v);
            }}
          >
            {t('review.change')}
          </Button>
        )}
        <Button
          variant="ghost"
          icon="clock"
          aria-expanded={history}
          aria-controls={`${id}-history`}
          onClick={() => setHistory((v) => !v)}
        >
          {t('review.history')}
        </Button>
      </div>
      {writable && editing && (
        <form
          className="review-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const { boardId } = getReviews();
              await api.put(`/boards/${boardId}/elements/${elementId}/review`, {
                status,
                ...(note.trim() ? { note: note.trim() } : {}),
              });
              setNote('');
              setEditing(false);
              refreshReviews('reviews');
            } catch (err) {
              setError(
                t(
                  err instanceof RequestError && err.status === 429
                    ? 'comments.rateLimited'
                    : 'review.error',
                ),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset className="review-statuses">
            <legend>{t('review.set')}</legend>
            {REVIEW_STATUSES.map((value) => (
              <ChoiceTile
                key={value}
                name={`${id}-status`}
                value={value}
                checked={status === value}
                onChange={() => setStatus(value)}
              >
                <ReviewChip status={value} />
              </ChoiceTile>
            ))}
          </fieldset>
          <label className="review-field">
            {t('review.note')}
            <textarea
              className="ink-input"
              rows={2}
              maxLength={500}
              value={note}
              readOnly={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="review-row">
            <Button type="submit" variant="primary" disabled={busy}>
              {t('review.apply')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              {t('comments.cancel')}
            </Button>
          </div>
          {error && (
            <p role="alert" className="review-error">
              {error}
            </p>
          )}
        </form>
      )}
      {history && <ReviewHistory id={`${id}-history`} elementId={elementId} />}
    </section>
  );
}

function ReviewHistory({ id, elementId }: { id: string; elementId: string }) {
  const { t } = useTranslation();
  const boardId = useReviews((s) => s.boardId);
  // A change made while the history is open shows up in it.
  const revision = useReviews((s) => s.reviewsRevision);
  const [items, setItems] = useState<ElementReviewEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const path = `/boards/${boardId}/elements/${elementId}/review/history`;

  useEffect(() => {
    let alive = true;
    void revision;
    api
      .get<Page<ElementReviewEvent>>(path)
      .then((p) => {
        if (!alive) return;
        setItems(p.items);
        setNext(p.nextCursor);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);

  const more = async () => {
    if (!next) return;
    setState('loading');
    try {
      const p = await api.get<Page<ElementReviewEvent>>(
        `${path}?cursor=${encodeURIComponent(next)}`,
      );
      setItems((list) => [...list, ...p.items]);
      setNext(p.nextCursor);
      setState('ready');
    } catch {
      setState('error');
    }
  };

  return (
    <section id={id} className="review-history" aria-label={t('review.history')}>
      {state === 'ready' && items.length === 0 && (
        <p className="ink-muted">{t('review.noHistory')}</p>
      )}
      {items.length > 0 && (
        <ol>
          {items.map((event) => (
            <li key={event.id}>
              <span className="review-row">
                <ReviewChip status={event.previous} compact />
                <span aria-hidden="true">→</span>
                <span className="review-hidden">{t('review.to')}</span>
                <ReviewChip status={event.status} />
              </span>
              <Attribution author={event.changedBy} at={event.changedAt} />
              {event.note && <p className="comment-body">{event.note}</p>}
            </li>
          ))}
        </ol>
      )}
      {state === 'loading' && (
        <p role="status" className="ink-muted">
          {t('comments.loading')}
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="review-error">
          {t('review.historyError')}
        </p>
      )}
      {next && state !== 'loading' && (
        <Button variant="ghost" onClick={() => void more()}>
          {t('review.moreHistory')}
        </Button>
      )}
    </section>
  );
}
