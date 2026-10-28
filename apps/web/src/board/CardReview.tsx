// SPDX-License-Identifier: AGPL-3.0-only
import { Icon, type IconName } from '@inkadra/ui';
import { memo, useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GuestModeContext } from './context.ts';
import { type KnownReviewStatus, reviewKey } from './review-model.ts';
import { openComments, useReviews } from './review-store.ts';
import './review.css';

const STATUS_ICONS: Record<KnownReviewStatus, IconName> = {
  none: 'minus',
  in_review: 'clock',
  approved: 'check',
  changes_requested: 'pen',
};

/** Review status with an icon and a word, so it never depends on colour. */
export function ReviewChip({
  status,
  compact = false,
  label,
}: {
  status: string;
  compact?: boolean;
  /** Replaces the status name, e.g. a view that groups statuses under its own filter name. */
  label?: string;
}) {
  const { t } = useTranslation();
  const key = reviewKey(status);
  return (
    <span className={`review-chip review-chip--${key}`}>
      <Icon name={STATUS_ICONS[key]} size={12} />
      <span className={compact ? 'review-chip__label--compact' : undefined}>
        {label ?? t(`review.status.${key}`)}
      </span>
    </span>
  );
}

/**
 * What a card shows of its comments and review: nothing until there is something to show. It
 * reads the board's shared data through selectors, so it never fetches nor re-renders others.
 * Pins are fractions of the card on the canvas, so other views (`withPins` false) show only
 * the badges; nothing shows while a version is previewed nor on the guest page, which has its
 * own review controls.
 */
export const CardReview = memo(function CardReview({
  elementId,
  withPins = true,
  shifted = false,
}: {
  elementId: string;
  withPins?: boolean;
  /** Move the badges left: the card's lock badge already sits in that corner. */
  shifted?: boolean;
}) {
  const { t } = useTranslation();
  const guest = useContext(GuestModeContext);
  const hidden = useReviews((s) => s.preview) || guest;
  const count = useReviews((s) => s.counts.get(elementId));
  const review = useReviews((s) => s.reviews.get(elementId));
  const allPins = useReviews((s) => s.pins.get(elementId));
  const pinTarget = useReviews((s) => s.pinTarget === elementId);
  const pins = withPins ? allPins : undefined;
  const placing = withPins && pinTarget;
  const open = count?.open ?? 0;
  const status = review && review.status !== 'none' ? review.status : null;
  if (hidden || (!open && !status && !pins && !placing)) return null;
  return (
    <>
      {(open > 0 || status) && (
        <div className={`card-review${shifted ? ' card-review--shifted' : ''}`} data-no-drag>
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
      {placing && <PinTarget elementId={elementId} />}
    </>
  );
});

/** Covers the card while the point of a new pinned comment is chosen. */
function PinTarget({ elementId }: { elementId: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      className="comment-pin-target"
      data-no-drag
      aria-label={t('comments.pinPlace')}
      onKeyDown={(e) => {
        // Keys chosen here are not board shortcuts (Enter would edit the card).
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          openComments({ elementId });
        }
      }}
      onKeyUp={(e) => e.stopPropagation()}
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
  );
}
