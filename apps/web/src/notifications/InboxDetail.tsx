// SPDX-License-Identifier: AGPL-3.0-only
import type { BoardDetail, Comment, CommentThread, Notification } from '@inkadra/shared';
import { Button, Icon } from '@inkadra/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { authorName, type Page, reviewKey } from '../board/review-model.ts';
import { api } from '../lib/api.ts';
import { notificationPath } from './model.ts';
import { avatarBg, describeNotification, initials, relativeTime } from './Notifications.tsx';

export function InboxDetail({
  notification,
  onNavigate,
  onCount: _onCount,
}: {
  notification: Notification | null;
  onNavigate: () => void;
  onCount: () => Promise<void>;
}) {
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

  useEffect(() => {
    let alive = true;
    if (!notification) {
      setBoardDetail(null);
      setThreads([]);
      setActiveThread(null);
      return;
    }

    setOlderReplies([]);
    setNextRepliesCursor(null);
    setReplyText('');

    if (notification.boardId) {
      const boardPromise = api.get<BoardDetail>(`/boards/${notification.boardId}`);
      if (boardPromise?.then) {
        boardPromise
          .then((b) => {
            if (alive) setBoardDetail(b);
          })
          .catch(() => {
            if (alive) setBoardDetail(null);
          });
      }

      const commentsUrl = `/boards/${notification.boardId}/comments?status=all${
        notification.elementId ? `&elementId=${encodeURIComponent(notification.elementId)}` : ''
      }`;
      const commentsPromise = api.get<Page<CommentThread>>(commentsUrl);
      if (commentsPromise?.then) {
        commentsPromise
          .then((p) => {
            if (!alive || !p?.items) return;
            setThreads(p.items);
            let target = p.items.find(
              (item: CommentThread) =>
                (notification.threadId && item.id === notification.threadId) ||
                (notification.commentId &&
                  (item.id === notification.commentId ||
                    item.replies.some((r: Comment) => r.id === notification.commentId))),
            );
            if (!target && p.items.length > 0) {
              target = p.items[0];
            }
            setActiveThread(target ?? null);
          })
          .catch(() => {
            if (alive) {
              setThreads([]);
              setActiveThread(null);
            }
          });
      }
    } else {
      setBoardDetail(null);
      setThreads([]);
      setActiveThread(null);
    }

    return () => {
      alive = false;
    };
  }, [notification]);

  const selectThread = useCallback((thread: CommentThread) => {
    setActiveThread(thread);
    setOlderReplies([]);
    setNextRepliesCursor(null);
    setReplyText('');
  }, []);

  const handleToggleResolve = async () => {
    if (!activeThread || actionBusy) return;
    setActionBusy(true);
    const isResolved = Boolean(activeThread.resolvedAt);
    const action = isResolved ? 'reopen' : 'resolve';
    try {
      await api.post(`/comments/${activeThread.id}/${action}`, {});
      const updatedResolvedAt = isResolved ? null : new Date().toISOString();
      setActiveThread((prev) => (prev ? { ...prev, resolvedAt: updatedResolvedAt } : null));
      setThreads((list) =>
        list.map((th) =>
          th.id === activeThread.id ? { ...th, resolvedAt: updatedResolvedAt } : th,
        ),
      );
    } catch {
      // Revert on error
    } finally {
      setActionBusy(false);
    }
  };

  const handleLoadOlderReplies = async () => {
    if (!activeThread || olderLoading) return;
    setOlderLoading(true);
    try {
      const url = `/comments/${activeThread.id}/replies${
        nextRepliesCursor ? `?cursor=${encodeURIComponent(nextRepliesCursor)}` : ''
      }`;
      const res = await api.get<Page<Comment>>(url);
      setOlderReplies((prev) => [...res.items, ...prev]);
      setNextRepliesCursor(res.nextCursor);
    } catch {
      // Ignore error
    } finally {
      setOlderLoading(false);
    }
  };

  const handleSendReply = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!replyText.trim() || !notification?.boardId || !activeThread || replySending) return;
    setReplySending(true);
    try {
      const res = await api.post<Comment>(`/boards/${notification.boardId}/comments`, {
        parentId: activeThread.id,
        body: replyText.trim(),
      });
      setActiveThread((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          replyCount: prev.replyCount + 1,
          replies: [...prev.replies, res],
        };
      });
      setThreads((list) =>
        list.map((th) =>
          th.id === activeThread.id
            ? { ...th, replyCount: th.replyCount + 1, replies: [...th.replies, res] }
            : th,
        ),
      );
      setReplyText('');
    } catch {
      // Ignore error
    } finally {
      setReplySending(false);
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
  const allReplies = activeThread ? [...olderReplies, ...activeThread.replies] : [];
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
          {p && (
            <Button variant="ghost" onClick={handleOpenInBoard}>
              {t('notifications.openInBoard')}
            </Button>
          )}
          {activeThread && (
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
          <div className="inbox-detail__preview-box">
            <svg
              role="img"
              aria-label={notification.boardTitle ?? 'Frame preview'}
              viewBox="0 0 240 100"
              className="inbox-detail__preview-svg"
            >
              <defs>
                <radialGradient id="inbox-neon" cx="0.78" cy="0.3" r="0.6">
                  <stop offset="0" stopColor="#3B7CF6" stopOpacity="0.25" />
                  <stop offset="1" stopColor="#3B7CF6" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect width="240" height="100" fill="url(#inbox-neon)" />
              <path
                d="M40 85 Q80 40 120 50 Q160 60 200 85"
                fill="none"
                stroke="#333338"
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <circle cx="120" cy="50" r="14" fill="none" stroke="#44444c" strokeWidth="1.2" />
            </svg>
            {pinnedThreads.map((pinned, idx) => {
              const isActive = activeThread?.id === pinned.id;
              return (
                <button
                  key={pinned.id}
                  type="button"
                  className={`inbox-detail__pin ${
                    isActive ? 'inbox-detail__pin--active' : 'inbox-detail__pin--inactive'
                  }`}
                  style={{
                    left: `${(pinned.pin?.x ?? 0 * 100).toFixed(1)}%`,
                    top: `${(pinned.pin?.y ?? 0 * 100).toFixed(1)}%`,
                  }}
                  aria-label={t('notifications.pointComment', { number: idx + 1 })}
                  onClick={() => selectThread(pinned)}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
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
                <span className="inbox-detail__meta-label">Board:</span>
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
          {activeThread ? (
            <>
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
                {hiddenReplies > 0 && (
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
                  <div
                    className="inbox-detail__audience-tabs"
                    role="tablist"
                    aria-label={t('notifications.audience')}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeThread.visibility === 'everyone'}
                      className={`inbox-detail__audience-tab ${
                        activeThread.visibility === 'everyone' ? 'is-active' : ''
                      }`}
                    >
                      {t('notifications.visibleToClient')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeThread.visibility === 'team'}
                      className={`inbox-detail__audience-tab ${
                        activeThread.visibility === 'team' ? 'is-active' : ''
                      }`}
                    >
                      {t('notifications.internalNote')}
                    </button>
                  </div>
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
            </>
          ) : (
            <div className="inbox-detail__card-only">
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
