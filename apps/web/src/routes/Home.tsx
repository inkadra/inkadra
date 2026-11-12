import {
  type Notification,
  notificationPath,
  type PlannedShootingDay,
  type Project,
  type RecentBoard,
  type UnsortedBoard,
} from '@inkadra/shared';
import { Avatar, CoverCard, Icon, kindStyle, ListRow, ProjectGlyph } from '@inkadra/ui';
import { type MouseEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { pickVariant, useAsset } from '../board/assets.ts';
import { api } from '../lib/api.ts';
import { useIsPhone } from '../lib/phone.ts';
import { useSession } from '../lib/session.tsx';
import {
  avatarBg,
  describeNotification,
  notificationActor,
  relativeTime,
} from '../notifications/Notifications.tsx';
import { useProjects } from './AppLayout.tsx';
import { BoardPreview } from './BoardPreview.tsx';
import {
  HOME_TASKS,
  homeProjects,
  type Loadable,
  localDate,
  RECENT_BOARDS,
  useActivity,
  useProjectRows,
  useRecentBoards,
  useShootingDays,
  useUnsorted,
} from './home-data.ts';
import { dueThisWeek, MyTasks, useMyTasks } from './MyTasks.tsx';
import './home.css';

export function greetingKey(hour: number) {
  // After midnight it is still "evening" until the early morning.
  if (hour < 5) return 'home.greeting.evening';
  if (hour < 13) return 'home.greeting.morning';
  if (hour < 18) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

export function Home() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { projects, shared, openInbox, unread, refreshUnread } = useProjects();
  const navigate = useNavigate();
  const now = new Date();
  const firstName = user?.name.split(' ')[0] ?? '';
  const today = useShootingDays(localDate(now));
  const recent = useRecentBoards();
  const activity = useActivity(now);
  const tasks = useMyTasks();
  // Phones get the unsorted cards and a project list here; wider screens have the sidebar.
  const phone = useIsPhone();
  const unsorted = useUnsorted(phone);
  const projectRows = useProjectRows(phone ? homeProjects(projects) : null);
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

  // One line under the greeting: the date, then what waits, as a sentence of the language.
  const date = now.toLocaleDateString(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const first = days[0];
  const waiting: { text: string; shooting?: boolean }[] = [];
  if (first)
    waiting.push({
      text: first.location.trim()
        ? t('home.summary.shootingAt', { location: first.location.trim(), time: first.callTime })
        : t('home.summary.shooting', { time: first.callTime }),
      shooting: true,
    });
  if (unread > 0) waiting.push({ text: t('home.summary.unread', { count: unread }) });
  const due = tasks.items ? dueThisWeek(tasks.items, now) : 0;
  if (due > 0) waiting.push({ text: t('home.summary.dueWeek', { count: due }) });
  const parts = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).formatToParts(
    waiting.map((w, i) => (i === 0 ? w.text.charAt(0).toUpperCase() + w.text.slice(1) : w.text)),
  );
  let element = 0;

  return (
    <div className="home">
      <header className="home__head">
        <div className="home__title">
          <h1 data-feedback-secret>{t(greetingKey(now.getHours()), { name: firstName })}</h1>
          <p className="ink-muted home__summary">
            {date}.{waiting.length > 0 && ' '}
            {parts.map((part, key) => {
              if (part.type === 'literal') return part.value;
              const item = waiting[element++];
              return item?.shooting ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence never move
                <span key={key} className="home__shooting" data-feedback-secret>
                  {part.value}
                </span>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence never move
                <b key={key}>{part.value}</b>
              );
            })}
            {waiting.length > 0 && '.'}
          </p>
        </div>

        {(days.length > 0 || today.state === 'error') && (
          <section
            className="ink-card home__today"
            aria-labelledby="home-today"
            data-feedback-secret
          >
            <h2 id="home-today" className="home__today-chip">
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
      <div className="home__columns">
        <Section
          id="home-recent"
          tour="home-recent"
          title={t('home.recentBoards')}
          action={
            // Guests with shared boards only have no projects page to go to; a phone has the link
            // under its project list instead.
            !phone && projects && projects.length > 0 ? (
              <a className="home__more" href="/projects" onClick={go('/projects')}>
                {t('home.allProjects')}
              </a>
            ) : undefined
          }
          hint={t('home.recentBoardsHint')}
        >
          <LoadState list={boards} empty={t('home.noRecentBoards')}>
            {(items) => (
              <div className="home__boards" data-feedback-secret>
                {items.map((b, index) => (
                  <BoardCard
                    key={b.id}
                    board={b}
                    hero={index === 0}
                    project={projects?.find((p) => p.id === b.projectId)}
                    href={boardHref(b.projectId, b.id)}
                    go={go}
                  />
                ))}
              </div>
            )}
          </LoadState>
        </Section>
        <div className="home__side">
          <MyTasks
            list={tasks}
            title={t('tasks.title')}
            max={HOME_TASKS}
            action={
              <button type="button" className="home__more" onClick={() => openInbox('tasks')}>
                {t('home.seeAll')}
              </button>
            }
          />
          <Section
            id="home-activity"
            tour="home-activity"
            title={t('home.activity.title')}
            hint={t('home.activity.hint')}
            action={
              <button type="button" className="home__more" onClick={() => openInbox()}>
                {t('home.activity.openInbox')}
              </button>
            }
          >
            <div className="home__box">
              <LoadState
                list={activity}
                empty={
                  <>
                    <Icon name="check" size={15} />
                    {t('home.activity.empty')}
                  </>
                }
              >
                {(items) => (
                  <ul className="home__activity">
                    {items.map((n) => (
                      <ActivityItem
                        key={n.id}
                        item={n}
                        project={projects?.find((p) => p.id === n.projectId)}
                        onRead={refreshUnread}
                      />
                    ))}
                  </ul>
                )}
              </LoadState>
            </div>
          </Section>
        </div>
      </div>

      {phone && (
        <>
          <UnsortedCard list={unsorted} boardHref={boardHref} go={go} />
          <Section
            id="home-projects"
            title={t('nav.projects')}
            action={
              projects && projects.length > 0 ? (
                <a className="home__more" href="/projects" onClick={go('/projects')}>
                  {t('home.allProjects')}
                </a>
              ) : undefined
            }
          >
            <LoadState list={projectRows} empty={t('home.noProjects')}>
              {(rows) => (
                <ul className="home__projects" data-feedback-secret>
                  {rows.map((row) => (
                    <li key={row.project.id}>
                      <a
                        className="home__project"
                        href={`/p/${row.project.id}`}
                        onClick={go(`/p/${row.project.id}`)}
                      >
                        <span className="home__project-glyph" aria-hidden="true">
                          <ProjectGlyph {...row.project.icon} />
                        </span>
                        <span className="home__project-text">
                          <span className="home__name">{row.project.name}</span>
                          <span className="ink-muted home__when">
                            {t('projectsPage.boards', { count: row.boards.length })} ·{' '}
                            {relativeTime(row.activity, i18n.language)}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </LoadState>
          </Section>
        </>
      )}

      {shared && shared.length > 0 && (
        <Section id="home-shared" title={t('home.shared')}>
          <div className="home__recent" data-feedback-secret>
            {shared.map((b) => (
              <CoverCard
                key={b.id}
                className="home__card"
                cover={<BoardPreview boardId={b.id} />}
                name={
                  <a
                    className="ink-cover-card__link"
                    href={`/p/${b.projectId}/b/${b.id}`}
                    onClick={go(`/p/${b.projectId}/b/${b.id}`)}
                  >
                    {b.title}
                  </a>
                }
                meta={t(`roles.${b.myRole}`)}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  id,
  tour,
  title,
  hint,
  action,
  children,
}: {
  id: string;
  /** `data-tour` anchor of a tutorial step (#502). */
  tour?: string;
  title: ReactNode;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="home__section" aria-labelledby={id} data-tour={tour}>
      <div className="home__section-head">
        <h2 id={id} className="ink-section-title">
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
  empty: ReactNode;
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
  if (list.items.length === 0) return <p className="ink-muted home__status home__empty">{empty}</p>;
  return children(list.items);
}

/**
 * "Non ordinati" across the boards the person can edit: hidden while loading and when nothing
 * waits, so the Home does not jump; a failed load says so instead of reading as an empty tray.
 */
function UnsortedCard({
  list,
  boardHref,
  go,
}: {
  list: Loadable<UnsortedBoard>;
  boardHref: (projectId: string, boardId: string) => string;
  go: (to: string) => (e: MouseEvent) => void;
}) {
  const { t } = useTranslation();
  if (list.state === 'loading' || (list.state === 'ready' && list.items.length === 0)) return null;
  const items = list.state === 'ready' ? list.items : [];
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const href = (b: UnsortedBoard) => `${boardHref(b.projectId, b.boardId)}?unsorted=open`;
  const first = items[0];
  const head = (
    <>
      <span className="home__unsorted-text">
        <span className="home__name">{t('nav.unsorted')}</span>
        <span className="ink-muted home__when">
          {list.state === 'error'
            ? t('home.loadError')
            : t('home.unsorted.waiting', { count: total })}
        </span>
      </span>
      <span className="home__unsorted-thumbs" aria-hidden="true">
        {items
          .flatMap((b) => b.assetIds)
          .slice(0, 2)
          .map((id) => (
            <Thumb key={id} id={id} />
          ))}
      </span>
    </>
  );
  return (
    <section
      className="ink-card home__unsorted"
      aria-label={t('nav.unsorted')}
      data-feedback-secret
    >
      {first && items.length === 1 ? (
        <a className="home__unsorted-head" href={href(first)} onClick={go(href(first))}>
          {head}
        </a>
      ) : (
        <div className="home__unsorted-head" role={list.state === 'error' ? 'alert' : undefined}>
          {head}
        </div>
      )}
      {items.length > 1 && (
        <ul className="home__unsorted-boards">
          {items.map((b) => (
            <li key={b.boardId}>
              <a href={href(b)} onClick={go(href(b))}>
                <span className="home__unsorted-board">
                  {b.boardTitle}
                  {/* A project's root board carries the project's name. */}
                  {b.boardTitle !== b.projectName && (
                    <span className="ink-muted"> · {b.projectName}</span>
                  )}
                </span>
                <span className="ink-muted">{b.count}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A small square of an unsorted image; nothing while it loads or when it is gone. */
function Thumb({ id }: { id: string }) {
  const asset = useAsset(id);
  const src = asset && asset !== 'missing' ? pickVariant(asset, 128) : '';
  return src ? <img className="home__thumb" src={src} alt="" loading="lazy" /> : null;
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

/** A recent board: the first one large, the next ones small (decision 0124). */
function BoardCard({
  board,
  project,
  hero,
  href,
  go,
}: {
  board: RecentBoard;
  project?: Project;
  hero?: boolean;
  href: string;
  go: (to: string) => (e: MouseEvent) => void;
}) {
  const { t, i18n } = useTranslation();
  const kindId = useId();
  const descriptionId = useId();
  return (
    <CoverCard
      className={hero ? 'home__card home__card--hero' : 'home__card'}
      cover={<BoardPreview boardId={board.id} project={project} />}
      name={
        <>
          <a
            href={href}
            className="ink-cover-card__link"
            aria-describedby={`${kindId} ${descriptionId}`}
            onClick={go(href)}
          >
            {board.title}
          </a>
          <span
            id={kindId}
            className="home__kind"
            data-kind={board.kind}
            style={kindStyle(board.kind)}
          >
            {t(`board.types.${board.kind}`)}
          </span>
        </>
      }
      meta={
        <span id={descriptionId} className="home__where">
          {project && <ProjectGlyph {...project.icon} />}
          <span className="home__where-name">{board.projectName}</span>
          <time dateTime={board.editedAt}>{relativeTime(board.editedAt, i18n.language)}</time>
        </span>
      }
    />
  );
}

function ActivityItem({
  item,
  project,
  onRead,
}: {
  item: Notification;
  project?: Project;
  onRead: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const navigate = useNavigate();
  const path = notificationPath(item);
  const actor = notificationActor(item, t);
  const where = [...new Set([item.projectName, item.boardTitle])].filter(Boolean).join(' / ');
  const body = (
    <ListRow
      lead={
        <>
          <span className={`ink-row__dot${item.readAt ? ' is-read' : ''}`}>
            {!item.readAt && <span className="ink-sr-only">{t('notifications.unread')}</span>}
          </span>
          <span
            className="home__avatar"
            style={{ background: avatarBg(actor) }}
            data-feedback-secret
          >
            <Avatar name={actor ?? 'Inkadra'} size={24} />
          </span>
        </>
      }
      title={
        <span className={item.reviewStatus === 'approved' ? 'home__approved' : undefined}>
          {actor && <b data-feedback-secret>{actor} </b>}
          {describeNotification(item, t, { id: user?.id, locale: i18n.language })}
        </span>
      }
      where={
        where && (
          <>
            {project && <ProjectGlyph {...project.icon} />}
            <span data-feedback-secret>{where}</span>
          </>
        )
      }
      trail={<time dateTime={item.createdAt}>{relativeTime(item.createdAt, i18n.language)}</time>}
    />
  );
  return (
    <li className={item.readAt ? undefined : 'is-unread'}>
      {path ? (
        <a
          href={path}
          className="ink-row home__activity-item"
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
        <span className="ink-row home__activity-item">{body}</span>
      )}
    </li>
  );
}
