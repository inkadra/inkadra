import type { Element } from '@inkadra/doc-schema';
import type { GuestElementReview, PickValue } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGuestActions } from './actions.ts';
import { isPicture, shownStatus, togglePick, toggleStars } from './model.ts';

/** What a guest sees and does on a card: the review status, comments, and picks. */
export function GuestCardExtras({ element }: { element: Element }) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  if (element.type === 'arrow' || element.type === 'column' || element.type === 'scene')
    return null;
  const review = actions.reviews.get(element.id);
  const count = actions.counts.get(element.id);
  const picture = actions.rights.pick && isPicture(element);
  const status = shownStatus(review?.status);
  if (!picture && status === 'none' && !count?.open) return null;
  return (
    // Keys pressed on these controls are theirs, not the canvas's shortcuts.
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops key events from bubbling
    <div
      className="guest-extras"
      data-no-drag
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      {status !== 'none' && <ReviewChip review={review} />}
      {!!count?.open && (
        <span
          className="guest-extras__count"
          title={t('guest.comments.count', { count: count.open })}
        >
          <Icon name="inbox" size={12} />
          <span aria-hidden="true">{count.open}</span>
          <span className="guest-sr">{t('guest.comments.count', { count: count.open })}</span>
        </span>
      )}
      {picture && <PickControls elementId={element.id} compact />}
    </div>
  );
}

export function ReviewChip({ review }: { review: GuestElementReview | undefined }) {
  const { t } = useTranslation();
  const status = shownStatus(review?.status);
  if (status === 'none') return null;
  return (
    <span className={`guest-chip guest-chip--${status}`}>{t(`guest.review.status.${status}`)}</span>
  );
}

/** Scelgo / scarto and 1–5 stars; a second click on the current choice clears it. */
export function PickControls({ elementId, compact }: { elementId: string; compact?: boolean }) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  const current = actions.picks.get(elementId);
  const [busy, setBusy] = useState(false);

  const run = (body: Parameters<typeof actions.pick>[1]) =>
    actions.withName(async () => {
      setBusy(true);
      try {
        await actions.pick(elementId, body);
        actions.notify(null);
      } catch (err) {
        actions.notify(err instanceof Error ? err.message : t('guest.errors.generic'));
      } finally {
        setBusy(false);
      }
    });

  const choice = (value: PickValue) => (
    <button
      type="button"
      className={`guest-pick guest-pick--${value}`}
      aria-pressed={current?.pick === value}
      disabled={busy}
      onClick={() => run(togglePick(current, value))}
    >
      {t(`guest.pick.${value}`)}
    </button>
  );

  return (
    <fieldset className={compact ? 'guest-picks guest-picks--compact' : 'guest-picks'}>
      <legend className="guest-sr">{t('guest.pick.label')}</legend>
      {choice('picked')}
      {choice('rejected')}
      <span className="guest-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className="guest-star"
            aria-pressed={current?.stars === n}
            aria-label={t('guest.pick.star', { count: n })}
            data-ink-tooltip={t('guest.pick.star', { count: n })}
            disabled={busy}
            data-on={(current?.stars ?? 0) >= n || undefined}
            onClick={() => run(toggleStars(current, n))}
          >
            <Icon name="star" size={compact ? 12 : 14} />
          </button>
        ))}
      </span>
    </fieldset>
  );
}
