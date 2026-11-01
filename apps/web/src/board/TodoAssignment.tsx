import { updateTodoItem } from '@inkadra/canvas-core';
import type { TodoItem } from '@inkadra/doc-schema';
import type { Person } from '@inkadra/shared';
import { Avatar, DateField } from '@inkadra/ui';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { PeoplePicker } from '../people/PeoplePicker.tsx';
import { localDate } from '../routes/home-data.ts';
import { GuestModeContext, useBoard } from './context.ts';
import { LOCAL } from './store.ts';
import './todo-assignment.css';

export function TodoAssignment({
  elementId,
  item,
  editing,
  open,
  onClose, people, failed,
}: {
  people: Person[]; failed: boolean;
  elementId: string;
  item: z.infer<typeof TodoItem>;
  editing: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { store, readOnly } = useBoard();
  const guest = useContext(GuestModeContext);
  const { t, i18n } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [dating, setDating] = useState(false);
  const [query, setQuery] = useState('');
  if (guest) return null;
  const person = people.find((p) => p.id === item.assigneeId);
  const today = localDate(new Date());
  const tone =
    !item.done && item.dueDate
      ? item.dueDate < today
        ? 'danger'
        : item.dueDate === today
          ? 'warning'
          : ''
      : '';
  const change = (patch: Parameters<typeof updateTodoItem>[3]) =>
    updateTodoItem(store.doc, elementId, item.id, patch, LOCAL);
  return (
    <div className={`todo-assignment ${tone ? `todo-assignment--${tone}` : ''}`} data-no-drag>
      {(item.assigneeId || editing) && (
        <button
          type="button"
          className="todo-assignment__chip"
          disabled={readOnly}
          onClick={() => setPicking((v) => !v)}
          aria-label={t('tasks.assignee')}
        >
          {person && <Avatar name={person.name} image={person.image} size={14} />}
          {person ? `@${person.name}` : t('tasks.assignee')}
        </button>
      )}
      {(editing || dating) && !readOnly ? (
        <DateField
          label={t('tasks.dueDate')}
          aria-label={t('tasks.dueDate')}
          value={item.dueDate ?? ''}
          clearLabel={t('tasks.clearDate')}
          onChange={(value) => { change({ dueDate: value || null }); setDating(false); }}
        />
      ) : (
        item.dueDate && (
          <button type="button" disabled={readOnly} className="todo-assignment__chip" onClick={() => setDating(true)}>
            {item.dueDate === today
              ? t('tasks.today')
              : new Date(`${item.dueDate}T00:00`).toLocaleDateString(i18n.language, {
                  day: 'numeric',
                  month: 'short',
                })}
          </button>
        )
      )}
      {(picking || open) && !readOnly && (
        <div className="todo-assignment__picker">
          <PeoplePicker
            people={people}
            // biome-ignore lint/a11y/noAutofocus: explicitly opened by @ or the assignee chip.
            autoFocus
            onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setPicking(false); onClose(); } }}
            value={query}
            onChange={setQuery}
            aria-label={t('tasks.assignee')}
            inputClassName="ink-input"
            onPick={(p) => {
              change({ assigneeId: p.id });
              setPicking(false);
              setQuery('');
              onClose();
            }}
          />
          {failed && <p role="alert">{t('home.loadError')}</p>}
          <button
            type="button"
            className="home__more"
            onClick={() => {
              change({ assigneeId: null });
              setPicking(false);
              onClose();
            }}
          >
            {t('tasks.unassign')}
          </button>
        </div>
      )}
    </div>
  );
}
