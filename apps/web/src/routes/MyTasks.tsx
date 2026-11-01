import type { MyTask } from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { notificationPath } from '../notifications/model.ts';
import { localDate } from './home-data.ts';

export function taskGroup(dueDate: string | undefined, now: Date): string {
  const today = localDate(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  if (!dueDate) return 'undated';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  if (dueDate <= localDate(end)) return 'week';
  return 'later';
}

export function MyTasks() {
  const { t } = useTranslation();
  const [items, setItems] = useState<MyTask[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.get<{ items: MyTask[] }>('/me/tasks').then(r => {
      if (alive) { setItems(r.items); setError(false); }
    }).catch(() => { if (alive) setError(true); });
    void load();
    window.addEventListener('focus', load);
    return () => { alive = false; window.removeEventListener('focus', load); };
  }, []);
  return <section className="home__section" aria-labelledby="my-tasks-title">
    <h2 id="my-tasks-title">{t('tasks.title')}</h2>
    {error ? <p role="alert">{t('home.loadError')}</p> : !items ? <p className="ink-muted">{t('tasks.loading')}</p> : !items.length ? <p className="ink-muted">{t('tasks.empty')}</p> : ['overdue', 'today', 'week', 'later', 'undated'].map(group => {
      const rows = items.filter(item => taskGroup(item.dueDate, new Date()) === group);
      return rows.length > 0 && <div key={group} className={`my-tasks__group my-tasks__group--${group}`}>
        <h3 className="ink-label">{t(`tasks.${group}`)}</h3>
        {rows.map(item => <Link key={`${item.boardId}:${item.itemId}`} className="my-tasks__row" to={notificationPath({ ...item, commentId: null }) ?? '/'}>
          <span aria-hidden="true">☐</span><span>{item.text}</span><span className="ink-muted">{item.projectName}</span>
        </Link>)}
      </div>;
    })}
  </section>;
}
