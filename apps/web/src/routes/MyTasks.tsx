import { type MyTask, notificationPath, type Project } from '@inkadra/shared';
import { ListRow, ProjectGlyph } from '@inkadra/ui';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { formatDateTime } from '../lib/datetime.ts';
import { localDate } from './home-data.ts';
import { useProjects } from './projects-context.ts';

export const TASK_GROUPS = ['overdue', 'today', 'week', 'later', 'undated'] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

export function taskGroup(dueDate: string | undefined, now: Date): TaskGroup {
  const today = localDate(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  if (!dueDate) return 'undated';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  if (dueDate <= localDate(end)) return 'week';
  return 'later';
}

/** Tasks due from today to a week from now: the Home's summary line counts them. */
export function dueThisWeek(items: MyTask[], now: Date): number {
  return items.filter((item) => ['today', 'week'].includes(taskGroup(item.dueDate, now))).length;
}

/** The due label of a row: a weekday within the week, a date further on or already past. */
export function dueLabel(
  dueDate: string | undefined,
  now: Date,
  locale: string,
  t: (key: string, values?: Record<string, string>) => string,
): string | null {
  if (!dueDate) return null;
  const group = taskGroup(dueDate, now);
  const date = formatDateTime(
    `${dueDate}T12:00:00`,
    group === 'week' ? { weekday: 'long' } : { day: 'numeric', month: 'short' },
    undefined,
    locale,
  );
  if (group === 'today') return t('tasks.due.today');
  if (group === 'overdue') return t('tasks.due.late', { date });
  return t('tasks.due.by', { date });
}

export type TaskList = { items: MyTask[] | null; error: boolean };

/** The person's open tasks, loaded again when the window gets the focus back. */
export function useMyTasks(): TaskList {
  const [items, setItems] = useState<MyTask[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<{ items: MyTask[] }>('/me/tasks')
        .then((r) => {
          if (alive) {
            setItems(r.items);
            setError(false);
          }
        })
        .catch(() => {
          if (alive) setError(true);
        });
    void load();
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener('focus', load);
    };
  }, []);
  return { items, error };
}

/** The Inbox's Tasks tab: the same rows as the Home, loaded on their own. */
export function MyTasksTab({ onNavigate }: { onNavigate?: () => void }) {
  const list = useMyTasks();
  return <MyTasks list={list} onNavigate={onNavigate} />;
}

/**
 * Tasks grouped by due date, each a row with the project and the due label. On the Home it is a
 * section with a title and `action`; in the Inbox the tab names it.
 */
export function MyTasks({
  list: { items, error },
  onNavigate,
  title,
  action,
  max,
}: {
  list: TaskList;
  onNavigate?: () => void;
  /** With a title it is a section of its own (the Home). */
  title?: string;
  action?: ReactNode;
  /** At most this many rows; the action leads to the rest. */
  max?: number;
}) {
  const titleId = useId();
  const { t, i18n } = useTranslation();
  const { projects } = useProjects();
  const now = new Date();
  const shown = max === undefined ? items : items?.slice(0, max);
  const body = error ? (
    <p role="alert" className="ink-muted my-tasks__status">
      {t('home.loadError')}
    </p>
  ) : !shown ? (
    <p role="status" className="ink-muted my-tasks__status">
      {t('tasks.loading')}
    </p>
  ) : !shown.length ? (
    <p className="ink-muted my-tasks__status">{t('tasks.empty')}</p>
  ) : (
    TASK_GROUPS.map((group) => {
      const rows = shown.filter((item) => taskGroup(item.dueDate, now) === group);
      return (
        rows.length > 0 && (
          <div key={group} className={`my-tasks__group my-tasks__group--${group}`}>
            <h3 className="ink-row-group">{t(`tasks.${group}`)}</h3>
            {rows.map((item) => (
              <TaskRow
                key={`${item.boardId}:${item.itemId}`}
                item={item}
                project={projects?.find((p) => p.id === item.projectId)}
                due={dueLabel(item.dueDate, now, i18n.language, t)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )
      );
    })
  );
  if (!title) return <div className="my-tasks">{body}</div>;
  return (
    <section className="home__section my-tasks" aria-labelledby={titleId} data-tour="home-tasks">
      <div className="home__section-head">
        <h2 id={titleId} className="ink-section-title">
          {title}
        </h2>
        {items && items.length > 0 && (
          <span className="ink-muted home__hint">{t('tasks.open', { count: items.length })}</span>
        )}
        {action && <span className="home__section-action">{action}</span>}
      </div>
      <div className="home__box">{body}</div>
    </section>
  );
}

function TaskRow({
  item,
  project,
  due,
  onNavigate,
}: {
  item: MyTask;
  project?: Project;
  due: string | null;
  onNavigate?: () => void;
}) {
  return (
    <Link
      className="ink-row my-tasks__row"
      onClick={onNavigate}
      to={notificationPath({ ...item, commentId: null }) ?? '/'}
    >
      <ListRow
        // Ticking a task happens on its card: the box only marks the row as a task.
        lead={<span className="ink-row__check" aria-hidden="true" />}
        title={<span data-feedback-secret>{item.text}</span>}
        where={
          <>
            {project && <ProjectGlyph {...project.icon} />}
            <span data-feedback-secret>{item.projectName}</span>
          </>
        }
        trail={due && <span className="my-tasks__due">{due}</span>}
      />
    </Link>
  );
}
