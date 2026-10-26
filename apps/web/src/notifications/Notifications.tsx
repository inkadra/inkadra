// SPDX-License-Identifier: AGPL-3.0-only
import type { Notification, NotificationPreferences, UnreadCount } from '@inkadra/shared';
import { Button, Icon, IconButton } from '@inkadra/ui';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { authorName, groupByDay, type Page, reviewKey } from '../board/review-model.ts';
import { api } from '../lib/api.ts';
import {
  dayLabel,
  filterNotifications,
  type InboxFilter,
  KNOWN_TYPES,
  notificationPath,
  unreadBadge,
} from './model.ts';
import './notifications.css';

const POLL_MS = 60_000;

/** Hook to fetch and periodically poll the unread notification count. */
export function useUnreadCount(): [number, () => Promise<void>] {
  const [unread, setUnread] = useState(0);

  const count = useCallback(async () => {
    // A hidden tab does not poll; it asks again when it is shown.
    if (document.visibilityState === 'hidden') return;
    try {
      const result = await api.get<UnreadCount>('/me/notifications/unread-count');
      setUnread(result.unread);
    } catch {
      // Offline or signed out: keep the last number; the next poll tries again.
    }
  }, []);

  useEffect(() => {
    void count();
    const timer = setInterval(() => void count(), POLL_MS);
    const onFocus = () => void count();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [count]);

  return [unread, count];
}

/** What happened, after the actor's name; unknown types read as a plain line. */
export function describeNotification(
  n: Pick<Notification, 'type' | 'reviewStatus'>,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  const type = (KNOWN_TYPES as readonly string[]).includes(n.type) ? n.type : 'unknown';
  if (type === 'review' && n.reviewStatus)
    return t('notifications.type.reviewStatus', {
      status: t(`review.status.${reviewKey(n.reviewStatus)}`),
    });
  return t(`notifications.type.${type}`);
}

/** Bell of the app header: unread count, checked once a minute and when the window is focused. */
export function NotificationBell({
  unread,
  onCount: count,
}: {
  unread: number;
  onCount: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bell = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    bell.current?.focus();
  }, []);
  const dismiss = useCallback(() => setOpen(false), []);

  return (
    <div className="notification-bell">
      <button
        ref={bell}
        type="button"
        className="ink-iconbtn notification-bell__button"
        aria-label={t('notifications.bell', { count: unread })}
        title={t('notifications.title')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="notification-bell__count" aria-hidden="true">
            {unreadBadge(unread)}
          </span>
        )}
      </button>
      {open && (
        <NotificationList
          unread={unread}
          bell={bell}
          onClose={close}
          onNavigate={dismiss}
          onCount={count}
        />
      )}
    </div>
  );
}

function initials(name: string | null | undefined): string {
  if (!name) return 'IN';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function avatarBg(name: string | null | undefined): string {
  if (!name) return '#8A8A90';
  const colors = ['#7CC4C9', '#C9B27C', '#D9C6A5', '#F2B08A', '#9DB8F2', '#C3B2F2'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length] ?? '#8A8A90';
}

export function relativeTime(iso: string, language: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  return formatter.format(-Math.floor(hours / 24), 'day');
}

export function NotificationList({
  bell,
  unread,
  fixed,
  onClose,
  onNavigate,
  onCount,
}: {
  unread: number;
  bell?: RefObject<HTMLButtonElement | null>;
  fixed?: boolean;
  onClose: () => void;
  onNavigate: () => void;
  onCount: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [actionError, setActionError] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // Marking all as read covers what was listed when the panel opened, not what arrives later.
  const openedAt = useRef(new Date().toISOString());

  const load = useCallback(async (cursor: string | null) => {
    setState('loading');
    try {
      const p = await api.get<Page<Notification>>(
        `/me/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      setItems((list) => (cursor ? [...list, ...p.items] : p.items));
      setNext(p.nextCursor);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  // The first page loads once: a new unread count must not drop the pages already shown.
  useEffect(() => {
    void load(null);
    panel.current?.focus();
  }, [load]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !bell?.current?.contains(target)) {
        onNavigate();
      }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [bell, onNavigate]);

  const markRead = async (id: string) => {
    await api.post(`/me/notifications/${id}/read`, {});
    const now = new Date().toISOString();
    setItems((list) => list.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n)));
    void onCount();
  };

  const markAll = async () => {
    setActionError(false);
    try {
      await api.post('/me/notifications/read-all', { before: openedAt.current });
      const now = new Date().toISOString();
      setItems((list) =>
        list.map((n) => (n.readAt || n.createdAt > openedAt.current ? n : { ...n, readAt: now })),
      );
      void onCount();
    } catch {
      setActionError(true);
    }
  };

  const filteredItems = filterNotifications(items, filter);
  const groups = groupByDay(filteredItems, (d) => dayLabel(d, new Date(), i18n.language, t));
  const anyUnread = unread > 0;

  return (
    <div
      ref={panel}
      className={`notifications${fixed ? ' notifications--fixed' : ''}`}
      tabIndex={-1}
      role="dialog"
      aria-labelledby="notifications-title"
      onKeyDown={(e) => {
        // Keys pressed here are not board shortcuts.
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <header className="notifications__head">
        <h2 id="notifications-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('notifications.title')}
          {unread > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 99,
                background: '#2563EB',
                color: '#FFFFFF',
              }}
            >
              {unreadBadge(unread)}
            </span>
          )}
        </h2>
        {fixed ? (
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <IconButton
              icon="check"
              label={t('notifications.readAll')}
              disabled={!anyUnread}
              onClick={() => void markAll()}
            />
            <IconButton icon="close" label={t('notifications.close')} onClick={onClose} />
          </div>
        ) : (
          <>
            <Button variant="ghost" disabled={!anyUnread} onClick={() => void markAll()}>
              {t('notifications.readAll')}
            </Button>
            <IconButton icon="close" label={t('notifications.close')} onClick={onClose} />
          </>
        )}
      </header>
      {fixed && (
        <div
          role="tablist"
          aria-label={t('notifications.filter')}
          className="notifications-filter-tabs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`notifications-filter-tab ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t('notifications.tabs.all')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'mentions'}
            className={`notifications-filter-tab ${filter === 'mentions' ? 'is-active' : ''}`}
            onClick={() => setFilter('mentions')}
          >
            {t('notifications.tabs.mentions')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'approvals'}
            className={`notifications-filter-tab ${filter === 'approvals' ? 'is-active' : ''}`}
            onClick={() => setFilter('approvals')}
          >
            {t('notifications.tabs.approvals')}
          </button>
        </div>
      )}
      {fixed && <p className="ink-muted notifications__status">{t('notifications.loadedOnly')}</p>}
      {state === 'ready' && filteredItems.length === 0 && (
        <p className="notifications__empty">{t('notifications.empty')}</p>
      )}
      {groups.map(([day, list]) => (
        <section key={day} aria-label={day}>
          <h3 className="notifications__day">{day}</h3>
          <ul className="notifications__list">
            {list.map((n) => {
              const path = notificationPath(n);
              const actor = authorName(n.actor);
              return (
                <li key={n.id} className={n.readAt ? 'notification' : 'notification is-unread'}>
                  <button
                    type="button"
                    className={`notification__open ${fixed ? 'notification__open--drawer' : ''}`}
                    disabled={!path}
                    onClick={async () => {
                      setActionError(false);
                      if (!n.readAt) await markRead(n.id).catch(() => setActionError(true));
                      if (path) {
                        onNavigate();
                        navigate(path);
                      }
                    }}
                  >
                    {!n.readAt && <span className="notification__bar" />}
                    {fixed && (
                      <span className="notification__av" style={{ background: avatarBg(actor) }}>
                        {initials(actor)}
                      </span>
                    )}
                    <div className="notification__body">
                      <span className="notification__line">
                        {actor && <b>{actor} </b>}
                        {describeNotification(n, t)}
                      </span>
                      <div className="notification__subline">
                        {(n.boardTitle || n.projectName) && (
                          <span className="notification__pill">
                            {[...new Set([n.projectName, n.boardTitle])]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                        <time dateTime={n.createdAt}>
                          {relativeTime(n.createdAt, i18n.language)}
                        </time>
                      </div>
                      {n.excerpt && <span className="notification__excerpt">{n.excerpt}</span>}
                    </div>
                    {!n.readAt && <span className="notification__dot" style={{ flex: 'none' }} />}
                  </button>
                  {!n.readAt && (
                    <IconButton
                      icon="check"
                      label={t('notifications.read')}
                      onClick={(e) => {
                        // The button goes away once read: focus stays on the notification.
                        const open = e.currentTarget
                          .closest('li')
                          ?.querySelector<HTMLButtonElement>('.notification__open');
                        void markRead(n.id).then(
                          () => (open && !open.disabled ? open : panel.current)?.focus(),
                          () => setActionError(true),
                        );
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {state === 'loading' && (
        <p role="status" className="ink-muted notifications__status">
          {t('comments.loading')}
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="review-error notifications__status">
          {t('notifications.error')}{' '}
          <button type="button" className="review-link" onClick={() => void load(null)}>
            {t('comments.retry')}
          </button>
        </p>
      )}
      {actionError && (
        <p role="alert" className="review-error notifications__status">
          {t('notifications.actionError')}
        </p>
      )}
      {next && state === 'ready' && (
        <Button variant="ghost" onClick={() => void load(next)}>
          {t('notifications.more')}
        </Button>
      )}
    </div>
  );
}

/** Settings → Account: how often notifications arrive by email. */
export function EmailNotifications() {
  const { t } = useTranslation();
  const [email, setEmail] = useState<NotificationPreferences['email'] | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<NotificationPreferences>('/me/notification-preferences')
      .then((p) => {
        if (alive) setEmail(p.email);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="settings__section">
      <div className="settings__head">
        <h2>{t('notifications.emailTitle')}</h2>
        <p className="ink-muted">{t('notifications.emailHint')}</p>
      </div>
      <div className="settings__body">
        {loadError ? (
          <p role="alert">{t('notifications.preferencesError')}</p>
        ) : (
          <form
            className="settings__form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!email) return;
              setState('saving');
              try {
                await api.patch('/me/notification-preferences', { email });
                setState('saved');
              } catch {
                setState('error');
              }
            }}
          >
            <fieldset className="notification-frequency" disabled={email === null}>
              <legend className="settings__label">{t('notifications.emailLabel')}</legend>
              {(['immediate', 'daily', 'off'] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="email-frequency"
                    value={value}
                    checked={email === value}
                    onChange={() => {
                      setEmail(value);
                      setState('idle');
                    }}
                  />
                  {t(`notifications.frequency.${value}`)}
                </label>
              ))}
            </fieldset>
            <div className="settings__actions">
              <Button
                type="submit"
                variant="primary"
                disabled={email === null || state === 'saving'}
              >
                {t('settings.save')}
              </Button>
            </div>
            {state === 'error' && <p role="alert">{t('notifications.preferencesError')}</p>}
            {state === 'saved' && <p role="status">{t('settings.saved')}</p>}
          </form>
        )}
      </div>
    </section>
  );
}
