import type { TodoItem } from '@inkadra/doc-schema';
import type { z } from 'zod';
import type { Person, ProjectMember } from '@inkadra/shared';
import { updateTodoItem } from '@inkadra/canvas-core';
import { Avatar, DateField } from '@inkadra/ui';
import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { PeoplePicker } from '../people/PeoplePicker.tsx';
import { localDate } from '../routes/home-data.ts';
import { GuestModeContext, useBoard } from './context.ts';
import { LOCAL } from './store.ts';
import './todo-assignment.css';

export function TodoAssignment({ elementId, item, editing, open, onClose }: {
  elementId: string; item: z.infer<typeof TodoItem>; editing: boolean; open: boolean; onClose: () => void;
}) {
  const { store, projectId, readOnly } = useBoard();
  const guest = useContext(GuestModeContext);
  const { t, i18n } = useTranslation();
  const [people, setPeople] = useState<Person[]>([]);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (guest) return;
    let alive = true;
    api.get<{ items: ProjectMember[] }>(`/projects/${projectId}/members`).then(r => {
      if (alive) setPeople(r.items.map(m => m.user));
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [projectId, guest]);
  if (guest) return null;
  const person = people.find(p => p.id === item.assigneeId);
  const today = localDate(new Date());
  const tone = !item.done && item.dueDate ? item.dueDate < today ? 'danger' : item.dueDate === today ? 'warning' : '' : '';
  const change = (patch: Parameters<typeof updateTodoItem>[3]) => updateTodoItem(store.doc, elementId, item.id, patch, LOCAL);
  return <div className={`todo-assignment ${tone ? `todo-assignment--${tone}` : ''}`} data-no-drag>
    {(item.assigneeId || editing) && <button type="button" className="todo-assignment__chip" disabled={readOnly} onClick={() => setPicking(v => !v)} aria-label={t('tasks.assignee')}>
      {person && <Avatar name={person.name} image={person.image} size={14} />}
      {person ? `@${person.name}` : t('tasks.assignee')}
    </button>}
    {editing && !readOnly ? <DateField label={t('tasks.dueDate')} aria-label={t('tasks.dueDate')} value={item.dueDate ?? ''} clearLabel={t('tasks.clearDate')} onChange={value => change({ dueDate: value || null })} /> : item.dueDate && <span className="todo-assignment__chip">{item.dueDate === today ? t('tasks.today') : new Date(`${item.dueDate}T00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}</span>}
    {(picking || open) && !readOnly && <div className="todo-assignment__picker">
      <PeoplePicker people={people} value={query} onChange={setQuery} aria-label={t('tasks.assignee')} inputClassName="ink-input" onPick={p => { change({ assigneeId: p.id }); setPicking(false); setQuery(''); onClose(); }} />
      {failed && <p role="alert">{t('home.loadError')}</p>}
      <button type="button" className="home__more" onClick={() => { change({ assigneeId: null }); setPicking(false); onClose(); }}>{t('tasks.unassign')}</button>
    </div>}
  </div>;
}
