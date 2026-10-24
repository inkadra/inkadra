// SPDX-License-Identifier: AGPL-3.0-only
import { Icon, type IconName } from '@inkadra/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { type KnownReviewStatus, reviewKey } from './review-model.ts';
import { openComments, placePin, useReviews } from './review-store.ts';
import './review.css';

const STATUS_ICONS: Record<KnownReviewStatus, IconName> = {
  none: 'minus',
  in_review: 'clock',
  approved: 'check',
  changes_requested: 'pen',
};

/** Review status with an icon and a word, so it never depends on colour. */
export function ReviewChip({ status, compact = false }: { status: string; compact?: boolean }) {
  const { t } = useTranslation();
  const key = reviewKey(status);
  return (
    <span className={`review-chip review-chip--${key}`}>
      <Icon name={STATUS_ICONS[key]} size={12} />
      <span className={compact ? 'review-chip__label--compact' : undefined}>
        {t(`review.status.${key}`)}
      </span>
    </span>
  );
}

/**
 * What a card shows of its comments and review: nothing until there is something to show. It
 * reads the board's shared data through selectors, so it never fetches nor re-renders others.
 */
export const CardReview = memo(function CardReview({ elementId }: { elementId: string }) {
  const { t } = useTranslation();
  const count = useReviews((s) => s.counts.get(elementId));
  const review = useReviews((s) => s.reviews.get(elementId));
  const pins = useReviews((s) => s.pins.get(elementId));
  const placing = useReviews((s) => s.pinTarget === elementId);
  const open = count?.open ?? 0;
  const status = review && review.status !== 'none' ? review.status : null;
  if (!open && !status && !pins && !placing) return null;
  return (
    <>
      {(open > 0 || status) && (
        <div className="card-review" data-no-drag>
          {status && (
            <button
              type="button"
              className="card-review__button"
              aria-label={t('review.cardStatus', {
                status: t(`review.status.${reviewKey(status)}`),
              })}
              onClick={() => openComments({ elementId })}
            >
              <ReviewChip status={status} compact />
            </button>
          )}
          {open > 0 && (
            <button
              type="button"
              className="card-review__button card-review__count"
              aria-label={t('comments.cardCount', { count: open })}
              onClick={() => openComments({ elementId })}
            >
              <Icon name="comment" size={12} />
              {open}
            </button>
          )}
        </div>
      )}
      {pins?.map((thread, index) =>
        thread.pin ? (
          <button
            key={thread.id}
            type="button"
            className="comment-pin"
            data-no-drag
            style={{ left: `${thread.pin.x * 100}%`, top: `${thread.pin.y * 100}%` }}
            aria-label={t('comments.pinOpen', { number: index + 1 })}
            onClick={() => openComments({ elementId, threadId: thread.id })}
          >
            {index + 1}
          </button>
        ) : null,
      )}
      {placing && (
        <button
          type="button"
          className="comment-pin-target"
          ref={(node) => node?.focus()}
          data-no-drag
          aria-label={t('comments.pinPlace')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              placePin(null);
              openComments({ elementId });
            }
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            // Enter or Space click with no position: the centre of the card.
            const pin =
              e.detail === 0
                ? { x: 0.5, y: 0.5 }
                : {
                    x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
                    y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
                  };
            openComments({ elementId, pin });
          }}
        >
          <span>{t('comments.pinPlace')}</span>
        </button>
      )}
    </>
  );
});
