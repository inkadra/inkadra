// SPDX-License-Identifier: AGPL-3.0-only
import type { SceneElement } from '@inkadra/canvas-core';
import { TODO_LISTS, type TodoList } from '@inkadra/doc-schema';
import type { Person } from '@inkadra/shared';
import { Avatar, Checkbox, Segmented } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import { type CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PeoplePicker } from '../../people/PeoplePicker.tsx';
import type { NeededRow } from './needed.ts';
import { sceneName } from './storyboard-data.ts';
import './needed.css';

/** The coloured label of a kind of list, on the to-do card, the menu and the day. */
export function NeededKind({ list }: { list: TodoList }) {
  const { t } = useTranslation();
  return (
    <span className={`needed-kind needed-kind--${list}`}>{t(`board.todo.lists.${list}`)}</span>
  );
}

/** "Sc. 3 · La salita". */
export function sceneLabel(scene: SceneElement, t: TFunction): string {
  return [t('needed.sceneNumber', { number: scene.number || '—' }), sceneName(scene)]
    .filter(Boolean)
    .join(' · ');
}

const firstName = (person: Person | undefined) => person?.name.trim().split(/\s+/)[0] ?? '';

/**
 * A shooting day's "Da portare": what the scenes of the day need, by kind of list, with who
 * brings it (decision 0058). Ticking a row ticks the items on the to-do cards.
 */
export function NeededItems({
  rows,
  people,
  userId,
  readOnly,
  phone,
  onChange,
}: {
  rows: NeededRow[];
  people: Person[];
  userId: string | undefined;
  readOnly: boolean;
  phone: boolean;
  onChange: (row: NeededRow, patch: { done?: boolean; assigneeId?: string | null }) => void;
}) {
  const { t } = useTranslation();
  const [mine, setMine] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  if (!rows.length) return <p className="schedule__hint">{t('needed.empty')}</p>;
  const ready = rows.filter((row) => row.done).length;
  const shown = mine ? rows.filter((row) => userId && row.assigneeId === userId) : rows;
  const personOf = (row: NeededRow) => people.find((p) => p.id === row.assigneeId);
  const scenes = (row: NeededRow) =>
    t('needed.scenes', { scenes: row.scenes.join(phone ? ', ' : ' · ') });
  const who = (row: NeededRow) => {
    const person = personOf(row);
    const name = firstName(person);
    if (readOnly)
      return <span className={`needed__who${person ? '' : ' is-none'}`}>{name || '—'}</span>;
    return (
      <button
        type="button"
        className={`needed__who${person ? '' : ' is-none'}`}
        aria-label={person ? t('needed.changeWho', { name: person.name }) : t('needed.who')}
        aria-expanded={picking === row.key}
        onClick={() => setPicking((open) => (open === row.key ? null : row.key))}
      >
        {person ? (
          <>
            <Avatar name={person.name} image={person.image} size={18} />
            {!phone && name}
          </>
        ) : (
          <>
            <span className="needed__plus" aria-hidden="true">
              +
            </span>
            {!phone && t('needed.who')}
          </>
        )}
      </button>
    );
  };
  return (
    <div className={`needed${phone ? ' needed--phone' : ''}`}>
      <div className="needed__progress">
        <span>{t('needed.progress', { ready, total: rows.length })}</span>
        <span
          className="needed__bar"
          role="progressbar"
          aria-label={t('needed.title')}
          aria-valuemin={0}
          aria-valuemax={rows.length}
          aria-valuenow={ready}
        >
          <i style={{ '--needed-ready': ready / rows.length } as CSSProperties} />
        </span>
        {!phone && (
          <button
            type="button"
            className="needed__mine"
            aria-pressed={mine}
            onClick={() => setMine((v) => !v)}
          >
            {t('needed.mine')}
          </button>
        )}
      </div>
      {phone && (
        <Segmented
          className="needed__filter"
          label={t('needed.filter')}
          value={mine ? 'mine' : 'all'}
          onChange={(value) => setMine(value === 'mine')}
          options={[
            { value: 'all', label: t('needed.all') },
            { value: 'mine', label: t('needed.mine') },
          ]}
        />
      )}
      {mine && !shown.length && <p className="schedule__hint">{t('needed.emptyMine')}</p>}
      {TODO_LISTS.map((list) => {
        const items = shown.filter((row) => row.list === list);
        if (!items.length) return null;
        return (
          <section key={list} className="needed__group">
            <h4 className="needed__group-title">
              <NeededKind list={list} />
              {items.length}
            </h4>
            <ul>
              {items.map((row) => (
                <li key={row.key} className={row.done ? 'is-done' : undefined}>
                  <div className="needed__row">
                    <Checkbox
                      checked={row.done}
                      disabled={readOnly}
                      aria-label={row.text}
                      onChange={(e) => onChange(row, { done: e.target.checked })}
                    />
                    <span className="needed__name">
                      {row.text}
                      {row.count > 1 && <small>×{row.count}</small>}
                      {phone && (
                        <small className="needed__meta">
                          {scenes(row)} · {firstName(personOf(row)) || t('needed.nobody')}
                        </small>
                      )}
                    </span>
                    {!phone && <span className="needed__scenes">{scenes(row)}</span>}
                    {(!phone || !row.assigneeId || picking === row.key) && who(row)}
                  </div>
                  {picking === row.key && !readOnly && (
                    <div className="needed__picker">
                      <PeoplePicker
                        people={people}
                        // biome-ignore lint/a11y/noAutofocus: opened by the "who brings" button.
                        autoFocus
                        value={query}
                        onChange={setQuery}
                        aria-label={t('needed.who')}
                        inputClassName="ink-input"
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.stopPropagation();
                            setPicking(null);
                          }
                        }}
                        onPick={(person) => {
                          onChange(row, { assigneeId: person.id });
                          setPicking(null);
                          setQuery('');
                        }}
                      />
                      {row.assigneeId && (
                        <button
                          type="button"
                          className="home__more"
                          onClick={() => {
                            onChange(row, { assigneeId: null });
                            setPicking(null);
                          }}
                        >
                          {t('tasks.unassign')}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
