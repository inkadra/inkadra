// SPDX-License-Identifier: AGPL-3.0-only

import type { Notification, NotificationPreferences, UnreadCount } from '@inkadra/shared';
import { Button, Icon, IconButton, Radio, swallowOutsidePress } from '@inkadra/ui';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { authorName, groupByDay, type Page, reviewKey } from '../board/review-model.ts';
import { expiryDate } from '../lib/access.ts';
import { api } from '../lib/api.ts';
import { signedInId } from '../lib/me.ts';
import { trackSave } from '../routes/settings-save.ts';
import { MyTasks } from '../routes/MyTasks.tsx';
import { InboxDetail } from './InboxDetail.tsx';
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

/** Pathless notifications render disabled: keep them out of selection and keyboard order. */
const isNavigable = (n: Notification) => Boolean(notificationPath(n));

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

export interface NotificationFeed {
  items: Notification[];
  next: string | null;
  state: 'loading' | 'ready' | 'error';
  load: (cursor: string | null) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  /** Marks read what was created up to `before`; later arrivals stay unread. */
  markAll: (before: string) => Promise<void>;
}

/**
 * The loaded notifications and their read state, refreshing the unread count after each change.
 * The app shell keeps one feed for the bell and the Inbox: the bell is a quick peek of the same
 * list, so reading a notification in one shows it read in the other.
 */
export function useNotificationFeed(onCount: () => Promise<void>): NotificationFeed {
  const [{ items, next }, setList] = useState<{ items: Notification[]; next: string | null }>({
    items: [],
    next: null,
  });
  const setItems = useCallback(
    (update: (list: Notification[]) => Notification[]) =>
      setList((l) => ({ ...l, items: update(l.items) })),
    [],
  );
  const [state, setState] = useState<NotificationFeed['state']>('loading');

  // Each first-page load starts a new generation: a response from an older one, or a "Show more"
  // started before it, is dropped instead of overwriting newer state.
  const generation = useRef(0);
  // Reads confirmed here win over a page fetched before the server saw them.
  const readLocally = useRef(new Map<string, string>());
  const readAllBefore = useRef<{ before: string; at: string } | null>(null);
  const withLocalReads = useCallback((n: Notification): Notification => {
    if (n.readAt) return n;
    const at = readLocally.current.get(n.id);
    if (at) return { ...n, readAt: at };
    const all = readAllBefore.current;
    return all && n.createdAt <= all.before ? { ...n, readAt: all.at } : n;
  }, []);

  const load = useCallback(
    async (cursor: string | null) => {
      const current = cursor ? generation.current : ++generation.current;
      setState('loading');
      try {
        const p = await api.get<Page<Notification>>(
          `/me/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        if (current !== generation.current) return;
        if (!p?.items) {
          setState('error');
          return;
        }
        const page = p.items.map(withLocalReads);
        setList((l) => {
          if (cursor)
            return {
              items: [...l.items, ...page.filter((n) => !l.items.some((o) => o.id === n.id))],
              next: p.nextCursor ?? null,
            };
          // Refreshing the first page keeps the older pages already loaded with "Show more".
          const oldest = page.at(-1)?.createdAt;
          const older = p.nextCursor
            ? l.items.filter(
                (n) => (!oldest || n.createdAt < oldest) && !page.some((o) => o.id === n.id),
              )
            : [];
          return older.length
            ? { items: [...page, ...older.map(withLocalReads)], next: l.next }
            : { items: page, next: p.nextCursor ?? null };
        });
        setState('ready');
      } catch {
        if (current === generation.current) setState('error');
      }
    },
    [withLocalReads],
  );

  const markRead = useCallback(
    async (id: string) => {
      await api.post(`/me/notifications/${id}/read`, {});
      const now = new Date().toISOString();
      readLocally.current.set(id, now);
      setItems((list) => list.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n)));
      void onCount();
    },
    [onCount, setItems],
  );

  const markAll = useCallback(
    async (before: string) => {
      await api.post('/me/notifications/read-all', { before });
      const now = new Date().toISOString();
      if (!readAllBefore.current || readAllBefore.current.before < before)
        readAllBefore.current = { before, at: now };
      setItems((list) =>
        list.map((n) => (n.readAt || n.createdAt > before ? n : { ...n, readAt: now })),
      );
      void onCount();
    },
    [onCount, setItems],
  );

  return useMemo(
    () => ({ items, next, state, load, markRead, markAll }),
    [items, next, state, load, markRead, markAll],
  );
}

/**
 * Who a notification starts with: the actor, or for an opened link the label of the link
 * (nobody is named for a visit), or "A guest" without a label.
 */
export function notificationActor(
  n: Pick<Notification, 'type' | 'actor'> & Partial<Pick<Notification, 'shareLinkLabel'>>,
  t: (key: string) => string,
): string | null {
  if (n.type === 'link_opened') return n.shareLinkLabel?.trim() || t('notifications.type.guest');
  return authorName(n.actor);
}

/** What happened, after the actor's name; unknown types read as a plain line. */
export function describeNotification(
  n: Pick<Notification, 'type' | 'reviewStatus'> &
    Partial<Pick<Notification, 'subject' | 'accessExpiresAt'>>,
  t: (key: string, values?: Record<string, string>) => string,
  /** The signed-in person, to tell their own access from a member's (decision 0041). */
  me?: { id?: string; locale?: string },
): string {
  const type = (KNOWN_TYPES as readonly string[]).includes(n.type) ? n.type : 'unknown';
  if (type === 'access_expiring' || type === 'access_expired') {
    const own = !n.subject || n.subject.id === (me?.id ?? signedInId());
    const date = n.accessExpiresAt
      ? expiryDate(n.accessExpiresAt, me?.locale ?? document.documentElement.lang ?? 'it')
      : '';
    return t(`notifications.type.${type}${own ? 'Own' : ''}`, {
      name: n.subject?.name ?? '',
      date,
    });
  }
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
  feed,
  onOpenInbox,
}: {
  unread: number;
  onCount: () => Promise<void>;
  feed?: NotificationFeed;
  /** Opens the full Inbox; the bell shows the same list. Closing it returns focus to `opener`. */
  onOpenInbox: (opener: HTMLButtonElement | null) => void;
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
        data-ink-tooltip={t('nav.inbox')}
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
          feed={feed}
          onOpenInbox={() => {
            setOpen(false);
            onOpenInbox(bell.current);
          }}
        />
      )}
    </div>
  );
}

export function initials(name: string | null | undefined): string {
  if (!name) return 'IN';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function avatarBg(name: string | null | undefined): string {
  const colors = ['blue', 'green', 'orange', 'purple'];
  let hash = 0;
  for (const char of name ?? '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `color-mix(in srgb, var(--ink-tag-${colors[hash % colors.length]}) 18%, var(--ink-bg-panel))`;
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
  feed,
  onOpenInbox,
}: {
  unread: number;
  bell?: RefObject<HTMLButtonElement | null>;
  fixed?: boolean;
  onClose: () => void;
  onNavigate: () => void;
  onCount: () => Promise<void>;
  /** Shared with the bell by the app shell; without it the list keeps its own. */
  feed?: NotificationFeed;
  /** Bell only: leaves the peek for the full Inbox. */
  onOpenInbox?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const ownFeed = useNotificationFeed(onCount);
  const { items, next, state, load, markRead, markAll: readAll } = feed ?? ownFeed;
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [actionError, setActionError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia('(width < 768px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(width < 768px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const panel = useRef<HTMLDivElement>(null);
  // Marking all as read covers what was listed when the panel opened, not what arrives later.
  const openedAt = useRef(new Date().toISOString());

  // The first page reloads when the panel opens; pages already loaded with "Show more" stay.
  useEffect(() => {
    void load(null);
    panel.current?.focus();
  }, [load]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || bell?.current?.contains(target)) return;
      swallowOutsidePress(e);
      onNavigate();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [bell, onNavigate]);

  // Arrow navigation batches reads: only the item where scrolling stops is marked, ~400 ms later.
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearReadTimer = useCallback(() => {
    if (readTimer.current) {
      clearTimeout(readTimer.current);
      readTimer.current = null;
    }
  }, []);
  const markReadDebounced = useCallback(
    (id: string) => {
      clearReadTimer();
      readTimer.current = setTimeout(() => {
        readTimer.current = null;
        void markRead(id).catch(() => setActionError(true));
      }, 400);
    },
    [clearReadTimer, markRead],
  );
  useEffect(() => clearReadTimer, [clearReadTimer]);

  const markAll = async () => {
    setActionError(false);
    try {
      await readAll(openedAt.current);
    } catch {
      setActionError(true);
    }
  };

  const filteredItems = filterNotifications(items, filter);
  const groups = groupByDay(filteredItems, (d) => dayLabel(d, new Date(), i18n.language, t));
  const anyUnread = unread > 0;
  // Pathless notifications render disabled: they stay out of the roving tab stop.
  const tabStopId =
    [focusedId, selectedId].find(
      (id) => id !== undefined && filteredItems.some((n) => n.id === id && isNavigable(n)),
    ) ?? filteredItems.find(isNavigable)?.id;

  // Mark read on open when selecting or when first enabled item loads on desktop
  useEffect(() => {
    if (
      fixed &&
      !mobile &&
      filteredItems.length > 0 &&
      (!selectedId || !filteredItems.some((n) => n.id === selectedId))
    ) {
      const first = filteredItems.find(isNavigable);
      if (first) {
        setSelectedId(first.id);
        if (!first.readAt) {
          void markRead(first.id).catch(() => setActionError(true));
        }
      }
    }
  }, [fixed, mobile, filteredItems, selectedId, markRead]);

  const selectNotification = useCallback(
    (n: Notification, options?: { deferRead?: boolean }) => {
      setSelectedId(n.id);
      if (!n.readAt) {
        if (options?.deferRead) {
          markReadDebounced(n.id);
        } else {
          clearReadTimer();
          void markRead(n.id).catch(() => setActionError(true));
        }
      }
      if (typeof window !== 'undefined' && window.matchMedia('(width < 768px)').matches) {
        const path = notificationPath(n);
        if (path) {
          onNavigate();
          navigate(path);
        }
      }
    },
    [clearReadTimer, markRead, markReadDebounced, onNavigate, navigate],
  );

  const selectedNotification = filteredItems.find((n) => n.id === selectedId) ?? null;

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
        if (e.key === 'Escape') {
          onClose();
          return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        // Enter uses the focused button's native click, including detail and action buttons.
        const target = e.target as HTMLElement;
        let currentIndex: number;
        if (target === panel.current) {
          // Focus is on the panel itself: ArrowDown enters the list, ArrowUp enters from the end.
          currentIndex = e.key === 'ArrowDown' ? -1 : filteredItems.length;
        } else {
          if (!target.matches('button[data-notification-id]')) return;
          currentIndex = filteredItems.findIndex((n) => n.id === target.dataset.notificationId);
          if (currentIndex === -1) return;
        }
        const step = e.key === 'ArrowDown' ? 1 : -1;
        let nextIndex: number | null = null;
        for (let i = currentIndex + step; i >= 0 && i < filteredItems.length; i += step) {
          const candidate = filteredItems[i];
          if (candidate && isNavigable(candidate)) {
            nextIndex = i;
            break;
          }
        }
        const nextItem = nextIndex === null ? undefined : filteredItems[nextIndex];
        if (nextItem) {
          setFocusedId(nextItem.id);
          const buttons =
            panel.current?.querySelectorAll<HTMLButtonElement>('[data-notification-id]');
          const el = [...(buttons ?? [])].find(
            (button) => button.dataset.notificationId === nextItem.id,
          );
          el?.focus();
          el?.scrollIntoView({ block: 'nearest' });
          if (fixed && !mobile) selectNotification(nextItem, { deferRead: true });
        }
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="notifications__list-pane">
        <header className="notifications__head">
          <h2 id="notifications-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('nav.inbox')}
            {unread > 0 && (
              // The bell's label carries the count: the dialog is named "Inbox" alone.
              <span
                aria-hidden="true"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 'var(--ink-radius-full)',
                  background: 'var(--ink-accent-primary)',
                  color: 'var(--ink-on-accent)',
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
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'tasks'}
              className={`notifications-filter-tab ${filter === 'tasks' ? 'is-active' : ''}`}
              onClick={() => setFilter('tasks')}
            >
              {t('tasks.title')}
            </button>
          </div>
        )}
        {fixed && filter !== 'all' && filter !== 'tasks' && next && (
          <p className="notifications__helper">{t('notifications.loadedOnly')}</p>
        )}
        <div className="notifications__list-container">
          {filter === 'tasks' ? <MyTasks /> : <>
          {state === 'ready' && filteredItems.length === 0 && (
            <p className="notifications__empty">{t('notifications.empty')}</p>
          )}
          {groups.map(([day, list]) => (
            <section key={day} aria-label={day}>
              <h3 className="notifications__day">{day}</h3>
              <ul className="notifications__list">
                {list.map((n) => {
                  const path = notificationPath(n);
                  const actor = notificationActor(n, t);
                  const isSelected = n.id === selectedId;
                  return (
                    <li
                      key={n.id}
                      className={`notification ${n.readAt ? '' : 'is-unread'} ${
                        isSelected ? 'is-selected' : ''
                      }`}
                    >
                      <button
                        type="button"
                        data-notification-id={n.id}
                        tabIndex={n.id === tabStopId ? 0 : -1}
                        aria-current={isSelected ? 'true' : undefined}
                        onFocus={() => setFocusedId(n.id)}
                        className="notification__open notification__open--drawer"
                        disabled={!path}
                        onClick={async () => {
                          setActionError(false);
                          selectNotification(n);
                          if (!fixed && path) {
                            onNavigate();
                            navigate(path);
                          }
                        }}
                      >
                        {(!n.readAt || (fixed && isSelected)) && (
                          <span className="notification__bar" />
                        )}
                        <span className="notification__av" style={{ background: avatarBg(actor) }}>
                          {initials(actor)}
                        </span>
                        <div className="notification__body">
                          <span className="notification__line">
                            {actor && <b>{actor} </b>}
                            {describeNotification(n, t, { locale: i18n.language })}
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
                        {!n.readAt && (
                          <span className="notification__dot" style={{ flex: 'none' }} />
                        )}
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
          </>}
        </div>
        {onOpenInbox && (
          <footer className="notifications__foot">
            <button type="button" className="review-link" onClick={onOpenInbox}>
              {t('notifications.openInbox')}
            </button>
          </footer>
        )}
      </div>
      {fixed && !mobile && filter !== 'tasks' && (
        <InboxDetail
          notification={selectedNotification}
          onNavigate={onNavigate}
          onCount={onCount}
        />
      )}
    </div>
  );
}

/** Settings → Account: how often notifications arrive by email. */
export function EmailNotifications() {
  const { t } = useTranslation();
  const [email, setEmail] = useState<NotificationPreferences['email'] | null>(null);
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

  async function choose(value: NotificationPreferences['email']) {
    const previous = email;
    setEmail(value);
    try {
      await trackSave(api.patch('/me/notification-preferences', { email: value }));
    } catch {
      setEmail(previous);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="email-notifications-title">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <h2 id="email-notifications-title">{t('notifications.emailTitle')}</h2>
        </div>
        <p>{t('notifications.emailHint')}</p>
      </header>
      <div className="settings-card__pad">
        {loadError ? (
          <p role="alert">{t('notifications.preferencesError')}</p>
        ) : (
          <div
            role="radiogroup"
            aria-label={t('notifications.emailLabel')}
            className="notification-frequency"
            aria-disabled={email === null}
          >
            {(['immediate', 'daily', 'off'] as const).map((value) => (
              <label key={value} className={email === value ? 'is-on' : undefined}>
                <Radio
                  name="email-frequency"
                  value={value}
                  checked={email === value}
                  onChange={() => void choose(value)}
                />
                <span>
                  <strong>{t(`settingsUi.notifications.short.${value}`)}</strong>
                  <span>{t(`settingsUi.notifications.help.${value}`)}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
