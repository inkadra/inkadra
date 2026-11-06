import type { Element } from '@inkadra/doc-schema';
import type { CommentThread } from '@inkadra/shared';
import { Dialog, Icon, type IconName, Switch } from '@inkadra/ui';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { Composer, threadAudience, useCardLabel } from './CommentsPanel.tsx';
import { NOTE_COLORS } from './cards.tsx';
import type { MenuItem, SheetSlot } from './chrome.tsx';
import { authorName, commentParts } from './review-model.ts';
import { canComment, refreshReviews, useReviews } from './review-store.ts';
import type { BoardStore } from './store.ts';

type Action = Extract<MenuItem, { label: string }>;

/** The card menu's actions picked out by their place in the sheet; the rest stay in order. */
export function splitSheetItems(items: readonly MenuItem[]) {
  const slots = new Map<SheetSlot, Action>();
  const rest: MenuItem[] = [];
  for (const item of items) {
    if ('label' in item && item.sheet) slots.set(item.sheet, item);
    else rest.push(item);
  }
  // Separators at the edges, or two in a row, are left from the items taken out.
  const tidy = rest.filter(
    (item, i) =>
      !item.divider ||
      (i > 0 && i < rest.length - 1 && !rest[i - 1]?.divider && !rest[i + 1]?.heading),
  );
  return { slots, rest: tidy };
}

/**
 * On a phone the card menu (⋯ or a long press) is a sheet from the bottom edge (#110): quick
 * actions on top, then the rows of the mockup, every other action of the menu, Delete and a reply
 * to the card's last comment. It only rearranges what the menu permits, plus the phone's own
 * Edit, Colour, Connect and Move.
 */
export function CardSheet({
  store,
  elements,
  items,
  onEdit,
  onColor,
  onConnect,
  moveTargets,
  guestShown,
  reply,
  onClose,
}: {
  store: BoardStore;
  /** The selection the menu acts on. */
  elements: readonly Element[];
  items: readonly MenuItem[];
  onEdit?: () => void;
  /** Present when every selected card takes a colour. */
  onColor?: (color: (typeof NOTE_COLORS)[number] | undefined) => void;
  onConnect?: () => void;
  /** Columns of the board the selection can move into. */
  moveTargets: ReadonlyArray<{ id: string; label: string; action: () => void }>;
  /** The selection is shown to guests; the switch flips it through the menu's own action. */
  guestShown: boolean;
  reply?: { boardId: string; elementId: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const cardLabel = useCardLabel(store);
  const { slots, rest } = splitSheetItems(items);
  const single = elements.length === 1 ? elements[0] : undefined;
  const kind = single && t(`board.types.${single.type}`);
  const name = single && cardLabel.label(single.id);
  const title = single
    ? name && name !== kind
      ? `${kind} · ${name}`
      : (kind ?? '')
    : t('board.selected', { count: elements.length });
  const [open, setOpen] = useState<'color' | 'move' | null>(null);
  const colorsId = useId();
  const moveId = useId();
  // Every action closes the sheet first, as the menu does; one that opens a list reopens it.
  const run = (action?: () => void) => () => {
    onClose();
    action?.();
  };
  const toUnsorted = slots.get('unsorted');
  const guest = slots.get('guest');
  const lock = slots.get('lock');
  const quick: Array<{ key: string; icon: IconName; label: string; action: () => void }> = [];
  if (onEdit)
    quick.push({ key: 'edit', icon: 'pen', label: t('board.sheet.edit'), action: onEdit });
  const comment = slots.get('comment');
  if (comment?.action)
    quick.push({
      key: 'comment',
      icon: 'comment',
      label: t('board.sheet.comment'),
      action: comment.action,
    });
  const duplicate = slots.get('duplicate');
  return (
    <div className="phone-sheet card-sheet">
      <Dialog open title={title} onClose={onClose}>
        <div className="card-sheet__quick">
          {quick.map((q) => (
            <QuickButton key={q.key} icon={q.icon} label={q.label} onClick={run(q.action)} />
          ))}
          {onColor && (
            <QuickButton
              icon="color"
              label={t('board.sheet.color')}
              expanded={open === 'color'}
              controls={colorsId}
              onClick={() => setOpen((o) => (o === 'color' ? null : 'color'))}
            />
          )}
          {onConnect && (
            <QuickButton icon="arrow" label={t('board.sheet.connect')} onClick={run(onConnect)} />
          )}
          {duplicate?.action && (
            <QuickButton icon="copy" label={duplicate.label} onClick={run(duplicate.action)} />
          )}
          {lock?.action && (
            <QuickButton
              icon={lock.label === t('board.menu.unlock') ? 'unlock' : 'lock'}
              label={lock.label}
              onClick={run(lock.action)}
            />
          )}
        </div>
        {onColor && open === 'color' && (
          <fieldset id={colorsId} className="card-sheet__colors">
            <legend className="ink-sr-only">{t('board.sheet.color')}</legend>
            {[undefined, ...NOTE_COLORS].map((c) => (
              <button
                key={c ?? 'none'}
                type="button"
                className={`ctxbar__swatch${c ? ` ctxbar__swatch--${c}` : ''}`}
                aria-label={t(c ? `board.colors.${c}` : 'board.colors.none')}
                onClick={() => onColor(c)}
              />
            ))}
          </fieldset>
        )}
        <div className="card-sheet__rows">
          {(moveTargets.length > 0 || toUnsorted) && (
            <>
              <Row
                label={t('board.sheet.moveTo')}
                expanded={open === 'move'}
                controls={moveId}
                onClick={() => setOpen((o) => (o === 'move' ? null : 'move'))}
              >
                <Icon name={open === 'move' ? 'chevronDown' : 'chevronRight'} size={14} />
              </Row>
              {open === 'move' && (
                <ul id={moveId} className="card-sheet__sub">
                  {moveTargets.map((m) => (
                    <li key={m.id}>
                      <Row label={m.label} onClick={run(m.action)} />
                    </li>
                  ))}
                  {toUnsorted && (
                    <li>
                      <Row label={t('nav.unsorted')} onClick={run(toUnsorted.action)} />
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
          {guest?.action && (
            <label className="card-sheet__row">
              <span className="card-sheet__label">{t('board.sheet.showGuests')}</span>
              <Switch checked={guestShown} onChange={guest.action} />
            </label>
          )}
          {slots.get('storyboard') && (
            <Row
              label={t('board.sheet.toStoryboard')}
              onClick={run(slots.get('storyboard')?.action)}
            >
              <Icon name="chevronRight" size={14} />
            </Row>
          )}
          {rest.map((item, i) =>
            item.divider ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: dividers have no identity
              <hr key={`d${i}`} className="card-sheet__divider" />
            ) : item.heading !== undefined ? (
              <p key={item.heading} className="card-sheet__heading">
                {item.heading}
              </p>
            ) : (
              <Row
                key={item.label}
                label={item.label}
                content={item.content}
                hint={item.hint}
                disabled={item.disabled}
                current={item.checked}
                onClick={run(item.action)}
              >
                {item.checked && <Icon name="check" size={14} />}
              </Row>
            ),
          )}
          {slots.get('delete') && (
            <Row
              danger
              label={slots.get('delete')?.label ?? ''}
              onClick={run(slots.get('delete')?.action)}
            />
          )}
        </div>
        {reply && <Reply {...reply} />}
      </Dialog>
    </div>
  );
}

function QuickButton({
  icon,
  label,
  onClick,
  expanded,
  controls,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      className="card-sheet__quick-btn"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

function Row({
  label,
  content,
  hint,
  disabled,
  danger,
  current,
  expanded,
  controls,
  onClick,
  children,
}: {
  label: string;
  content?: ReactNode;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  danger?: boolean;
  current?: boolean | undefined;
  expanded?: boolean;
  controls?: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  const hintId = useId();
  return (
    <button
      type="button"
      className={`card-sheet__row${danger ? ' is-danger' : ''}`}
      aria-label={content ? label : undefined}
      aria-disabled={disabled || undefined}
      aria-describedby={hint ? hintId : undefined}
      aria-current={current || undefined}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={disabled ? undefined : onClick}
    >
      <span className="card-sheet__label">{content ?? label}</span>
      {hint && (
        <span id={hintId} className="ink-muted card-sheet__hint">
          {hint}
        </span>
      )}
      {children}
    </button>
  );
}

const latest = (thread: CommentThread) => (thread.replies.at(-1) ?? thread).createdAt;

/**
 * The card's latest open thread and the comments' composer to answer it, without leaving the sheet:
 * a thread guests read says so, and only the button sends to it.
 */
export function Reply({ boardId, elementId }: { boardId: string; elementId: string }) {
  const { t } = useTranslation();
  const role = useReviews((s) => s.role);
  const threads = useReviews((s) => s.threads);
  const thread = threads
    .filter((th) => th.elementId === elementId && !th.resolvedAt && !th.deletedAt)
    .sort((a, b) => latest(b).localeCompare(latest(a)))[0];
  if (!thread || !canComment(role)) return null;
  const last = thread.replies.at(-1) ?? thread;
  const name = authorName(last.author) ?? '';
  const audience = threadAudience(thread, t);
  return (
    <div className="card-sheet__reply">
      <p className="card-sheet__comment" data-feedback-secret>
        <b>{name}</b>{' '}
        {commentParts(last).map((part, i) =>
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed text
          'text' in part ? <span key={i}>{part.text}</span> : <span key={i}>@{part.mention}</span>,
        )}
      </p>
      {audience && (
        <p className="comment-audience">
          <Icon name="people" size={14} />
          <span>{audience}</span>
        </p>
      )}
      <Composer
        publicAudience={thread.visibility !== 'team'}
        placeholder={t('board.sheet.replyTo', { name })}
        submitLabel={t('comments.sendReply')}
        onSend={async (body) => {
          await api.post(`/boards/${boardId}/comments`, { body, parentId: thread.id });
          refreshReviews('comments', elementId);
        }}
      />
    </div>
  );
}
