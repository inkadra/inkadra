// SPDX-License-Identifier: AGPL-3.0-only
import { type Element, roots } from '@inkadra/doc-schema';
import {
  type Author,
  type Comment,
  type CommentThread,
  type CommentVisibility,
  MAX_COMMENT_LENGTH,
  type UserSummary,
} from '@inkadra/shared';
import { Button, Icon, IconButton } from '@inkadra/ui';
import {
  type FormEvent,
  type KeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import * as Y from 'yjs';
import { api, RequestError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { ReviewChip } from './CardReview.tsx';
import { commentPanelPosition } from './comment-panel-position.ts';
import { GuestTag } from './GuestTag.tsx';
import { plainText } from './note.tsx';
import { ReviewSection } from './ReviewSection.tsx';
import {
  authorName,
  commentParts,
  editableText,
  encodeMentions,
  mentionQuery,
  mergeReplies,
  REVIEW_STATUSES,
  shareLinkTag,
} from './review-model.ts';
import {
  addOlderReplies,
  type CommentTarget,
  canComment,
  closeComments,
  getDraft,
  getReviews,
  openComments,
  placePin,
  refreshReviews,
  saveDraft,
  useReviews,
} from './review-store.ts';
import type { BoardStore } from './store.ts';
import { fetchReplies } from './use-board-reviews.ts';
import './review.css';

const THREADS_PAGE = 30;

/** Header button of the board: opens the comments panel, with the number of open threads. */
export function CommentsButton() {
  const { t } = useTranslation();
  const boardId = useReviews((s) => s.boardId);
  const counts = useReviews((s) => s.counts);
  const isOpen = useReviews((s) => s.target !== null);
  const preview = useReviews((s) => s.preview);
  if (!boardId || preview) return null;
  let open = 0;
  for (const c of counts.values()) open += c.open;
  return (
    <>
      <Button
        icon="comment"
        className="comments-button"
        aria-expanded={isOpen}
        aria-label={t('comments.button', { count: open })}
        onClick={() => (isOpen ? closeComments() : openComments())}
      >
        <span className="comments-button__label">{t('comments.title')}</span>
        {open > 0 && <span className="review-count">{open}</span>}
      </Button>
      {isOpen && createPortal(<CommentsPanel key={boardId} />, document.body)}
    </>
  );
}

/**
 * What a card is called in the panel: its label, title or caption, else its type. Labels of
 * non-note cards are kept per element object; note labels read the live Y.XmlFragment body.
 */
export function useCardLabel(store: BoardStore | undefined) {
  const { t } = useTranslation();
  const snap = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? noSnapshot,
  );
  const [bodyRevision, bumpBody] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!store) return;
    const { elements } = roots(store.doc);
    const onEvents = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
      if (events.some((e) => e.path[1] === 'body')) bumpBody();
    };
    elements.observeDeep(onEvents);
    return () => elements.unobserveDeep(onEvents);
  }, [store]);
  const cache = useRef(new WeakMap<Element, string>());
  return useMemo(() => {
    void bodyRevision;
    const labels = cache.current;
    return {
      exists: (id: string) => !!snap?.byId.get(id),
      elements: () => (snap ? [...snap.byId.values()] : []),
      label: (id: string | null) => cardLabelOf(snap, store, labels, t, id),
    };
  }, [snap, store, t, bodyRevision]);
}

export function cardLabelOf(
  snap: ReturnType<BoardStore['getSnapshot']> | null,
  store: BoardStore | undefined,
  cache: WeakMap<Element, string>,
  t: (key: string) => string,
  id: string | null,
): string {
  if (id === null) return t('comments.board');
  const card = snap?.byId.get(id) as (Element & Record<string, unknown>) | undefined;
  if (!card) return t('comments.removed');
  if (card.type === 'note') return cardLabel(card, store, t);
  const known = cache.get(card);
  if (known !== undefined) return known;
  const label = cardLabel(card, store, t);
  cache.set(card, label);
  return label;
}

function cardLabel(
  card: Element & Record<string, unknown>,
  store: BoardStore | undefined,
  t: (key: string) => string,
): string {
  const body = card.type === 'note' ? store?.map(card.id)?.get('body') : undefined;
  if (body instanceof Y.XmlFragment) {
    const text = plainText(body).trim().split('\n')[0]?.slice(0, 80);
    if (text) return text;
  }
  for (const key of ['label', 'title', 'caption', 'name'] as const) {
    const value = card[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return t(`board.types.${card.type}`);
}
const noSubscribe = () => () => {};
const noSnapshot = () => null;

function CommentsPanel() {
  const { t } = useTranslation();
  const target = useReviews((s) => s.target);
  const threads = useReviews((s) => s.threads);
  const status = useReviews((s) => s.status);
  const reviewsStatus = useReviews((s) => s.reviewsStatus);
  const reviews = useReviews((s) => s.reviews);
  const pins = useReviews((s) => s.pins);
  const role = useReviews((s) => s.role);
  const conn = useReviews((s) => s.conn);
  const writable = canComment(role);
  const cards = useCardLabel(conn?.store);
  const [, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [reviewFilter, setReviewFilter] = useState<string>('');
  const [limit, setLimit] = useState(THREADS_PAGE);
  const ref = useRef<HTMLElement>(null);
  const elementId = target?.elementId;
  const focusThread = target?.threadId;

  // Read the rendered card so every entry point (toolbar, badge, pin, linked thread)
  // follows pan, zoom and layout changes without storing stale screen coordinates.
  const canvas = useReviews((s) => s.canvas);
  useEffect(() => {
    if (!elementId || !canvas) return;
    let frame = 0;
    const place = () => {
      const panel = ref.current;
      const card = document.querySelector<HTMLElement>(`[data-el="${CSS.escape(elementId)}"]`);
      const floating = !!card && window.innerWidth >= 768;
      panel?.classList.toggle('comments-panel--element', floating);
      if (panel && card && floating) {
        const position = commentPanelPosition(
          card.getBoundingClientRect(),
          { w: panel.offsetWidth, h: panel.offsetHeight },
          { w: window.innerWidth, h: window.innerHeight },
        );
        panel.style.left = `${position.x}px`;
        panel.style.top = `${position.y}px`;
      } else if (panel) {
        panel.style.removeProperty('left');
        panel.style.removeProperty('top');
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => {
      cancelAnimationFrame(frame);
      ref.current?.classList.remove('comments-panel--element');
      ref.current?.style.removeProperty('left');
      ref.current?.style.removeProperty('top');
    };
  }, [elementId, canvas]);

  // Focus moves into the panel, or to the composer once a pin is placed, and back where it was
  // when the panel closes; not when it closes to place a pin, which takes focus itself.
  useEffect(() => {
    const previous = document.activeElement;
    const composer = getReviews().target?.pin
      ? ref.current?.querySelector<HTMLTextAreaElement>('.comments-panel__composer textarea')
      : null;
    (composer ?? ref.current)?.focus();
    return () => {
      if (getReviews().pinTarget) return;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (focusThread) setFilter('all');
  }, [focusThread]);

  // A linked thread is brought into view once it is in the list, once per opening: later
  // refreshes must not take focus away from someone typing.
  const focusedFor = useRef<CommentTarget | null>(null);
  useEffect(() => {
    void threads;
    if (!target?.threadId || focusedFor.current === target) return;
    const node = ref.current?.querySelector<HTMLElement>(
      `[data-thread="${CSS.escape(target.threadId)}"]`,
    );
    if (!node) return;
    focusedFor.current = target;
    const comment = target.commentId
      ? node.querySelector<HTMLElement>(`[data-comment="${CSS.escape(target.commentId)}"]`)
      : null;
    node.focus({ preventScroll: true });
    (comment ?? node).scrollIntoView({ block: 'nearest' });
  }, [target, threads]);

  // Comments from other people that arrive while the panel is open are announced, counted
  // since it opened so each arrival changes the text read out.
  const { user } = useSession();
  const [arrived, setArrived] = useState(0);
  const seen = useRef<{ scope: string | undefined; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (status !== 'ready') return;
    const last = seen.current;
    const before = last && last.scope === elementId ? last.ids : null;
    const ids = new Set<string>();
    let fresh = 0;
    for (const thread of threads) {
      if (elementId && thread.elementId !== elementId) continue;
      for (const comment of [thread, ...thread.replies]) {
        ids.add(comment.id);
        const mine = comment.author.kind === 'user' && comment.author.user.id === user?.id;
        if (before && !before.has(comment.id) && !mine) fresh++;
      }
    }
    seen.current = { scope: elementId, ids };
    if (fresh > 0) setArrived((n) => n + fresh);
  }, [threads, status, user?.id, elementId]);

  const jump = useCallback(
    (id: string) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set('el', id);
        next.set('view', 'canvas');
        return next;
      }),
    [setParams],
  );
  const onJump = useCallback(
    (thread: CommentThread) => {
      if (!thread.elementId) return;
      jump(thread.elementId);
      openComments({ elementId: thread.elementId, threadId: thread.id });
    },
    [jump],
  );

  const shownThreads = threads.filter(
    (thread) =>
      (!elementId || thread.elementId === elementId) &&
      (filter === 'all' || (filter === 'resolved') === !!thread.resolvedAt),
  );
  const focusIndex = shownThreads.findIndex((thread) => thread.id === focusThread);
  const visible = shownThreads.slice(0, Math.max(limit, focusIndex + 1));
  const removed = !!elementId && !cards.exists(elementId);
  const byStatus = reviewFilter
    ? cards
        .elements()
        .filter(
          (el) => el.type !== 'arrow' && (reviews.get(el.id)?.status ?? 'none') === reviewFilter,
        )
    : [];

  const onKeyDown = (e: KeyboardEvent) => {
    // Keys typed here are not board shortcuts.
    e.stopPropagation();
    const inDialog = (e.target as HTMLElement).closest('dialog');
    // A composer with text handles Escape itself, so a draft is never lost to it.
    if (e.key === 'Escape' && !e.defaultPrevented && !inDialog) closeComments();
  };

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className="comments-panel"
      aria-labelledby="comments-panel-title"
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <header className="comments-panel__head">
        <h2 id="comments-panel-title">{t('comments.title')}</h2>
        <IconButton icon="close" label={t('comments.close')} onClick={closeComments} />
      </header>
      <div className="comments-panel__body">
        {elementId ? (
          <div className="review-row review-row--between">
            <Button variant="ghost" onClick={() => openComments()}>
              {t('comments.allThreads')}
            </Button>
            <button
              type="button"
              className="review-link"
              disabled={removed}
              onClick={() => jump(elementId)}
              aria-label={t('comments.jumpTo', { card: cards.label(elementId) })}
            >
              {cards.label(elementId)}
              <Icon name="arrow" size={12} />
            </button>
          </div>
        ) : null}
        {elementId && !removed && <ReviewSection key={elementId} elementId={elementId} />}

        <fieldset className="review-segments">
          <legend className="review-hidden">{t('comments.filter')}</legend>
          {(['open', 'resolved', 'all'] as const).map((value) => (
            <label key={value} className={filter === value ? 'is-active' : undefined}>
              <input
                type="radio"
                name="comments-filter"
                value={value}
                checked={filter === value}
                onChange={() => {
                  setFilter(value);
                  setLimit(THREADS_PAGE);
                }}
              />
              {t(`comments.filterStatus.${value}`)}
            </label>
          ))}
        </fieldset>

        {!elementId && (
          <label className="review-field">
            {t('review.filter')}
            <select
              className="ink-input"
              value={reviewFilter}
              onChange={(e) => setReviewFilter(e.target.value)}
            >
              <option value="">{t('review.filterNone')}</option>
              {REVIEW_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`review.status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        {reviewFilter && (
          <section aria-label={t('review.filtered')}>
            {byStatus.length === 0 ? (
              <p className="review-empty">{t('review.filteredEmpty')}</p>
            ) : (
              <ul className="review-card-list">
                {byStatus.map((el) => (
                  <li key={el.id}>
                    <button
                      type="button"
                      className="review-card"
                      onClick={() => {
                        jump(el.id);
                        openComments({ elementId: el.id });
                      }}
                    >
                      <span>{cards.label(el.id)}</span>
                      <ReviewChip status={reviews.get(el.id)?.status ?? 'none'} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {status === 'error' && (
          <p role="alert" className="review-error">
            {t('comments.loadError')}{' '}
            <button
              type="button"
              className="review-link"
              onClick={() => refreshReviews('comments')}
            >
              {t('comments.retry')}
            </button>
          </p>
        )}
        {reviewsStatus === 'error' && (
          <p role="alert" className="review-error">
            {t('review.loadError')}{' '}
            <button type="button" className="review-link" onClick={() => refreshReviews('reviews')}>
              {t('comments.retry')}
            </button>
          </p>
        )}
        <p role="status" className="review-hidden">
          {arrived > 0 ? t('comments.arrived', { count: arrived }) : ''}
        </p>
        {status === 'loading' && (
          <p role="status" className="ink-muted">
            {t('comments.loading')}
          </p>
        )}
        {status === 'ready' && shownThreads.length === 0 && (
          <p className="review-empty">
            {t(filter === 'open' ? 'comments.emptyOpen' : 'comments.empty')}
          </p>
        )}
        <div className="comment-threads">
          {visible.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              writable={writable}
              targetLabel={cards.label(thread.elementId)}
              pinNumber={
                thread.elementId
                  ? (pins.get(thread.elementId)?.findIndex((p) => p.id === thread.id) ?? -1) + 1
                  : 0
              }
              showTarget={!elementId}
              canJump={!!thread.elementId && cards.exists(thread.elementId)}
              onJump={onJump}
            />
          ))}
        </div>
        {shownThreads.length > visible.length && (
          <Button variant="ghost" onClick={() => setLimit((n) => n + THREADS_PAGE)}>
            {t('comments.moreThreads', { count: shownThreads.length - visible.length })}
          </Button>
        )}
      </div>
      {writable && !removed ? (
        <NewThread key={elementId ?? ''} elementId={elementId} onJump={jump} />
      ) : (
        !writable && <p className="comments-panel__foot ink-muted">{t('comments.readOnly')}</p>
      )}
    </aside>
  );
}

function NewThread({
  elementId,
  onJump,
}: {
  elementId: string | undefined;
  onJump: (id: string) => void;
}) {
  const { t } = useTranslation();
  const pin = useReviews((s) => s.target?.pin);
  const boardId = useReviews((s) => s.boardId);
  const canvas = useReviews((s) => s.canvas);
  const draftKey = elementId ?? null;
  const [visibility, setVisibility] = useState<CommentVisibility>(
    () => getDraft(draftKey)?.visibility ?? 'team',
  );
  const id = useId();
  return (
    <div className="comments-panel__composer">
      <h3>{t(elementId ? 'comments.newOnCard' : 'comments.newOnBoard')}</h3>
      {elementId && (
        <div className="review-row">
          {pin ? (
            <span className="review-chip">
              <Icon name="pointer" size={12} />
              {t('comments.pinAttached')}
            </span>
          ) : null}
          <Button
            variant="ghost"
            aria-describedby={!pin && !canvas ? `${id}-pins` : undefined}
            onClick={() => {
              if (pin) return openComments({ elementId });
              // Points are placed and shown on the canvas only, where the card has one shape.
              if (!canvas) onJump(elementId);
              placePin(elementId);
            }}
          >
            {t(pin ? 'comments.pinRemove' : 'comments.pinAdd')}
          </Button>
          {!pin && !canvas && (
            <span id={`${id}-pins`} className="ink-muted comment-hint">
              {t('comments.pinsOnCanvas')}
            </span>
          )}
        </div>
      )}
      <Composer
        key={draftKey ?? 'board'}
        draft={{ elementId: draftKey, visibility }}
        submitLabel={t('comments.send')}
        onSend={async (body) => {
          await api.post(`/boards/${boardId}/comments`, {
            body,
            visibility,
            ...(elementId ? { elementId } : {}),
            ...(pin ? { pin } : {}),
          });
          refreshReviews('comments', draftKey);
          if (pin && elementId) openComments({ elementId });
        }}
      >
        <fieldset className="comment-visibility" aria-describedby={`${id}-hint`}>
          <legend>{t('comments.visibilityLabel')}</legend>
          {(['team', 'everyone'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={`${id}-visibility`}
                value={value}
                checked={visibility === value}
                onChange={() => setVisibility(value)}
              />
              {t(`comments.visibility.${value}`)}
            </label>
          ))}
          <span id={`${id}-hint`} className="ink-muted">
            {t(visibility === 'team' ? 'comments.teamHint' : 'comments.everyoneHint')}
          </span>
        </fieldset>
      </Composer>
    </div>
  );
}

function AuthorLine({ author, at, edited }: { author: Author; at: string; edited?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="comment-author">
      <strong>{authorName(author) ?? t('comments.deletedAuthor')}</strong>
      <GuestTag author={author} />
      <time dateTime={at}>
        {new Date(at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}
      </time>
      {edited && <span>· {t('comments.edited')}</span>}
    </div>
  );
}

export const Thread = memo(function Thread({
  thread,
  writable,
  targetLabel,
  pinNumber,
  showTarget,
  canJump,
  onJump,
}: {
  thread: CommentThread;
  writable: boolean;
  targetLabel: string;
  pinNumber: number;
  showTarget: boolean;
  canJump: boolean;
  onJump: (thread: CommentThread) => void;
}) {
  const { t } = useTranslation();
  const [replying, setReplying] = useState(false);
  // Older replies fetched by a notification link or by paging here, kept and refreshed in the store.
  const older = useReviews((s) => s.olderReplies.get(thread.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const replies = mergeReplies([...(older?.items ?? [])], thread.replies);
  const hidden = thread.replyCount - replies.length;
  const linkLabel = shareLinkTag(thread);
  const linkTag = linkLabel
    ? t('comments.oneLinkNamed', { label: linkLabel })
    : t('comments.oneLink');

  const run = async (action: () => Promise<unknown>) => {
    setError(false);
    setBusy(true);
    try {
      await action();
      refreshReviews('comments', thread.elementId);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={thread.resolvedAt ? 'comment-thread is-resolved' : 'comment-thread'}
      data-thread={thread.id}
      tabIndex={-1}
      aria-label={t('comments.threadLabel', { card: targetLabel })}
    >
      <div className="review-row">
        {showTarget &&
          (canJump ? (
            <button
              type="button"
              className="review-link"
              onClick={() => onJump(thread)}
              aria-label={t('comments.jumpTo', { card: targetLabel })}
            >
              {targetLabel}
              <Icon name="arrow" size={12} />
            </button>
          ) : (
            <span className="review-link">{targetLabel}</span>
          ))}
        {pinNumber > 0 && (
          <span className="review-tag">{t('comments.pinNumber', { number: pinNumber })}</span>
        )}
        <span
          className="review-tag"
          title={t(thread.visibility === 'team' ? 'comments.teamHint' : 'comments.everyoneHint')}
        >
          <Icon name={thread.visibility === 'team' ? 'lock' : 'people'} size={12} />
          {t(`comments.visibility.${thread.visibility === 'team' ? 'team' : 'everyone'}`)}
        </span>
        {thread.shareLinkId && (
          <span className="review-tag review-tag--truncate" title={linkTag}>
            {linkTag}
          </span>
        )}
      </div>
      <CommentItem comment={thread} elementId={thread.elementId} writable={writable} />
      {hidden > 0 && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(false);
            try {
              const p = await fetchReplies(thread.id, older?.cursor ?? null);
              addOlderReplies(thread.id, p.items, p.nextCursor);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('comments.moreReplies', { count: hidden })}
        </Button>
      )}
      {replies.length > 0 && (
        <div className="comment-replies">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              elementId={thread.elementId}
              writable={writable}
            />
          ))}
        </div>
      )}
      {thread.resolvedAt && (
        <p className="comment-resolved">
          <Icon name="check" size={12} />
          {t('comments.resolvedBy', {
            name: authorName(thread.resolvedBy) ?? t('comments.deletedAuthor'),
          })}
        </p>
      )}
      {writable && (
        <div className="review-row">
          <Button variant="ghost" aria-expanded={replying} onClick={() => setReplying((v) => !v)}>
            {t('comments.reply')}
          </Button>
          {!thread.deletedAt && (
            <Button
              variant="ghost"
              icon={thread.resolvedAt ? undefined : 'check'}
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api.post(
                    `/comments/${thread.id}/${thread.resolvedAt ? 'reopen' : 'resolve'}`,
                    {},
                  ),
                )
              }
            >
              {t(thread.resolvedAt ? 'comments.reopen' : 'comments.resolve')}
            </Button>
          )}
        </div>
      )}
      {replying && writable && (
        <Composer
          autoFocus
          submitLabel={t('comments.sendReply')}
          onCancel={() => setReplying(false)}
          onSend={async (body) => {
            const { boardId } = getReviews();
            await api.post(`/boards/${boardId}/comments`, { body, parentId: thread.id });
            setReplying(false);
            refreshReviews('comments', thread.elementId);
          }}
        />
      )}
      {error && (
        <p role="alert" className="review-error">
          {t('comments.error')}
        </p>
      )}
    </article>
  );
});

function CommentItem({
  comment,
  elementId,
  writable,
}: {
  comment: Comment;
  elementId: string | null;
  writable: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const confirm = useRef<HTMLFieldSetElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) confirm.current?.querySelector('button')?.focus();
    else if (wasConfirming.current) actions.current?.querySelector('button')?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  return (
    <div className="comment-item" data-comment={comment.id}>
      <AuthorLine author={comment.author} at={comment.createdAt} edited={!!comment.editedAt} />
      {editing ? (
        <Composer
          autoFocus
          initial={comment}
          submitLabel={t('comments.save')}
          onCancel={() => setEditing(false)}
          onSend={async (body) => {
            await api.patch(`/comments/${comment.id}`, { body });
            setEditing(false);
            refreshReviews('comments', elementId);
          }}
        />
      ) : comment.deletedAt ? (
        <p className="comment-body comment-body--deleted">{t('comments.deleted')}</p>
      ) : (
        <p className="comment-body">
          {commentParts(comment).map((part, index) =>
            'mention' in part ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity of their own.
              <span key={index} className="comment-mention">
                @{part.mention}
              </span>
            ) : (
              part.text
            ),
          )}
        </p>
      )}
      {writable && !comment.deletedAt && !editing && !confirming && (
        <div className="review-row" ref={actions}>
          {comment.canEdit && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              {t('comments.edit')}
            </Button>
          )}
          {comment.canDelete && (
            <Button
              variant="ghost"
              aria-label={
                comment.author.kind === 'user' && comment.author.user.id === user?.id
                  ? t('comments.delete')
                  : t('comments.deleteOf', {
                      name: authorName(comment.author) ?? t('comments.deletedAuthor'),
                    })
              }
              onClick={() => setConfirming(true)}
            >
              {t('comments.delete')}
            </Button>
          )}
        </div>
      )}
      {confirming && (
        <fieldset
          ref={confirm}
          className="review-confirm"
          aria-label={t('comments.deleteConfirm')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setConfirming(false);
            }
          }}
        >
          <p>{t('comments.deleteConfirm')}</p>
          <div className="review-row">
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(false);
                try {
                  await api.delete(`/comments/${comment.id}`);
                  setConfirming(false);
                  refreshReviews('comments', elementId);
                } catch {
                  setError(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('comments.deleteYes')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              {t('comments.cancel')}
            </Button>
          </div>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="review-error">
          {t('comments.error')}
        </p>
      )}
    </div>
  );
}

function Composer({
  onSend,
  submitLabel,
  initial,
  draft,
  onCancel,
  autoFocus,
  children,
}: {
  onSend: (body: string) => Promise<void>;
  submitLabel: string;
  initial?: Comment;
  /** Keeps the text of a new thread while the panel closes or switches scope. */
  draft?: { elementId: string | null; visibility: CommentVisibility };
  onCancel?: () => void;
  autoFocus?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const people = useReviews((s) => s.people);
  const saved = draft ? getDraft(draft.elementId) : null;
  const [text, setText] = useState(() => saved?.text ?? (initial ? editableText(initial) : ''));
  const [picked, setPicked] = useState<readonly UserSummary[]>(
    () => saved?.picked ?? initial?.mentions ?? [],
  );
  const [armed, setArmed] = useState(false);
  const draftScope = draft?.elementId;
  const draftVisibility = draft?.visibility;
  useEffect(() => {
    if (draftVisibility === undefined || draftScope === undefined) return;
    saveDraft(
      text ? { elementId: draftScope, text, picked, visibility: draftVisibility } : null,
      draftScope,
    );
  }, [text, picked, draftScope, draftVisibility]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    if (!autoFocus) return;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const query = dismissed ? null : mentionQuery(text, caret);
  const suggestions =
    query === null
      ? []
      : people
          .filter(
            (p) =>
              p.id !== user?.id && p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          )
          .slice(0, 6);
  const listOpen = suggestions.length > 0;
  const body = encodeMentions(text, picked);
  const tooLong = body.length > MAX_COMMENT_LENGTH;

  const choose = (person: (typeof people)[number]) => {
    if (query === null) return;
    const start = caret - query.length - 1;
    const token = `@${person.name} `;
    const next = `${text.slice(0, start)}${token}${text.slice(caret)}`;
    setPicked((list) => [...list, person]);
    setText(next);
    setDismissed(true);
    const at = start + token.length;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  };

  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy || !body.trim() || tooLong) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(body);
      setText('');
      setPicked([]);
      if (draft) saveDraft(null, draft.elementId);
    } catch (err) {
      setError(
        t(
          err instanceof RequestError && err.status === 429
            ? 'comments.rateLimited'
            : 'comments.error',
        ),
      );
    } finally {
      setBusy(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  }

  return (
    <form className="comment-composer" onSubmit={(e) => void send(e)}>
      <div className="comment-composer__field">
        <textarea
          ref={input}
          className="ink-input"
          rows={initial ? 3 : 2}
          role="combobox"
          aria-label={t('comments.body')}
          aria-expanded={listOpen}
          aria-autocomplete="list"
          aria-controls={listOpen ? `${id}-people` : undefined}
          aria-activedescendant={listOpen ? `${id}-person-${active}` : undefined}
          aria-describedby={`${id}-hint`}
          aria-invalid={tooLong || undefined}
          placeholder={t('comments.placeholder')}
          value={text}
          readOnly={busy}
          onBlur={() => setArmed(false)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setDismissed(false);
            setActive(0);
            setArmed(false);
          }}
          onKeyDown={(e) => {
            if (listOpen && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
              e.preventDefault();
              if (e.key === 'Escape') setDismissed(true);
              else if (e.key === 'Enter' || e.key === 'Tab') {
                const person = suggestions[active];
                if (person) choose(person);
              } else {
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setActive((n) => (n + step + suggestions.length) % suggestions.length);
              }
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            } else if (e.key === 'Escape') {
              const changed = text.trim() !== (initial ? editableText(initial) : '').trim();
              // Text is only thrown away by a second Escape.
              if (changed && !armed) {
                e.preventDefault();
                setArmed(true);
                return;
              }
              if (changed) {
                e.preventDefault();
                setText('');
                setPicked([]);
                setArmed(false);
                if (draft) saveDraft(null, draft.elementId);
              }
              if (onCancel) {
                e.preventDefault();
                onCancel();
              }
            }
          }}
        />
        {listOpen && (
          <div
            id={`${id}-people`}
            className="mention-suggestions"
            role="listbox"
            aria-label={t('comments.mentions')}
          >
            {suggestions.map((person, index) => (
              <button
                key={person.id}
                id={`${id}-person-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(person)}
              >
                {person.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <span id={`${id}-hint`} className="ink-muted comment-hint" aria-live="polite">
        {tooLong
          ? t('comments.tooLong', { max: MAX_COMMENT_LENGTH })
          : armed
            ? t('comments.escapeAgain')
            : t('comments.mentionHint')}
      </span>
      {children}
      <div className="review-row">
        <Button type="submit" variant="primary" disabled={busy || !body.trim() || tooLong}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {t('comments.cancel')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="review-error">
          {error}
        </p>
      )}
    </form>
  );
}
