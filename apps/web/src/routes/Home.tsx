import type { Notification, PlannedShootingDay, Project, RecentBoard } from '@inkadra/shared';
import { Avatar, Icon, kindStyle, ProjectGlyph } from '@inkadra/ui';
import { type MouseEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { notificationPath } from '../notifications/model.ts';
import {
  avatarBg,
  describeNotification,
  notificationActor,
  relativeTime,
} from '../notifications/Notifications.tsx';
import { useProjects } from './AppLayout.tsx';
import { BoardPreview } from './BoardPreview.tsx';
import {
  type Loadable,
  localDate,
  RECENT_BOARDS,
  useActivity,
  useRecentBoards,
  useShootingDays,
} from './home-data.ts';
import { PROJECT_TEMPLATES, TEMPLATE_ICONS } from './project-setup.ts';
import './home.css';

function greetingKey(hour: number) {
  if (hour < 13) return 'home.greeting.morning';
  if (hour < 18) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

export function Home() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { projects, shared, openNewProject, canCreateProjects, openInbox, unread, refreshUnread } =
    useProjects();
  const navigate = useNavigate();
  const now = new Date();
  const firstName = user?.name.split(' ')[0] ?? '';
  const today = useShootingDays(localDate(now));
  const recent = useRecentBoards();
  const activity = useActivity(now);
  const days = today.state === 'ready' ? today.items : [];
  // Several days on the same date would stretch the card: show the first, the rest on request.
  const [allDays, setAllDays] = useState(false);
  const shownDays = allDays ? days : days.slice(0, 1);
  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    navigate(to);
  };
  const rootOf = (projectId: string) => projects?.find((p) => p.id === projectId)?.rootBoardId;
  const boardHref = (projectId: string, boardId: string) =>
    boardId === rootOf(projectId) ? `/p/${projectId}` : `/p/${projectId}/b/${boardId}`;

  const boards =
    recent.state === 'ready' ? { ...recent, items: recent.items.slice(0, RECENT_BOARDS) } : recent;

  const summary = [
    now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }),
  ];
  const first = days[0];
  if (first)
    summary.push(
      first.location.trim()
        ? t('home.summary.shootingAt', { location: first.location.trim(), time: first.callTime })
        : t('home.summary.shooting', { time: first.callTime }),
    );
  if (unread > 0) summary.push(t('home.summary.unread', { count: unread }));

  return (
    <div className="home">
      <header className="home__head">
        <div className="home__title">
          <h1>{t(greetingKey(now.getHours()), { name: firstName })}</h1>
          <p className="ink-muted">
            {summary.map((part, index) => (
              <span key={part} className={first && index === 1 ? 'home__shooting' : undefined}>
                {index > 0 && ' · '}
                {part}
              </span>
            ))}
          </p>
        </div>

        {(days.length > 0 || today.state === 'error') && (
          <section className="ink-card home__today" aria-labelledby="home-today">
            <h2 id="home-today" className="ink-label home__today-chip">
              {t('home.today.title')}
            </h2>
            {/* Without the card a failed load would read as no shoot today. */}
            {today.state === 'error' && (
              <p role="alert" className="ink-muted home__status">
                {t('home.loadError')}
              </p>
            )}
            {shownDays.map((d) => (
              <TodayDay
                key={d.id}
                day={d}
                href={`${boardHref(d.projectId, d.boardId)}?view=schedule`}
                go={go}
              />
            ))}
            {days.length > 1 && (
              <button
                type="button"
                className="home__more"
                aria-expanded={allDays}
                onClick={() => setAllDays((v) => !v)}
              >
                {allDays
                  ? t('home.today.fewerDays')
                  : t('home.today.moreDays', { count: days.length - 1 })}
              </button>
            )}
          </section>
        )}
      </header>
      <Section
        id="home-recent"
        title={t('home.recentBoards')}
        action={
          // Guests with shared boards only have no projects page to go to.
          projects && projects.length > 0 ? (
            <a className="home__more" href="/projects" onClick={go('/projects')}>
              {t('home.allProjects')}
            </a>
          ) : undefined
        }
        hint={t('home.recentBoardsHint')}
      >
        <LoadState list={boards} empty={t('home.noRecentBoards')}>
          {(items) => (
            <div className="home__boards">
              {items.map((b) => (
                <BoardCard
                  key={b.id}
                  board={b}
                  project={projects?.find((p) => p.id === b.projectId)}
                  href={boardHref(b.projectId, b.id)}
                  go={go}
                />
              ))}
            </div>
          )}
        </LoadState>
      </Section>

      <Section
        id="home-activity"
        title={t('home.activity.title')}
        hint={t('home.activity.hint')}
        action={
          <button type="button" className="home__more" onClick={openInbox}>
            {t('home.activity.openInbox')}
          </button>
        }
      >
        <LoadState list={activity} empty={t('home.activity.empty')}>
          {(items) => (
            <ul className="home__activity">
              {items.map((n) => (
                <ActivityItem key={n.id} item={n} onRead={refreshUnread} />
              ))}
            </ul>
          )}
        </LoadState>
      </Section>
      {shared && shared.length > 0 && (
        <Section id="home-shared" title={t('home.shared')}>
          <div className="home__recent">
            {shared.map((b) => (
              <a
                key={b.id}
                href={`/p/${b.projectId}/b/${b.id}`}
                className="ink-card home__card"
                onClick={go(`/p/${b.projectId}/b/${b.id}`)}
              >
                <BoardPreview boardId={b.id} />
                <span className="home__meta">
                  <span className="home__name">{b.title}</span>
                  <span className="ink-muted home__when">{t(`roles.${b.myRole}`)}</span>
                </span>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Templates create projects: not offered to people who cannot (decision 0041). */}
      {canCreateProjects && (
        <Section id="home-templates" title={t('home.templates.title')}>
          <div className="home__templates">
            {PROJECT_TEMPLATES.map((c) => (
              <button
                key={c}
                type="button"
                className="ink-card home__template"
                // The same templates and form as New project and the guided setup.
                onClick={() => openNewProject(c)}
              >
                <span
                  className="home__template-icon"
                  data-kind={c}
                  style={kindStyle(c)}
                  aria-hidden="true"
                >
                  <Icon name={TEMPLATE_ICONS[c]} size={16} />
                </span>
                <span className="home__name">{t(`onboarding.templates.${c}.name`)}</span>
                <span className="ink-muted home__when">{t(`onboarding.templates.${c}.body`)}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  id,
  title,
  hint,
  action,
  children,
}: {
  id: string;
  title: ReactNode;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="home__section" aria-labelledby={id}>
      <div className="home__section-head">
        <h2 id={id} className="ink-label">
          {title}
        </h2>
        {hint && <span className="ink-muted home__hint">{hint}</span>}
        {action && <span className="home__section-action">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** A section's list, or its loading, error and empty states; never placeholder items. */
function LoadState<T>({
  list,
  empty,
  children,
}: {
  list: Loadable<T>;
  empty: string;
  children: (items: T[]) => ReactNode;
}) {
  const { t } = useTranslation();
  if (list.state === 'loading')
    return (
      <p role="status" className="ink-muted home__status">
        {t('comments.loading')}
      </p>
    );
  if (list.state === 'error')
    return (
      <p role="alert" className="ink-muted home__status">
        {t('home.loadError')}
      </p>
    );
  if (list.items.length === 0) return <p className="ink-muted home__status">{empty}</p>;
  return children(list.items);
}

function TodayDay({
  day,
  href,
  go,
}: {
  day: PlannedShootingDay;
  href: string;
  go: (to: string) => (e: MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const facts: Array<[string, string]> = [[t('home.today.call'), day.callTime]];
  if (day.location.trim()) facts.push([t('home.today.location'), day.location.trim()]);
  if (day.wrap) facts.push([t('home.today.wrap'), day.wrap]);
  return (
    <div className="home__day">
      <div className="home__day-where">
        <span className="home__name">{day.projectName}</span>
        <span className="ink-muted">{day.boardTitle}</span>
      </div>
      <dl className="home__facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="ink-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <a className="ink-btn ink-btn--secondary home__day-open" href={href} onClick={go(href)}>
        {t('home.today.openSchedule')}
      </a>
    </div>
  );
}

function BoardCard({
  board,
  project,
  href,
  go,
}: {
  board: RecentBoard;
  project?: Project;
  href: string;
  go: (to: string) => (e: MouseEvent) => void;
}) {
  const { t, i18n } = useTranslation();
  const labelId = useId();
  const kindId = useId();
  const descriptionId = useId();
  return (
    <a
      href={href}
      className="ink-card home__card"
      aria-labelledby={labelId}
      aria-describedby={`${kindId} ${descriptionId}`}
      onClick={go(href)}
    >
      <BoardPreview boardId={board.id} project={project} />
      <span className="home__meta">
        <span
          id={kindId}
          className="home__kind"
          data-kind={board.kind}
          style={kindStyle(board.kind)}
        >
          {t(`board.types.${board.kind}`)}
        </span>
        <span id={labelId} className="home__name">
          {board.title}
        </span>
        <span id={descriptionId} className="ink-muted home__when">
          {project && <ProjectGlyph {...project.icon} />}
          {board.projectName} · {relativeTime(board.editedAt, i18n.language)}
        </span>
      </span>
    </a>
  );
}

function ActivityItem({ item, onRead }: { item: Notification; onRead: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const navigate = useNavigate();
  const path = notificationPath(item);
  const actor = notificationActor(item, t);
  const where = [...new Set([item.projectName, item.boardTitle])].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="home__avatar" style={{ background: avatarBg(actor) }}>
        <Avatar name={actor ?? 'Inkadra'} size={24} />
      </span>
      <span className="home__activity-body">
        <span className={item.reviewStatus === 'approved' ? 'home__approved' : undefined}>
          {actor && <b>{actor} </b>}
          {describeNotification(item, t, { id: user?.id, locale: i18n.language })}
        </span>
        <span className="ink-muted home__when">
          {where && `${where} · `}
          <time dateTime={item.createdAt}>{relativeTime(item.createdAt, i18n.language)}</time>
        </span>
      </span>
      {!item.readAt && (
        <span className="home__unread">
          <span className="home__sr">{t('notifications.unread')}</span>
        </span>
      )}
    </>
  );
  return (
    <li className={item.readAt ? undefined : 'is-unread'}>
      {path ? (
        <a
          href={path}
          className="home__activity-item"
          onClick={(e) => {
            e.preventDefault();
            // As in the inbox: opening it reads it.
            if (!item.readAt)
              void api
                .post(`/me/notifications/${item.id}/read`, {})
                .then(onRead)
                .catch(() => {});
            navigate(path);
          }}
        >
          {body}
        </a>
      ) : (
        <span className="home__activity-item">{body}</span>
      )}
    </li>
  );
}
