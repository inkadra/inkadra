// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Crew,
  type CrewCharacter,
  type CrewMember,
  type CrewMemberInput,
  canMergeCrew,
  castNameKey,
  CrewMemberInput as Input,
} from '@inkadra/shared';
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  EmptyState,
  RadioGroup,
} from '@inkadra/ui';
import {
  Activity,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { api, RequestError } from '../../lib/api.ts';
import { useIsPhone } from '../../lib/phone.ts';
import { SessionContext } from '../../lib/session-context.ts';
import { PeoplePicker } from '../../people/PeoplePicker.tsx';
import { ContextMenu } from '../chrome.tsx';
import type { BoardStore } from '../store.ts';
import { parseCrewPaste } from './crew-paste.ts';
import { whileVisible } from './schedule.ts';
import './film.css';
import './troupe.css';

/** The most rows one paste sends; the bulk endpoint takes no more. */
const MAX_PASTE = 500;

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
  const [merging, setMerging] = useState<CrewMember | null>(null);
  // A merge changes the open row's revision: the panel starts again from the merged row.
  const [merges, setMerges] = useState(0);
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
  const departments = [...new Set(rows.map((r) => r.department))];
  const visible = rows.filter((r) =>
    [r.name, r.role, r.department, r.phone, r.pickup].some((s) =>
      s.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  /** Rows of the same person that can become this one without losing a link. */
  const duplicates = (row: CrewMember) =>
    rows.filter(
      (r) =>
        r.id !== row.id && castNameKey(r.name) === castNameKey(row.name) && canMergeCrew(row, r),
    );
  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const row = await api.post<CrewMember>(base, emptyCrewMember(name.trim(), rows.length));
      setRows((old) => [...old, row]);
      setOpened((ids) => new Set([...ids, row.id]));
      setSelected(row.id);
      setAdding(false);
      setName('');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const panels = rows
    .filter((row) => opened.has(row.id))
    .map((row) => {
      const panel = (
        <CrewPanel
          key={`${row.id}-${merges}`}
          row={row}
          requestRemove={row.id === selected && removeSelected}
          onRemoveHandled={() => setRemoveSelected(false)}
          departments={departments}
          readOnly={readOnly}
          base={base}
          characters={characters}
          onUpdate={(row) => setRows((old) => old.map((r) => (r.id === row.id ? row : r)))}
          onRemove={() => {
            setRows((old) => old.filter((r) => r.id !== row.id));
            setSelected(null);
          }}
        />
      );
      return (
        <Activity key={`${row.id}-${merges}`} mode={row.id === selected ? 'visible' : 'hidden'}>
          {phone ? (
            <div className="phone-sheet">
              <Dialog open title={row.name} onClose={() => setSelected(null)}>
                {panel}
                <DialogActions>
                  <Button onClick={() => setSelected(null)}>{t('troupe.close')}</Button>
                </DialogActions>
              </Dialog>
            </div>
          ) : (
            panel
          )}
        </Activity>
      );
    });
  return (
    <section className="story troupe" data-tour="troupe">
      <header className="story__bar troupe__bar">
        <span>
          {t('troupe.people', { count: rows.length })} ·{' '}
          {t('troupe.departments', { count: departments.filter(Boolean).length })} ·{' '}
          {t('troupe.wholeProject')}
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
            <Button
              variant="primary"
              icon="plus"
              disabled={loading}
              onClick={() => setAdding(true)}
            >
              {t('troupe.add')}
            </Button>
          </>
        )}
      </header>
      {loading ? (
        <p className="troupe__state" role="status">
          {t('troupe.loading')}
        </p>
      ) : error ? (
        <div className="troupe__state" role="alert">
          <EmptyState
            icon="warning"
            title={t('troupe.error')}
            actions={<Button onClick={() => setRefresh((r) => r + 1)}>{t('troupe.retry')}</Button>}
          />
        </div>
      ) : (
        <div className="story__main troupe__main">
          <div className="story__scroll troupe__list">
            {!rows.length && (
              <EmptyState icon="people" title={t('troupe.empty')}>
                {t('troupe.emptyHint')}
              </EmptyState>
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
                          onMerge={
                            !readOnly && duplicates(row).length ? () => setMerging(row) : undefined
                          }
                          onOpen={(remove = false) => {
                            setRemoveSelected(remove);
                            setOpened((ids) => new Set([...ids, row.id]));
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
          {panels}
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
      {merging && (
        <MergeDialog
          base={base}
          row={merging}
          candidates={duplicates(merging)}
          characters={characters}
          onClose={() => setMerging(null)}
          onMerged={(kept, removed) => {
            setRows((old) =>
              old.filter((r) => r.id !== removed).map((r) => (r.id === kept.id ? kept : r)),
            );
            setSelected((old) => (old === removed || old === kept.id ? kept.id : old));
            setMerges((n) => n + 1);
            setMerging(null);
          }}
          onStale={() => {
            setMerging(null);
            setRefresh((n) => n + 1);
          }}
        />
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
  onMerge,
  onOpen,
}: {
  row: CrewMember;
  selected: boolean;
  readOnly: boolean;
  /** Set when another row of the same person can be merged into this one. */
  onMerge?: (() => void) | undefined;
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
          <span>{row.name}</span>
        </strong>
        <span className="troupe__role">
          <span>{row.role}</span>
          {row.character && (
            <span className="film-chip troupe__chip troupe__chip--character">
              {t('troupe.characterTag')}
            </span>
          )}
          {row.onSetContact && (
            <span className="film-chip troupe__chip troupe__chip--contact">
              {t('troupe.onSetContact')}
            </span>
          )}
        </span>
        <span className={row.phone ? 'troupe__tel' : 'troupe__none'}>{row.phone || '—'}</span>
        <span className={row.pickup ? undefined : 'troupe__none'}>{row.pickup || '—'}</span>
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
            ...(onMerge ? [{ label: t('troupe.merge'), action: onMerge }] : []),
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
  const user = useContext(SessionContext)?.user;
  const id = useId();
  const [draft, setDraft] = useState(inputOf(row));
  // Saves run one after another, each with the revision the previous one returned, so a quick
  // second edit is neither lost nor turned into a conflict with itself.
  const revision = useRef(row.revision);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
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
  const [accountQuery, setAccountQuery] = useState('');
  const [pickAccount, setPickAccount] = useState(false);
  const [pickCharacter, setPickCharacter] = useState<{ right: number; top: number } | null>(null);
  const characterButton = useRef<HTMLButtonElement>(null);
  const save = (input: CrewMemberInput, rev?: number) => {
    setDraft(input);
    if (!Input.safeParse(input).success) {
      setError(t('troupe.invalid'));
      return queue.current;
    }
    pending.current += 1;
    setBusy(true);
    setError('');
    const run = async () => {
      try {
        const saved = await api.put<CrewMember>(`${base}/${row.id}`, {
          ...input,
          revision: rev ?? revision.current,
        });
        revision.current = saved.revision;
        setConflict(null);
        onUpdate(saved);
      } catch (e) {
        if (e instanceof RequestError && e.status === 409) {
          const current = (e.details as { current?: CrewMember } | undefined)?.current;
          if (current) setConflict(current);
          else setError(t('troupe.error'));
        } else setError(t('troupe.error'));
      } finally {
        pending.current -= 1;
        if (!pending.current) setBusy(false);
      }
    };
    queue.current = queue.current.then(run);
    return queue.current;
  };
  const placeholders: Partial<Record<keyof CrewMemberInput, string>> = {
    email: t('troupe.emailPlaceholder'),
    pickup: t('troupe.pickupPlaceholder'),
    notes: t('troupe.notesPlaceholder'),
  };
  const field = (key: 'name' | 'role' | 'phone' | 'email' | 'pickup' | 'notes' | 'department') => (
    <label key={key} htmlFor={`${id}-${key}`}>
      {t(`troupe.${key}`)}
      {key === 'notes' ? (
        <textarea
          id={`${id}-${key}`}
          className="ink-input"
          value={draft[key]}
          placeholder={placeholders[key]}
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
          placeholder={placeholders[key]}
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
      await queue.current;
      await api.delete(`${base}/${row.id}`, { revision: revision.current });
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
      <p className="troupe__eyebrow">{draft.department || t('troupe.noDepartment')}</p>
      <h2>{draft.name}</h2>
      {/* Not disabled while saving: Tab moves on and the next keys land in the next field. */}
      <fieldset disabled={readOnly || !!conflict}>
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
        <div className="troupe__field">
          <span id={`${id}-character`}>
            {t('troupe.characterLabel')} <small>· {t('troupe.optionalTag')}</small>
          </span>
          <div className="troupe__linkcard">
            <div>
              {linked ? (
                <>
                  <strong>{linked.name}</strong>
                  <small>
                    {t('troupe.actor')}: {linked.actor || '—'} · {t('troupe.contact')}:{' '}
                    {linked.contact || '—'}
                  </small>
                </>
              ) : (
                <small id={`${id}-character-hint`}>
                  {t(
                    draft.character
                      ? 'troupe.characterUnavailable'
                      : characters.length
                        ? 'troupe.characterHint'
                        : 'troupe.characterNone',
                  )}
                </small>
              )}
            </div>
            {readOnly ? null : draft.character ? (
              <Button
                aria-describedby={`${id}-character`}
                onClick={() => void save({ ...draft, character: null })}
              >
                {t('troupe.unlinkShort')}
              </Button>
            ) : (
              <button
                ref={characterButton}
                type="button"
                className="ink-btn ink-btn--secondary"
                aria-haspopup="menu"
                aria-expanded={!!pickCharacter}
                aria-describedby={`${id}-character ${id}-character-hint`}
                disabled={!characters.length}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPickCharacter(
                    pickCharacter
                      ? null
                      : {
                          right: Math.max(8, window.innerWidth - rect.right),
                          top: Math.min(rect.bottom + 4, window.innerHeight - 160),
                        },
                  );
                }}
              >
                {t('troupe.link')}
              </button>
            )}
            {pickCharacter && (
              <ContextMenu
                anchor={characterButton}
                style={{ position: 'fixed', ...pickCharacter }}
                label={t('troupe.characterLabel')}
                onClose={(reason) => {
                  setPickCharacter(null);
                  if (reason === 'escape') characterButton.current?.focus();
                }}
                items={characters.map((c) => ({
                  label: c.name,
                  action: () =>
                    void save({
                      ...draft,
                      character: { boardId: c.boardId, elementId: c.elementId },
                    }),
                }))}
              />
            )}
          </div>
        </div>
        <div className="troupe__two">
          {field('phone')}
          {field('email')}
        </div>
        {field('pickup')}
        <div className="troupe__field">
          <span id={`${id}-account-label`}>{t('troupe.account')}</span>
          {draft.userId ? (
            <div className="troupe__linkcard">
              <Avatar
                name={row.account?.name ?? accountQuery}
                image={row.account?.image}
                size={22}
              />
              <div>
                <strong>{row.account?.name ?? accountQuery}</strong>
              </div>
              {!readOnly && (
                <Button
                  aria-label={t('troupe.unlink')}
                  onClick={() => {
                    setAccountQuery('');
                    void save({ ...draft, userId: null });
                  }}
                >
                  {t('troupe.unlinkShort')}
                </Button>
              )}
            </div>
          ) : pickAccount ? (
            <PeoplePicker
              autoFocus
              inputClassName="ink-input"
              id={`${id}-account`}
              aria-label={t('troupe.account')}
              // The search leaves out whoever searches; a director on the crew links themselves.
              include={
                user ? [{ id: user.id, name: user.name, image: user.image, email: user.email }] : []
              }
              empty={t('troupe.noResults')}
              value={accountQuery}
              onChange={setAccountQuery}
              onBlur={() => {
                if (!accountQuery.trim()) setPickAccount(false);
              }}
              onPick={(person) => {
                setAccountQuery(person.name);
                setPickAccount(false);
                void save({ ...draft, userId: person.id });
              }}
            />
          ) : (
            <div className="troupe__linkcard">
              <div>
                <small>{t('troupe.accountHint')}</small>
              </div>
              {!readOnly && (
                <Button
                  aria-describedby={`${id}-account-label`}
                  onClick={() => setPickAccount(true)}
                >
                  {t('troupe.link')}
                </Button>
              )}
            </div>
          )}
        </div>
        <label className="troupe__check">
          <Checkbox
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
              revision.current = conflict.revision;
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
        {!readOnly && (
          <Button
            variant="ghost"
            className="troupe__remove"
            disabled={busy}
            onClick={() => setRemove(true)}
          >
            {t('troupe.remove')}
          </Button>
        )}
        <span role="status">
          {t(
            busy
              ? 'troupe.saving'
              : error || conflict || JSON.stringify(draft) !== JSON.stringify(inputOf(row))
                ? 'troupe.unsaved'
                : 'troupe.saved',
          )}
        </span>
      </footer>
      {remove && (
        <Dialog open title={t('troupe.remove')} onClose={() => setRemove(false)}>
          <p>{t('troupe.removeConfirm', { name: row.name })}</p>
          <DialogActions>
            <Button onClick={() => setRemove(false)}>{t('troupe.cancel')}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void deleteRow()}>
              {t('troupe.remove')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </aside>
  );
}

/** Merges a duplicate row of the same person into `row`, which is kept. */
function MergeDialog({
  base,
  row,
  candidates,
  characters,
  onClose,
  onMerged,
  onStale,
}: {
  base: string;
  row: CrewMember;
  candidates: CrewMember[];
  characters: CrewCharacter[];
  onClose: () => void;
  onMerged: (kept: CrewMember, removed: string) => void;
  onStale: () => void;
}) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(candidates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const other = candidates.find((c) => c.id === from);
  const describe = (r: CrewMember) =>
    [
      r.department || t('troupe.noDepartment'),
      r.role,
      r.phone,
      characters.find(
        (c) => c.boardId === r.character?.boardId && c.elementId === r.character?.elementId,
      )?.name,
      r.account?.name,
    ]
      .filter(Boolean)
      .join(' · ');
  const merge = async () => {
    if (!other) return;
    setBusy(true);
    setError(false);
    try {
      const kept = await api.post<CrewMember>(`${base}/${row.id}/merge`, {
        revision: row.revision,
        from: other.id,
        fromRevision: other.revision,
      });
      onMerged(kept, other.id);
    } catch (e) {
      // A row changed or removed meanwhile: the list reloads and the person can try again.
      if (e instanceof RequestError && (e.status === 409 || e.status === 404)) onStale();
      else setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title={t('troupe.mergeTitle', { name: row.name })} onClose={onClose}>
      <RadioGroup
        label={t('troupe.mergeWith')}
        value={from}
        onChange={setFrom}
        disabled={busy}
        options={candidates.map((c) => ({ value: c.id, label: c.name, description: describe(c) }))}
      />
      <p className="ink-muted">{t('troupe.mergeHint', { name: row.name, kept: describe(row) })}</p>
      {error && <p role="alert">{t('troupe.error')}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('troupe.cancel')}</Button>
        <Button variant="primary" disabled={busy || !other} onClick={() => void merge()}>
          {t('troupe.mergeAction')}
        </Button>
      </DialogActions>
    </Dialog>
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
  const known = rows.map((r) => r.department).filter(Boolean);
  const parsed = parseCrewPaste(
    text,
    rows.map((r) => r.name),
    known,
  );
  const fresh = parsed.filter((r) => r.status === 'new');
  const duplicates = parsed.filter((r) => r.status === 'duplicate').length;
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
        <div className="troupe__preview">
          <p className="troupe__preview-head" aria-live="polite">
            <span>
              {t('troupe.pasteWhat')} · {t('troupe.preview', { count: fresh.length })}
              {!!duplicates && <>, {t('troupe.duplicates', { count: duplicates })}</>}
            </span>
            <small>{t('troupe.columnsRead')}</small>
          </p>
          {!!parsed.length && (
            <div className="troupe__preview-table">
              <div className="troupe__preview-row troupe__preview-row--head">
                {['department', 'name', 'role', 'phoneColumn'].map((key) => (
                  <span key={key}>{t(`troupe.${key}`)}</span>
                ))}
              </div>
              {parsed.slice(0, MAX_PASTE).map((r) =>
                r.status !== 'new' && r.status !== 'duplicate' ? (
                  <div
                    className="troupe__preview-row is-skipped"
                    key={`${r.source}-${r.department}-${r.status}`}
                  >
                    <span>—</span>
                    <s>{r.name || r.source.trim()}</s>
                    <span>{t(`troupe.${r.status}`)}</span>
                    <span />
                  </div>
                ) : (
                  <div
                    className="troupe__preview-row"
                    key={`${r.source}-${r.department}-${r.status}`}
                  >
                    <span>
                      {r.department && !known.includes(r.department) ? (
                        <span className="film-chip troupe__chip troupe__chip--new">
                          {r.department}
                        </span>
                      ) : (
                        r.department || '—'
                      )}
                    </span>
                    <span>{r.name}</span>
                    <span>{r.role || '—'}</span>
                    <span>
                      {r.status === 'duplicate' ? (
                        <span className="film-chip troupe__chip troupe__chip--contact">
                          {t('troupe.duplicate')}
                        </span>
                      ) : (
                        r.phone || '—'
                      )}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
      <p className="troupe__paste-foot">{t('troupe.pasteFoot')}</p>
      {fresh.length > MAX_PASTE && <p role="alert">{t('troupe.tooMany')}</p>}
      {error && <p role="alert">{t('troupe.error')}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('troupe.cancel')}</Button>
        <Button
          variant="primary"
          disabled={busy || !fresh.length || fresh.length > MAX_PASTE}
          onClick={() => void submit()}
        >
          {t('troupe.addPeople', { count: fresh.length })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
