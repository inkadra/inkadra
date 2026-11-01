// SPDX-License-Identifier: AGPL-3.0-only
import { REACTION_EMOJIS, type ReactionEmoji, type ReactionSummary } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './review.css';

/**
 * Quick reactions (#334) as compact chips with counts; a chip toggles your own reaction and
 * its title lists who reacted. With `onToggle` a "+" opens the small fixed set to pick from.
 * Used under comments, on the board's cards and on the guest page.
 */
export function ReactionBar({
  reactions,
  onToggle,
  className = '',
}: {
  reactions: readonly ReactionSummary[];
  /** Absent when the person may only look. */
  onToggle?: (emoji: ReactionEmoji, on: boolean) => Promise<unknown>;
  className?: string;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = async (emoji: ReactionEmoji, on: boolean) => {
    if (!onToggle) return;
    setBusy(true);
    try {
      await onToggle(emoji, on);
    } catch {
      // Nothing to undo: the chips still show what the server has.
    } finally {
      setBusy(false);
    }
  };
  if (reactions.length === 0 && !onToggle) return null;
  return (
    <fieldset className={`reaction-bar ${className}`.trim()}>
      <legend className="review-hidden">{t('comments.reactions')}</legend>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={r.mine ? 'reaction-chip is-mine' : 'reaction-chip'}
          aria-pressed={r.mine}
          disabled={!onToggle || busy}
          title={r.names.join(', ')}
          aria-label={t('comments.reactionChip', {
            emoji: r.emoji,
            count: r.count,
            names: r.names.join(', '),
          })}
          onClick={() => void toggle(r.emoji, !r.mine)}
        >
          <span aria-hidden="true">{r.emoji}</span> {r.count}
        </button>
      ))}
      {onToggle && (
        <>
          <button
            type="button"
            className="reaction-chip reaction-add"
            aria-expanded={picking}
            aria-label={t('comments.reactAdd')}
            onClick={() => setPicking((v) => !v)}
          >
            <Icon name="plus" size={12} />
          </button>
          {picking &&
            REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="reaction-chip reaction-pick"
                disabled={busy}
                aria-label={t('comments.reactWith', { emoji })}
                onClick={() => {
                  setPicking(false);
                  void toggle(emoji, !reactions.find((r) => r.emoji === emoji)?.mine);
                }}
              >
                {emoji}
              </button>
            ))}
        </>
      )}
    </fieldset>
  );
}
