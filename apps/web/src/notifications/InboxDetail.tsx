// SPDX-License-Identifier: AGPL-3.0-only
import type { BoardDetail, Comment, CommentThread, Notification } from '@inkadra/shared';
import { Button, Icon } from '@inkadra/ui';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  authorName,
  findThread,
  mergeReplies,
  type Page,
  reviewKey,
} from '../board/review-model.ts';
import { canComment } from '../board/review-store.ts';
import { api } from '../lib/api.ts';
import { notificationPath } from './model.ts';
import { avatarBg, describeNotification, initials, relativeTime } from './Notifications.tsx';

type DetailProps = {
  notification: Notification | null;
  onNavigate: () => void;
  onCount: () => Promise<void>;
};

export function InboxDetail(props: DetailProps) {
  const [refresh, setRefresh] = useState<{
    version: number;
    notificationId?: string;
    threadId?: string;
  }>({ version: 0 });
  const refreshThreadId =
    refresh.notificationId === props.notification?.id ? refresh.threadId : undefined;
  return (
    <InboxDetailContent
      key={`${props.notification?.id}:${props.notification?.boardId}:${props.notification?.elementId}:${props.notification?.threadId}:${props.notification?.commentId}:${refresh.version}`}
      refreshThreadId={refreshThreadId}
      onRefresh={(threadId) =>
        setRefresh((value) => ({
          version: value.version + 1,
          notificationId: props.notification?.id,
          threadId,
        }))
      }
      {...props}
    />
  );
}

function InboxDetailContent({
  notification,
  onNavigate,
  onRefresh,
  refreshThreadId,
}: DetailProps & { onRefresh: (threadId?: string) => void; refreshThreadId?: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [boardDetail, setBoardDetail] = useState<BoardDetail | null>(null);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [activeThread, setActiveThread] = useState<CommentThread | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [olderReplies, setOlderReplies] = useState<Comment[]>([]);
  const [nextRepliesCursor, setNextRepliesCursor] = useState<string | null>(null);
  const [olderLoading, setOlderLoading] = useState(false);

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [actionError, setActionError] = useState<null | 'resolve' | 'reply' | 'older'>(null);
  const [repliesPaged, setRepliesPaged] = useState(false);
  // A generation also protects requests when switching threads within this notification.
  const generation = useRef(0);
  const writable = canComment(boardDetail?.myRole ?? null);

  useEffect(() => {
    const request = ++generation.current;
    let alive = true;
    setBoardDetail(null);
    setThreads([]);
    setActiveThread(null);
    setOlderReplies([]);
    setNextRepliesCursor(null);
    setRepliesPaged(false);
    setReplyText('');
    setReplySending(false);
    setActionBusy(false);
    setOlderLoading(false);
    setActionError(null);
    setLoadState('loading');
    const current = () => alive && request === generation.current;
    const load = async () => {
      if (!notification?.boardId) {
        if (current()) setLoadState('ready');
        return;
      }
      try {
        const board = await api.get<BoardDetail>(`/boards/${notification.boardId}`);
        if (!current()) return;
        const targetId = refreshThreadId ?? notification.threadId;
        const loaded: CommentThread[] = [];
        let cursor: string | null = null;
        let target: CommentThread | undefined;
        do {
          const page: Page<CommentThread> = await api.get(
            `/boards/${notification.boardId}/comments?status=all${
              notification.elementId
                ? `&elementId=${encodeURIComponent(notification.elementId)}`
                : ''
            }${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          );
          if (!current()) return;
          loaded.push(...page.items);
          target = targetId ? loaded.find((thread) => thread.id === targetId) : undefined;
          cursor = page.nextCursor;
        } while (cursor && !target);
        if (!targetId && notification.commentId) {
          const found = await findThread(
            loaded,
            notification.commentId,
            notification.elementId,
            (id, replyCursor) =>
              api.get(
                `/comments/${id}/replies${replyCursor ? `?cursor=${encodeURIComponent(replyCursor)}` : ''}`,
              ),
          );
          target = loaded.find((thread) => thread.id === found?.threadId);
          if (!current()) return;
          if (found?.older) {
            setOlderReplies(found.older.items);
            setNextRepliesCursor(found.older.cursor);
            setRepliesPaged(true);
          }
        }
        setBoardDetail(board);
        setThreads(loaded);
        setActiveThread(target && !target.deletedAt ? target : null);
        setLoadState('ready');
      } catch {
        if (current()) setLoadState('error');
      }
    };
    void load();
    return () => {
      alive = false;
      generation.current++;
    };
  }, [
    notification?.boardId,
    notification?.elementId,
    notification?.threadId,
    notification?.commentId,
    refreshThreadId,
  ]);

  const selectThread = useCallback((thread: CommentThread) => {
    generation.current++;
    setActiveThread(thread.deletedAt ? null : thread);
    setOlderReplies([]);
    setNextRepliesCursor(null);
    setRepliesPaged(false);
    setReplyText('');
    setReplySending(false);
    setActionBusy(false);
    setOlderLoading(false);
    setActionError(null);
  }, []);

  const handleToggleResolve = async () => {
    if (!activeThread || actionBusy || !writable || activeThread.deletedAt) return;
    const request = generation.current;
    const id = activeThread.id;
    setActionBusy(true);
    setActionError(null);
    const isResolved = Boolean(activeThread.resolvedAt);
    try {
      await api.post(`/comments/${id}/${isResolved ? 'reopen' : 'resolve'}`, {});
      if (request !== generation.current) return;
      const resolvedAt = isResolved ? null : new Date().toISOString();
      setActiveThread((prev) => (prev?.id === id ? { ...prev, resolvedAt } : prev));
      setThreads((list) => list.map((th) => (th.id === id ? { ...th, resolvedAt } : th)));
    } catch {
      if (request === generation.current) setActionError('resolve');
    } finally {
      if (request === generation.current) setActionBusy(false);
    }
  };

  const handleLoadOlderReplies = async () => {
    if (!activeThread || olderLoading) return;
    const request = generation.current;
    setOlderLoading(true);
    setActionError(null);
    try {
      const res = await api.get<Page<Comment>>(
        `/comments/${activeThread.id}/replies${
          nextRepliesCursor ? `?cursor=${encodeURIComponent(nextRepliesCursor)}` : ''
        }`,
      );
      if (request !== generation.current) return;
      setOlderReplies((prev) => mergeReplies(prev, res.items));
      setNextRepliesCursor(res.nextCursor);
      setRepliesPaged(true);
    } catch {
      if (request === generation.current) setActionError('older');
    } finally {
      if (request === generation.current) setOlderLoading(false);
    }
  };

  const handleSendReply = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!replyText.trim() || !notification?.boardId || !activeThread || replySending || !writable)
      return;
    const request = generation.current;
    const id = activeThread.id;
    setReplySending(true);
    setActionError(null);
    try {
      const res = await api.post<Comment>(`/boards/${notification.boardId}/comments`, {
        parentId: id,
        body: replyText.trim(),
      });
      if (request !== generation.current) return;
      const update = (th: CommentThread) =>
        th.id === id
          ? { ...th, replyCount: th.replyCount + 1, replies: mergeReplies(th.replies, [res]) }
          : th;
      setActiveThread((prev) => (prev ? update(prev) : null));
      setThreads((list) => list.map(update));
      setReplyText('');
    } catch {
      if (request === generation.current) setActionError('reply');
    } finally {
      if (request === generation.current) setReplySending(false);
    }
  };

  const handleOpenInBoard = () => {
    if (!notification) return;
    const p = notificationPath(notification);
    if (p) {
      onNavigate();
      navigate(p);
    }
  };

  if (!notification) {
    return (
      <aside
        className="notifications__detail-pane inbox-detail"
        aria-label={t('notifications.conversation')}
      >
        <div className="inbox-detail__empty">
          <Icon name="inbox" size={32} />
          <p>{t('notifications.noNotificationSelected')}</p>
        </div>
      </aside>
    );
  }

  const p = notificationPath(notification);
  const breadcrumbs = [
    notification.projectName,
    ...(boardDetail?.breadcrumb?.map((b) => b.title) ?? []),
    notification.boardTitle,
    notification.elementId
      ? notification.elementId.length > 8
        ? notification.elementId.slice(0, 6)
        : notification.elementId
      : null,
  ].filter((item): item is string => Boolean(item));

  const pinnedThreads = threads.filter(
    (th) => th.pin && th.pin.x >= 0 && th.pin.x <= 1 && th.pin.y >= 0 && th.pin.y <= 1,
  );
  const activePinIndex = activeThread
    ? pinnedThreads.findIndex((pin) => pin.id === activeThread.id)
    : -1;
  const otherThreads = threads.filter((th) => th.id !== activeThread?.id);
  const allReplies = activeThread ? mergeReplies(olderReplies, activeThread.replies) : [];
  const hiddenReplies = activeThread ? Math.max(0, activeThread.replyCount - allReplies.length) : 0;
  const isResolved = Boolean(activeThread?.resolvedAt);

  return (
    <aside
      className="notifications__detail-pane inbox-detail"
      aria-label={t('notifications.conversation')}
    >
      <header className="inbox-detail__head">
        <nav aria-label={t('notifications.breadcrumb')} className="inbox-detail__breadcrumb">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <span key={crumb} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {idx > 0 && <span className="inbox-detail__breadcrumb-sep">/</span>}
                <span
                  className={
                    isLast ? 'inbox-detail__breadcrumb-current' : 'inbox-detail__breadcrumb-item'
                  }
                >
                  {crumb}
                </span>
              </span>
            );
          })}
        </nav>
        <div className="inbox-detail__actions">
          <Button variant="ghost" onClick={() => onRefresh(activeThread?.id)}>
            {t('notifications.refresh')}
          </Button>
          {p && (
            <Button variant="ghost" onClick={handleOpenInBoard}>
              {t('notifications.openInBoard')}
            </Button>
          )}
          {activeThread && writable && !activeThread.deletedAt && (
            <button
              type="button"
              className={`ink-button inbox-detail__resolve-btn ${
                isResolved ? 'is-resolved' : 'is-unresolved'
              }`}
              disabled={actionBusy}
              onClick={() => void handleToggleResolve()}
            >
              <Icon name="check" size={14} />
              {t(isResolved ? 'notifications.markReopen' : 'notifications.markResolved')}
            </button>
          )}
        </div>
      </header>
      <div className="inbox-detail__body">
        <section aria-label={t('notifications.cardPreview')} className="inbox-detail__card-section">
          <div className="inbox-detail__meta">
            {notification.reviewStatus && (
              <span>
                <span className="inbox-detail__meta-label">{t('notifications.audience')}:</span>
                <span className="inbox-pill inbox-pill--resolved">
                  {t(`review.status.${reviewKey(notification.reviewStatus)}`)}
                </span>
              </span>
            )}
            {notification.elementId && (
              <span>
                <span className="inbox-detail__meta-label">{t('notifications.cardPreview')}:</span>
                {notification.elementId}
              </span>
            )}
            {notification.boardTitle && (
              <span>
                <span className="inbox-detail__meta-label">{t('notifications.boardLabel')}:</span>
                {notification.boardTitle}
              </span>
            )}
          </div>
          {otherThreads.length > 0 && (
            <div className="inbox-detail__other-comments">
              <div className="inbox-detail__other-comments-title">
                {t('notifications.otherComments')}
              </div>
              {otherThreads.map((other) => {
                const pinIdx = pinnedThreads.findIndex((pin) => pin.id === other.id);
                const author = authorName(other.author);
                return (
                  <button
                    key={other.id}
                    type="button"
                    className="inbox-detail__other-item"
                    onClick={() => selectThread(other)}
                  >
                    {pinIdx >= 0 && (
                      <span
                        className="inbox-detail__pin inbox-detail__pin--inactive"
                        style={{ position: 'static', transform: 'none', flex: 'none' }}
                      >
                        {pinIdx + 1}
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        {author}
                        {other.visibility === 'team' && (
                          <span
                            className="inbox-pill inbox-pill--internal"
                            style={{ marginLeft: 6 }}
                          >
                            {t('notifications.internalNote')}
                          </span>
                        )}
                      </div>
                      <p className="inbox-detail__other-excerpt">
                        {other.body || t('comments.deleted')}
                      </p>
                    </div>
                    <span
                      className={`inbox-pill ${
                        other.resolvedAt ? 'inbox-pill--resolved' : 'inbox-pill--open'
                      }`}
                    >
                      {t(
                        other.resolvedAt
                          ? 'notifications.statusResolved'
                          : 'notifications.statusOpen',
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section
          aria-label={t('notifications.conversation')}
          className="inbox-detail__conversation"
        >
          {loadState === 'loading' ? (
            <p role="status">{t('comments.loading')}</p>
          ) : loadState === 'error' ? (
            <p role="alert">
              {t('notifications.error')}{' '}
              <Button onClick={() => onRefresh(activeThread?.id)}>{t('comments.retry')}</Button>
            </p>
          ) : activeThread ? (
            <>
              {actionError && (
                <p role="alert">
                  {t('notifications.actionError')}{' '}
                  <Button
                    onClick={() =>
                      void (actionError === 'resolve'
                        ? handleToggleResolve()
                        : actionError === 'reply'
                          ? handleSendReply()
                          : handleLoadOlderReplies())
                    }
                  >
                    {t('comments.retry')}
                  </Button>
                </p>
              )}
              <p>
                {t(
                  activeThread.visibility === 'everyone'
                    ? 'notifications.visibleToClient'
                    : 'notifications.internalNote',
                )}
              </p>
              <div className="inbox-detail__thread-header">
                {activePinIndex >= 0 && (
                  <span
                    className="inbox-detail__pin inbox-detail__pin--active"
                    style={{ position: 'static', transform: 'none', flex: 'none' }}
                  >
                    {activePinIndex + 1}
                  </span>
                )}
                <span>
                  {activePinIndex >= 0
                    ? t('notifications.pointComment', { number: activePinIndex + 1 })
                    : t('notifications.thread')}
                </span>
                <span
                  className={`inbox-pill ${
                    activeThread.resolvedAt ? 'inbox-pill--resolved' : 'inbox-pill--open'
                  }`}
                  style={{ marginLeft: 'auto' }}
                >
                  {t(
                    activeThread.resolvedAt
                      ? 'notifications.statusResolved'
                      : 'notifications.statusOpen',
                  )}
                </span>
              </div>
              <div className="inbox-detail__thread-messages">
                <div className="inbox-detail__message">
                  <span
                    className="notification__av"
                    style={{ background: avatarBg(authorName(activeThread.author)) }}
                  >
                    {initials(authorName(activeThread.author))}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="inbox-detail__message-author">
                      <b>{authorName(activeThread.author)}</b>
                      <time dateTime={activeThread.createdAt} style={{ color: '#808086' }}>
                        {relativeTime(activeThread.createdAt, i18n.language)}
                      </time>
                      {activeThread.visibility === 'team' && (
                        <span className="inbox-pill inbox-pill--internal">
                          {t('notifications.internalNote')}
                        </span>
                      )}
                    </div>
                    <p className="inbox-detail__message-body">{activeThread.body}</p>
                  </div>
                </div>
                {hiddenReplies > 0 && (!repliesPaged || nextRepliesCursor) && (
                  <Button
                    variant="ghost"
                    onClick={() => void handleLoadOlderReplies()}
                    disabled={olderLoading}
                  >
                    {t('comments.moreReplies', { count: hiddenReplies })}
                  </Button>
                )}
                {allReplies.map((reply) => {
                  const replyAuthor = authorName(reply.author);
                  return (
                    <div key={reply.id} className="inbox-detail__message">
                      <span
                        className="notification__av"
                        style={{ background: avatarBg(replyAuthor) }}
                      >
                        {initials(replyAuthor)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="inbox-detail__message-author">
                          <b>{replyAuthor}</b>
                          <time dateTime={reply.createdAt} style={{ color: '#808086' }}>
                            {relativeTime(reply.createdAt, i18n.language)}
                          </time>
                          {reply.visibility === 'team' && (
                            <span className="inbox-pill inbox-pill--internal">
                              {t('notifications.internalNote')}
                            </span>
                          )}
                        </div>
                        <p className="inbox-detail__message-body">{reply.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {writable && (
                <form className="inbox-detail__composer" onSubmit={(e) => void handleSendReply(e)}>
                  <textarea
                    className="inbox-detail__composer-textarea"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onInput={(e) => setReplyText((e.target as HTMLTextAreaElement).value)}
                    placeholder={t('notifications.replyPlaceholder')}
                    rows={2}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        void handleSendReply();
                      }
                    }}
                  />
                  <div className="inbox-detail__composer-footer">
                    <div style={{ flex: 1 }} />
                    <Button
                      variant="primary"
                      disabled={!replyText.trim() || replySending}
                      onClick={() => void handleSendReply()}
                    >
                      {t('notifications.sendReply')}
                    </Button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="inbox-detail__card-only">
              {(notification.threadId || notification.commentId) && (
                <p role="status">{t('notifications.conversationUnavailable')}</p>
              )}
              <div className="inbox-detail__card-only-header">
                <span
                  className="notification__av"
                  style={{
                    width: 36,
                    height: 36,
                    background: avatarBg(authorName(notification.actor)),
                  }}
                >
                  {initials(authorName(notification.actor))}
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {authorName(notification.actor)} {describeNotification(notification, t)}
                  </div>
                  <time
                    dateTime={notification.createdAt}
                    style={{ color: '#808086', fontSize: 12 }}
                  >
                    {relativeTime(notification.createdAt, i18n.language)}
                  </time>
                </div>
              </div>
              {notification.excerpt && (
                <div className="inbox-detail__card-only-excerpt">{notification.excerpt}</div>
              )}
              {p && (
                <Button variant="ghost" onClick={handleOpenInBoard}>
                  {t('notifications.openInBoard')}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
