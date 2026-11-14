// SPDX-License-Identifier: AGPL-3.0-only

import { type Element, roots } from '@inkadra/doc-schema';
import {
  type Author,
  type Comment,
  type CommentThread,
  type CommentVisibility,
  MAX_COMMENT_LENGTH,
  type ReactionEmoji,
  type UserSummary,
} from '@inkadra/shared';
import { Button, ChoiceTile, Icon, IconButton, Segmented, Select, Switch } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import {
  type FormEvent,
  type KeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
import { CommentsOnBoard } from './CommentsOnBoard.tsx';
import { ContextMenu } from './chrome.tsx';
import { commentPanelPosition } from './comment-panel-position.ts';
import { GuestTag } from './GuestTag.tsx';
import { plainText } from './note-text.ts';
import { ReactionBar } from './ReactionBar.tsx';
import { ReviewSection } from './ReviewSection.tsx';
import {
  authorName,
  commentParts,
  editableText,
  encodeMentions,
  involvesMe,
  mentionQuery,
  mergeReplies,
  REVIEW_STATUSES,
  shareLinkTag,
  unreadCount,
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
  readOnBoard,
  refreshReviews,
  saveDraft,
  setOnBoard,
  setReviews,
  setThreadRead,
  useReviews,
} from './review-store.ts';
import type { BoardStore } from './store.ts';
import { fetchReplies } from './use-board-reviews.ts';
import './review.css';
import { formatDateTime } from '../lib/datetime.ts';

const THREADS_PAGE = 30;

/** Header button of the board: opens the comments panel, with the number of open threads. */
export function CommentsButton() {
  const { t } = useTranslation();
  const boardId = useReviews((s) => s.boardId);
  const counts = useReviews((s) => s.counts);
  const target = useReviews((s) => s.target);
  const isOpen = target !== null;
  const preview = useReviews((s) => s.preview);
  const canvas = useReviews((s) => s.canvas);
  const unread = unreadCount(useReviews((s) => s.threads));
  const { user } = useSession();
  // The choice of "Show on board" is the person's own: read it again for each board.
  useEffect(() => {
    if (boardId) setReviews({ onBoard: readOnBoard(user?.id) });
  }, [boardId, user?.id]);
  if (!boardId || preview) return null;
  let open = 0;
  for (const c of counts.values()) open += c.open;
  return (
    <>
      <Button
        icon="comment"
        className="comments-button"
        aria-expanded={isOpen}
        aria-label={
          t('comments.button', { count: open }) +
          (unread > 0 ? `, ${t('comments.unreadCount', { count: unread })}` : '')
        }
        onClick={() => (isOpen && !target.elementId ? closeComments() : openComments())}
      >
        <span className="comments-button__label">{t('comments.title')}</span>
        {unread > 0 ? (
          <span className="review-count review-count--unread">{unread}</span>
        ) : (
          open > 0 && <span className="review-count">{open}</span>
        )}
      </Button>
      {canvas && <CommentsOnBoard />}
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
  const [filter, setFilter] = useState<'open' | 'mentions' | 'resolved' | 'all'>('open');
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<string>('');
  const [limit, setLimit] = useState(THREADS_PAGE);
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [reviewDetails, setReviewDetails] = useState<HTMLDivElement | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const updateScroll = useCallback(() => {
    const body = bodyRef.current;
    setMoreBelow(!!body && body.scrollHeight - body.clientHeight - body.scrollTop > 4);
  }, []);
  useLayoutEffect(updateScroll);
  useEffect(() => {
    const observer = new ResizeObserver(updateScroll);
    if (bodyRef.current) observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [updateScroll]);
  const elementId = target?.elementId;
  const focusThread = target?.threadId;

  // Read the rendered card so every entry point (toolbar, badge, pin, linked thread)
  // follows pan, zoom and layout changes without storing stale screen coordinates.
  const canvas = useReviews((s) => s.canvas);
  const onBoard = useReviews((s) => s.onBoard);
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
          // Leave the floating canvas toolbar visible below the card panel.
          { w: window.innerWidth, h: window.innerHeight - 76 },
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
    if (focusThread) {
      setFilter('all');
    }
  }, [focusThread]);

  // A linked thread is brought into view once it is in the list, once per opening: later
  // refreshes must not take focus away from someone typing.
  const focusedFor = useRef<CommentTarget | null>(null);
  useEffect(() => {
    void threads;
    void resolvedOpen;
    if (!target?.threadId || focusedFor.current === target) return;
    if (
      !resolvedOpen &&
      threads.some((thread) => thread.id === target.threadId && thread.resolvedAt)
    ) {
      setResolvedOpen(true);
      return;
    }
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
  }, [target, threads, resolvedOpen]);

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
        // The board's first view finds the card; a canvas already open keeps it (decision 0121).
        if (next.get('view') !== 'canvas') next.delete('view');
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

  const inScope = threads.filter((thread) => !elementId || thread.elementId === elementId);
  const mentioned = inScope.filter((thread) => !thread.resolvedAt && involvesMe(thread, user?.id));
  const shownThreads =
    !elementId && filter === 'mentions'
      ? mentioned
      : inScope.filter((thread) =>
          elementId
            ? !thread.resolvedAt
            : filter === 'all' || (filter === 'resolved') === !!thread.resolvedAt,
        );
  const focusIndex = shownThreads.findIndex((thread) => thread.id === focusThread);
  const visible = shownThreads.slice(0, Math.max(limit, focusIndex + 1));
  const resolved = inScope.filter((thread) => thread.resolvedAt);
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
      data-tour="comments-panel"
      aria-labelledby="comments-panel-title"
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <header className="comments-panel__head">
        <h2 id="comments-panel-title">{t('comments.title')}</h2>
        <IconButton icon="close" label={t('comments.close')} onClick={closeComments} />
      </header>
      <div className="comments-panel__context">
        {elementId &&
          (removed ? (
            <span className="review-link">{cards.label(elementId)}</span>
          ) : (
            <ReviewSection
              key={elementId}
              elementId={elementId}
              compact
              detailsContainer={reviewDetails}
              context={
                <button
                  type="button"
                  className="review-link"
                  onClick={() => jump(elementId)}
                  aria-label={t('comments.jumpTo', { card: cards.label(elementId) })}
                >
                  <span>{cards.label(elementId)}</span>
                  <Icon name="arrow" size={12} />
                </button>
              }
            />
          ))}
      </div>
      <div className={`comments-panel__scroll${moreBelow ? ' has-more' : ''}`}>
        <div ref={bodyRef} className="comments-panel__body" data-scroll onScroll={updateScroll}>
          <div className="comments-panel__review-details" ref={setReviewDetails} />

          {canvas && !elementId && (
            <label className="comments-panel__toggle" data-tour="comments-on-board">
              {t('comments.showOnBoard')}
              <Switch checked={onBoard} onChange={(e) => setOnBoard(e.target.checked, user?.id)} />
            </label>
          )}

          {!elementId && (
            <fieldset className="review-segments">
              <legend className="review-hidden">{t('comments.filter')}</legend>
              {/* `all` is only for a linked thread: no pill is checked then. */}
              {(['open', 'mentions', 'resolved'] as const).map((value) => (
                <ChoiceTile
                  key={value}
                  name="comments-filter"
                  value={value}
                  checked={filter === value}
                  onChange={() => {
                    setFilter(value);
                    setLimit(THREADS_PAGE);
                  }}
                >
                  {t(`comments.filterStatus.${value}`)}
                  {value === 'mentions' && mentioned.length > 0 && ` · ${mentioned.length}`}
                </ChoiceTile>
              ))}
            </fieldset>
          )}

          {!elementId && (
            // biome-ignore lint/a11y/noLabelWithoutControl: Select renders a labelable button.
            <label className="review-field">
              {t('review.filter')}
              <Select
                className="ink-input"
                value={reviewFilter}
                onChange={(e) => setReviewFilter(e)}
              >
                <option value="">{t('review.filterNone')}</option>
                {REVIEW_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`review.status.${s}`)}
                  </option>
                ))}
              </Select>
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
              <button
                type="button"
                className="review-link"
                onClick={() => refreshReviews('reviews')}
              >
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
              {t(
                elementId || filter === 'open'
                  ? 'comments.emptyOpen'
                  : filter === 'mentions'
                    ? 'comments.emptyMentions'
                    : 'comments.empty',
              )}
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
          {elementId && resolved.length > 0 && (
            <>
              <Button
                variant="ghost"
                className="comments-panel__resolved"
                aria-expanded={resolvedOpen}
                onClick={() => setResolvedOpen((v) => !v)}
              >
                {t('comments.resolvedCount', { count: resolved.length })}
                <Icon
                  className={
                    resolvedOpen ? 'ink-icon review-chevron is-open' : 'ink-icon review-chevron'
                  }
                  name="chevronDown"
                  size={14}
                />
              </Button>
              {resolvedOpen && (
                <div className="comment-threads">
                  {resolved.map((thread) => (
                    <Thread
                      key={thread.id}
                      thread={thread}
                      writable={writable}
                      targetLabel={cards.label(thread.elementId)}
                      pinNumber={
                        (pins.get(elementId)?.findIndex((p) => p.id === thread.id) ?? -1) + 1
                      }
                      showTarget={false}
                      canJump={!removed}
                      onJump={onJump}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
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
  const [visibility, setVisibility] = useState<CommentVisibility>('team');
  return (
    <div
      className={`comments-panel__composer${visibility === 'everyone' ? ' is-public' : ''}`}
      data-tour="comments-composer"
    >
      <Composer
        key={draftKey ?? 'board'}
        draft={{ elementId: draftKey, visibility }}
        submitLabel={t(visibility === 'everyone' ? 'comments.sendGuests' : 'comments.send')}
        publicAudience={visibility === 'everyone'}
        pinned={!!pin}
        onCollapse={() => setVisibility('team')}
        onSend={async (body) => {
          await api.post(`/boards/${boardId}/comments`, {
            body,
            visibility,
            ...(elementId ? { elementId } : {}),
            ...(pin ? { pin } : {}),
          });
          setVisibility('team');
          refreshReviews('comments', draftKey);
          if (pin && elementId) openComments({ elementId });
        }}
      >
        {elementId && (
          <div className="review-row comment-composer__pin">
            {pin ? (
              <span className="review-chip">
                <Icon name="pointer" size={12} />
                {t('comments.pinAttached')}
              </span>
            ) : null}
            <IconButton
              icon="pin"
              aria-pressed={!!pin}
              label={t(pin ? 'comments.pinRemove' : 'comments.pinAdd')}
              onClick={() => {
                if (pin) return openComments({ elementId });
                // Points are placed and shown on the canvas only, where the card has one shape.
                if (!canvas) onJump(elementId);
                placePin(elementId);
              }}
            />
          </div>
        )}
        {visibility === 'everyone' && (
          <p className="comment-audience">
            <Icon name="people" size={14} />
            <span>{t('comments.publicWarning')}</span>
          </p>
        )}
        <Segmented<CommentVisibility>
          className="comment-visibility"
          label={t('comments.visibilityLabel')}
          value={visibility}
          onChange={setVisibility}
          options={(['team', 'everyone'] as const).map((value) => ({
            value,
            label: (
              <>
                <Icon name={value === 'team' ? 'lock' : 'people'} size={12} />
                {t(`comments.visibility.${value}`)}
              </>
            ),
          }))}
        />
      </Composer>
    </div>
  );
}

function AuthorLine({ author, at, edited }: { author: Author; at: string; edited?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="comment-author">
      <strong>{authorName(author) ?? t('comments.deletedAuthor')}</strong>
      <GuestTag author={author} />
      <time dateTime={at}>{formatDateTime(at, { dateStyle: 'medium', timeStyle: 'short' })}</time>
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

  const audience = threadAudience(thread, t);

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
      data-unread={thread.unread || undefined}
      tabIndex={-1}
      aria-label={t('comments.threadLabel', { card: targetLabel })}
      onFocus={(e) => {
        // Coming into the thread is opening it.
        if (thread.unread && !e.currentTarget.contains(e.relatedTarget as Node | null))
          setThreadRead(thread.id, true);
      }}
    >
      {thread.unread && (
        <span className="comment-unread" role="img" aria-label={t('comments.unread')} />
      )}
      {showTarget && (
        <div className="review-row comment-thread__target">
          {canJump ? (
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
          )}
        </div>
      )}
      <CommentItem
        comment={thread}
        elementId={thread.elementId}
        writable={writable}
        audience={audience}
      />
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
              audience={audience}
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
      <div className="review-row comment-thread__foot">
        {writable && (
          <>
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
          </>
        )}
        <span className="comment-thread__tags">
          {pinNumber > 0 && (
            <span className="review-tag">{t('comments.pinNumber', { number: pinNumber })}</span>
          )}
          {thread.visibility !== 'team' && !thread.shareLinkId && (
            <span className="review-tag review-tag--out">
              <Icon name="people" size={12} />
              {t('comments.visibility.everyone')}
            </span>
          )}
          {thread.shareLinkId && (
            <span
              className="review-tag review-tag--out review-tag--truncate"
              data-ink-tooltip={linkTag}
            >
              {linkTag}
            </span>
          )}
        </span>
      </div>
      {replying && writable && (
        <div className="comment-reply-box">
          {audience && (
            <p className="comment-audience">
              <Icon name="people" size={14} />
              <span>{audience}</span>
            </p>
          )}
          <Composer
            publicAudience={thread.visibility !== 'team'}
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
        </div>
      )}
      {error && (
        <p role="alert" className="review-error">
          {t('comments.error')}
        </p>
      )}
    </article>
  );
});

/** The ⋯ menu of a thread: mark it unread, or read again. */
function ThreadMenu({
  thread,
  items = [],
}: {
  thread: Comment;
  items?: { label: string; action: () => void }[];
}) {
  const { t } = useTranslation();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  if (
    (thread.deletedAt && !('replyCount' in thread && thread.replyCount)) ||
    (!('unread' in thread) && items.length === 0)
  )
    return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="comment-thread__more"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-label={t('comments.commentMenu', {
          name: authorName(thread.author) ?? t('comments.deletedAuthor'),
        })}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: Math.max(8, r.right - 210), y: r.bottom + 4 });
        }}
      >
        <Icon name="more" size={14} />
      </button>
      {at &&
        // Out of the panel or popover, whose transform would be the box `fixed` is measured from.
        createPortal(
          <ContextMenu
            style={{ position: 'fixed', left: at.x, top: at.y, zIndex: 60 }}
            label={t('comments.threadMenu')}
            anchor={button}
            items={[
              ...('unread' in thread
                ? [
                    {
                      label: t(thread.unread ? 'comments.markRead' : 'comments.markUnread'),
                      action: () => setThreadRead(thread.id, !!thread.unread),
                    },
                  ]
                : []),
              ...items,
            ]}
            onClose={(reason) => {
              setAt(null);
              if (reason === 'escape') button.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}

function CommentItem({
  comment,
  elementId,
  writable,
  audience,
}: {
  comment: Comment;
  audience?: string;
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
          publicAudience={!!audience}
          submitLabel={t('comments.save')}
          onCancel={() => setEditing(false)}
          onSend={async (body) => {
            await api.patch(`/comments/${comment.id}`, { body });
            setEditing(false);
            refreshReviews('comments', elementId);
          }}
        >
          {audience && (
            <p className="comment-audience">
              <Icon name="people" size={14} />
              <span>{audience}</span>
            </p>
          )}
        </Composer>
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
      {!comment.deletedAt && !editing && (
        <ReactionBar
          reactions={comment.reactions}
          {...(writable
            ? {
                onToggle: async (emoji: ReactionEmoji, on: boolean) => {
                  const path = `/comments/${comment.id}/reactions/${encodeURIComponent(emoji)}`;
                  await (on ? api.put(path, {}) : api.delete(path));
                  refreshReviews('comments', elementId);
                },
              }
            : {})}
        />
      )}
      {(!comment.deletedAt || ('replyCount' in comment && !!comment.replyCount)) &&
        !editing &&
        !confirming && (
          <div className="comment-actions" ref={actions}>
            <ThreadMenu
              thread={comment}
              items={[
                ...(writable && !comment.deletedAt && comment.canEdit
                  ? [{ label: t('comments.edit'), action: () => setEditing(true) }]
                  : []),
                ...(writable && !comment.deletedAt && comment.canDelete
                  ? [
                      {
                        label:
                          comment.author.kind === 'user' && comment.author.user.id === user?.id
                            ? t('comments.delete')
                            : t('comments.deleteOf', {
                                name: authorName(comment.author) ?? t('comments.deletedAuthor'),
                              }),
                        action: () => setConfirming(true),
                      },
                    ]
                  : []),
              ]}
            />
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

/** Who else reads a reply to the thread, to say so beside the field; nobody for the team's. */
export function threadAudience(thread: CommentThread, t: TFunction) {
  if (thread.visibility === 'team') return undefined;
  if (!thread.shareLinkId) return t('comments.replyGuests');
  const link = shareLinkTag(thread);
  return link ? t('comments.replyLink', { link }) : t('comments.replyOwnLink');
}

export function Composer({
  onSend,
  submitLabel,
  placeholder,
  initial,
  draft,
  onCancel,
  autoFocus,
  children,
  publicAudience = false,
  pinned = false,
  onCollapse,
}: {
  onSend: (body: string) => Promise<void>;
  submitLabel: string;
  placeholder?: string;
  initial?: Comment;
  /** Keeps the text of a new thread while the panel closes or switches scope. */
  draft?: { elementId: string | null; visibility: CommentVisibility };
  onCancel?: () => void;
  autoFocus?: boolean;
  children?: ReactNode;
  publicAudience?: boolean;
  pinned?: boolean;
  onCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const people = useReviews((s) => s.people);
  const saved = draft ? getDraft(draft.elementId) : null;
  const [text, setText] = useState(() => saved?.text ?? (initial ? editableText(initial) : ''));
  const [picked, setPicked] = useState<readonly UserSummary[]>(
    () => saved?.picked ?? initial?.mentions ?? [],
  );
  const [focused, setFocused] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(collapseTimer.current), []);

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
  const buttonSubmit = useRef(false);
  const id = useId();
  // Where the caret goes once a picked mention is in the field.
  const pendingCaret = useRef<number | null>(null);

  // Runs after the render that puts the mention in the field, in the same task as the click that
  // picked it, so no key can arrive first. Moving the caret from a later animation frame put it
  // back before anything typed in the meantime ("per favore" became "er favorep").
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at === null) return;
    pendingCaret.current = null;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(at, at);
  });

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
  const mentioning = query !== null;
  useEffect(() => {
    if (mentioning) setReviews({ peopleRevision: getReviews().peopleRevision + 1 });
  }, [mentioning]);
  // Text after a space is probably the sentence going on, not a name that was not found.
  const noMatch = query !== null && !listOpen && !/\s/.test(query);
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
    pendingCaret.current = at;
    setCaret(at);
  };

  async function send(e: FormEvent) {
    e.preventDefault();
    // Implicit submit (including Enter on a radio) must never send. Only the button sends, or
    // the field's own shortcut, to the team: Enter alone cannot submit from a textarea.
    const clicked = buttonSubmit.current;
    buttonSubmit.current = false;
    const shortcut = !publicAudience && document.activeElement === input.current;
    if ((!clicked && !shortcut) || busy || !body.trim() || tooLong) return;
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
    <form
      className={`comment-composer${publicAudience ? ' is-public' : ''}${draft ? ' comment-composer--new' : ''}${focused || text || pinned ? ' is-open' : ''}`}
      onFocus={() => {
        clearTimeout(collapseTimer.current);
        setFocused(true);
      }}
      onBlur={(e) => {
        // Finish a pointer click before shrinking the panel and moving its controls.
        if (!e.currentTarget.contains(e.relatedTarget))
          collapseTimer.current = setTimeout(() => {
            setFocused(false);
            if (!text && !pinned) onCollapse?.();
          }, 180);
      }}
      onSubmit={(e) => void send(e)}
    >
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
          placeholder={placeholder ?? t('comments.placeholder')}
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
              if (!publicAudience) e.currentTarget.form?.requestSubmit();
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
        {tooLong ? (
          t('comments.tooLong', { max: MAX_COMMENT_LENGTH })
        ) : armed ? (
          t('comments.escapeAgain')
        ) : noMatch ? (
          t('comments.noMentionMatch')
        ) : (
          <>
            {t('comments.mentionHint')}
            {/* Fingers have no keyboard shortcut to read (comments.css). */}
            {!publicAudience && (
              <span className="comment-hint__keys"> · {t('comments.sendHint')}</span>
            )}
          </>
        )}
      </span>
      {children}
      <div className="review-row">
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !body.trim() || tooLong}
          onClick={(e) => {
            // Implicit submit is also a click, with no pointer and with focus left on the field.
            // A pointer, or a key on the focused button itself, is a deliberate press.
            buttonSubmit.current = e.detail > 0 || document.activeElement === e.currentTarget;
          }}
        >
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
