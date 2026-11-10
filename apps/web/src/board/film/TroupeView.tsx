// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Crew,
  type CrewCharacter,
  type CrewMember,
  type CrewMemberInput,
  CrewMemberInput as Input,
} from '@inkadra/shared';
import { Avatar, Button, Dialog, DialogActions, EmptyState } from '@inkadra/ui';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../../lib/api.ts';
import { useIsPhone } from '../../lib/phone.ts';
import { PeoplePicker } from '../../people/PeoplePicker.tsx';
import { ContextMenu } from '../chrome.tsx';
import type { BoardStore } from '../store.ts';
import { parseCrewPaste } from './crew-paste.ts';
import { whileVisible } from './schedule.ts';
import './film.css';
import './troupe.css';

export const emptyCrewMember = (name: string, position: number): CrewMemberInput => ({
  name,
  position,
  department: '',
  role: '',
  phone: '',
  email: '',
  pickup: '',
  notes: '',
  userId: null,
  character: null,
  onSetContact: false,
});
const inputOf = ({
  id: _id,
  account: _account,
  projectId: _project,
  revision: _revision,
  createdAt: _created,
  updatedAt: _updated,
  ...input
}: CrewMember): CrewMemberInput => input;

export function TroupeView({
  projectId,
  boardId,
  store,
  readOnly = false,
}: {
  projectId?: string;
  boardId: string;
  store: BoardStore;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const [rows, setRows] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [removeSelected, setRemoveSelected] = useState(false);
  const [query, setQuery] = useState('');
  const [paste, setPaste] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/projects/${projectId}/crew`;
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [otherCharacters, setOtherCharacters] = useState<CrewCharacter[]>([]);
  const characters = [
    ...otherCharacters.filter((c) => c.boardId !== boardId),
    ...[...snap.byId.values()]
      .filter((el) => el.type === 'character')
      .map((el) => ({
        boardId,
        elementId: el.id,
        name: el.name,
        actor: el.actor ?? '',
        contact: el.contact ?? '',
      })),
  ];
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      api
        .get<{ items: CrewCharacter[] }>(`${base}/characters`, controller.signal)
        .then((r) => setOtherCharacters(r.items))
        .catch(() => {});
    void load();
    const stop = whileVisible(() => void load());
    return () => {
      stop();
      controller.abort();
    };
  }, [base]);
  useEffect(() => {
    void refresh;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    api
      .get<Crew>(base, controller.signal)
      .then((r) => {
        setRows(r.items);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [base, refresh]);
  const active = rows.find((r) => r.id === selected);
  const departments = [...new Set(rows.map((r) => r.department))];
  const visible = rows.filter((r) =>
    [r.name, r.role, r.department, r.phone, r.pickup].some((s) =>
      s.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const row = await api.post<CrewMember>(base, emptyCrewMember(name.trim(), rows.length));
      setRows((old) => [...old, row]);
      setSelected(row.id);
      setAdding(false);
      setName('');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const panel = active && (
    <CrewPanel
      key={active.id}
      row={active}
      requestRemove={removeSelected}
      onRemoveHandled={() => setRemoveSelected(false)}
      departments={departments}
      readOnly={readOnly}
      base={base}
      characters={characters}
      onUpdate={(row) => setRows((old) => old.map((r) => (r.id === row.id ? row : r)))}
      onRemove={() => {
        setRows((old) => old.filter((r) => r.id !== active.id));
        setSelected(null);
      }}
    />
  );
  return (
    <section className="story troupe" data-tour="troupe">
      <header className="story__bar troupe__bar">
        <span>
          {t('troupe.people', { count: rows.length })} ·{' '}
          {t('troupe.departments', { count: departments.filter(Boolean).length })}
        </span>
        <input
          className="ink-input"
          type="search"
          aria-label={t('troupe.search')}
          placeholder={t('troupe.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!readOnly && (
          <>
            <Button disabled={loading} onClick={() => setPaste(true)}>
              {t('troupe.paste')}
            </Button>
            <Button variant="primary" disabled={loading} onClick={() => setAdding(true)}>
              {t('troupe.add')}
            </Button>
          </>
        )}
      </header>
      {loading ? (
        <p role="status">{t('troupe.loading')}</p>
      ) : error ? (
        <div role="alert">
          {t('troupe.error')}{' '}
          <Button onClick={() => setRefresh((r) => r + 1)}>{t('troupe.retry')}</Button>
        </div>
      ) : (
        <div className="story__main troupe__main">
          <div className="story__scroll troupe__list">
            {!rows.length && (
              <EmptyState title={t('troupe.empty')}>{t('troupe.emptyHint')}</EmptyState>
            )}
            {!!rows.length && !visible.length && <p>{t('troupe.noResults')}</p>}
            {!!visible.length && (
              <div className="troupe__columns" aria-hidden="true">
                {['name', 'role', 'phoneColumn', 'pickup'].map((key) => (
                  <span key={key}>{t(`troupe.${key}`)}</span>
                ))}
              </div>
            )}
            {departments.map((department) => {
              const members = visible.filter((r) => r.department === department);
              return (
                !!members.length && (
                  <section key={department} aria-label={department || t('troupe.noDepartment')}>
                    <h2 className="troupe__group">
                      {department || t('troupe.noDepartment')} <small>{members.length}</small>
                    </h2>
                    <div className="troupe__rows">
                      {members.map((row) => (
                        <CrewRow
                          key={row.id}
                          row={row}
                          selected={row.id === selected}
                          readOnly={readOnly}
                          onOpen={(remove = false) => {
                            setRemoveSelected(remove);
                            setSelected(row.id);
                          }}
                        />
                      ))}
                    </div>
                  </section>
                )
              );
            })}
          </div>
          {panel &&
            (phone ? (
              <div className="phone-sheet">
                <Dialog open title={active?.name ?? ''} onClose={() => setSelected(null)}>
                  {panel}
                  <DialogActions>
                    <Button onClick={() => setSelected(null)}>{t('troupe.close')}</Button>
                  </DialogActions>
                </Dialog>
              </div>
            ) : (
              panel
            ))}
        </div>
      )}
      {adding && (
        <Dialog open title={t('troupe.add')} onClose={() => setAdding(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              {t('troupe.name')}
              <input
                autoFocus
                className="ink-input"
                value={name}
                maxLength={120}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <DialogActions>
              <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
                {t('troupe.add')}
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      )}
      {paste && (
        <PasteDialog
          base={base}
          rows={rows}
          onClose={() => setPaste(false)}
          onCreated={(newRows) => {
            setRows((old) => [...old, ...newRows]);
            setPaste(false);
          }}
        />
      )}
    </section>
  );
}

function CrewRow({
  row,
  selected,
  readOnly,
  onOpen,
}: {
  row: CrewMember;
  selected: boolean;
  readOnly: boolean;
  onOpen: (remove?: boolean) => void;
}) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className={`troupe__row${selected ? ' is-selected' : ''}`}>
      <button
        type="button"
        className="troupe__person"
        aria-pressed={selected}
        onClick={() => onOpen()}
      >
        <strong>
          <Avatar name={row.name} image={row.account?.image} size={22} />
          {row.name}
        </strong>
        <span>
          {row.role}
          {row.onSetContact && <small> · {t('troupe.onSetContact')}</small>}
        </span>
        <span>{row.phone || '—'}</span>
        <span>{row.pickup || '—'}</span>
      </button>
      <button
        ref={anchor}
        type="button"
        className="ink-iconbtn"
        aria-label={t('troupe.menu', { name: row.name })}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: rect.left, y: rect.bottom });
        }}
      >
        ⋯
      </button>
      {menu && (
        <ContextMenu
          anchor={anchor}
          style={{
            position: 'fixed',
            right: Math.max(8, window.innerWidth - menu.x),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 120)),
          }}
          label={t('troupe.menu', { name: row.name })}
          onClose={(reason) => {
            setMenu(null);
            if (reason === 'escape') anchor.current?.focus();
          }}
          items={[
            { label: t('troupe.details'), action: () => onOpen() },
            ...(!readOnly
              ? [{ label: t('troupe.remove'), danger: true, action: () => onOpen(true) }]
              : []),
          ]}
        />
      )}
    </div>
  );
}

function CrewPanel({
  row,
  requestRemove,
  onRemoveHandled,
  departments,
  readOnly,
  base,
  characters,
  onUpdate,
  onRemove,
}: {
  row: CrewMember;
  requestRemove: boolean;
  onRemoveHandled: () => void;
  departments: string[];
  readOnly: boolean;
  base: string;
  characters: CrewCharacter[];
  onUpdate: (row: CrewMember) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(inputOf(row));
  const [revision, setRevision] = useState(row.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<CrewMember | null>(null);
  const [remove, setRemove] = useState(requestRemove);
  useEffect(() => {
    if (requestRemove) {
      setRemove(true);
      onRemoveHandled();
    }
  }, [requestRemove, onRemoveHandled]);
  const [accountQuery, setAccountQuery] = useState(row.account?.name ?? '');
  const save = async (input: CrewMemberInput, rev = revision) => {
    setDraft(input);
    if (!Input.safeParse(input).success) {
      setError(t('troupe.invalid'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await api.put<CrewMember>(`${base}/${row.id}`, { ...input, revision: rev });
      setRevision(saved.revision);
      setConflict(null);
      onUpdate(saved);
    } catch (e) {
      if (e instanceof RequestError && e.status === 409) {
        const current = (e.details as { current?: CrewMember } | undefined)?.current;
        if (current) setConflict(current);
        else setError(t('troupe.error'));
      } else setError(t('troupe.error'));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: 'name' | 'role' | 'phone' | 'email' | 'pickup' | 'notes' | 'department') => (
    <label key={key} htmlFor={`${id}-${key}`}>
      {t(`troupe.${key}`)}
      {key === 'notes' ? (
        <textarea
          id={`${id}-${key}`}
          className="ink-input"
          value={draft[key]}
          maxLength={10000}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          onBlur={() => {
            if (draft[key] !== row[key]) void save(draft);
          }}
        />
      ) : (
        <input
          id={`${id}-${key}`}
          className="ink-input"
          type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
          list={key === 'department' ? `${id}-departments` : undefined}
          value={draft[key]}
          maxLength={key === 'name' || key === 'department' ? 120 : key === 'pickup' ? 1000 : 500}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          onBlur={() => {
            if (draft[key] !== row[key]) void save(draft);
          }}
        />
      )}
    </label>
  );
  const linked = characters.find(
    (el) => el.elementId === draft.character?.elementId && draft.character?.boardId === el.boardId,
  );
  const deleteRow = async () => {
    setBusy(true);
    try {
      await api.delete(`${base}/${row.id}`, { revision });
      onRemove();
    } catch {
      setError(t('troupe.error'));
      setRemove(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="troupe__panel" data-tour="troupe-person">
      <h2>{draft.name}</h2>
      <fieldset disabled={readOnly || busy || !!conflict}>
        <legend className="ink-sr-only">{t('troupe.person')}</legend>
        <div className="troupe__two">
          {field('name')}
          {field('department')}
        </div>
        <datalist id={`${id}-departments`}>
          {departments.filter(Boolean).map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        {field('role')}
        <label>
          {t('troupe.character')}
          <select
            className="ink-input"
            value={draft.character ? `${draft.character.boardId}/${draft.character.elementId}` : ''}
            onChange={(e) =>
              void save({
                ...draft,
                character: characters.find((c) => `${c.boardId}/${c.elementId}` === e.target.value)
                  ? {
                      boardId: e.target.value.split('/')[0] ?? '',
                      elementId: e.target.value.split('/')[1] ?? '',
                    }
                  : null,
              })
            }
          >
            <option value="">{t('troupe.optional')}</option>
            {characters.map((el) => (
              <option key={`${el.boardId}/${el.elementId}`} value={`${el.boardId}/${el.elementId}`}>
                {el.name}
              </option>
            ))}
          </select>
        </label>
        {linked && (
          <div className="troupe__linked">
            <p>
              {t('troupe.actor')}: {linked.actor || '—'}
            </p>
            <p>
              {t('troupe.contact')}: {linked.contact || '—'}
            </p>
          </div>
        )}
        <div className="troupe__two">
          {field('phone')}
          {field('email')}
        </div>
        {field('pickup')}
        <label htmlFor={`${id}-account`}>
          {t('troupe.account')}
          <PeoplePicker
            inputClassName="ink-input"
            id={`${id}-account`}
            aria-label={t('troupe.account')}
            value={accountQuery}
            onChange={setAccountQuery}
            onPick={(person) => {
              setAccountQuery(person.name);
              void save({ ...draft, userId: person.id });
            }}
          />
        </label>
        {draft.userId && (
          <Button
            onClick={() => {
              setAccountQuery('');
              void save({ ...draft, userId: null });
            }}
          >
            {t('troupe.unlink')}
          </Button>
        )}
        <label className="troupe__check">
          <input
            type="checkbox"
            checked={draft.onSetContact}
            onChange={(e) => void save({ ...draft, onSetContact: e.target.checked })}
          />
          <span>
            {t('troupe.onSetContact')}
            <small>{t('troupe.onSetHint')}</small>
          </span>
        </label>
        {field('notes')}
      </fieldset>
      {conflict && (
        <div role="alert">
          <p>{t('troupe.conflict')}</p>
          <Button
            onClick={() => {
              setDraft(inputOf(conflict));
              setRevision(conflict.revision);
              onUpdate(conflict);
              setConflict(null);
            }}
          >
            {t('troupe.reload')}
          </Button>
          <Button onClick={() => void save(draft, conflict.revision)}>
            {t('troupe.keepMine')}
          </Button>
        </div>
      )}
      {error && (
        <div role="alert">
          {error}
          <Button disabled={busy} onClick={() => void save(draft)}>
            {t('troupe.retry')}
          </Button>
        </div>
      )}
      <footer>
        <span role="status">
          {t(
            busy
              ? 'troupe.saving'
              : error || conflict || JSON.stringify(draft) !== JSON.stringify(inputOf(row))
                ? 'troupe.unsaved'
                : 'troupe.saved',
          )}
        </span>
        {!readOnly && (
          <Button disabled={busy} onClick={() => setRemove(true)}>
            {t('troupe.remove')}
          </Button>
        )}
      </footer>
      {remove && (
        <Dialog open title={t('troupe.remove')} onClose={() => setRemove(false)}>
          <p>{t('troupe.removeConfirm', { name: row.name })}</p>
          <DialogActions>
            <Button onClick={() => setRemove(false)}>{t('troupe.cancel')}</Button>
            <Button disabled={busy} onClick={() => void deleteRow()}>
              {t('troupe.remove')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </aside>
  );
}

function PasteDialog({
  base,
  rows,
  onClose,
  onCreated,
}: {
  base: string;
  rows: CrewMember[];
  onClose: () => void;
  onCreated: (rows: CrewMember[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const parsed = parseCrewPaste(
    text,
    rows.map((r) => r.name),
  );
  const fresh = parsed.filter((r) => r.status === 'new');
  const submit = async () => {
    setBusy(true);
    setError(false);
    try {
      const result = await api.post<Crew>(`${base}/bulk`, {
        items: fresh.map((r, i) => ({
          ...emptyCrewMember(r.name, rows.length + i),
          role: r.role,
          phone: r.phone,
          department: r.department,
        })),
      });
      onCreated(result.items);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title={t('troupe.paste')} onClose={onClose}>
      <p>{t('troupe.pasteHint')}</p>
      <div className="troupe__paste" data-tour="troupe-paste">
        <label>
          {t('troupe.pastedText')}
          <textarea
            className="ink-input"
            rows={16}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="troupe__preview" aria-live="polite">
          <p>{t('troupe.preview', { count: fresh.length })}</p>
          {parsed.map((r) => (
            <div className="troupe__preview-row" key={`${r.source}-${r.department}-${r.status}`}>
              <span>{r.department}</span>
              <span>{r.name || r.source}</span>
              <span>{r.role}</span>
              <span>{r.status === 'new' ? r.phone : t(`troupe.${r.status}`)}</span>
            </div>
          ))}
        </div>
      </div>
      {error && <p role="alert">{t('troupe.error')}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('troupe.cancel')}</Button>
        <Button
          variant="primary"
          disabled={busy || !fresh.length || fresh.length > 500}
          onClick={() => void submit()}
        >
          {t('troupe.addPeople', { count: fresh.length })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
