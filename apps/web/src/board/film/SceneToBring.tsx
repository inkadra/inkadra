// SPDX-License-Identifier: AGPL-3.0-only
import {
  addTodoItem,
  createElement,
  deleteElements,
  removeTodoItem,
  type SceneElement,
  updateElement,
  updateTodoItem,
} from '@inkadra/canvas-core';
import { type Element, TODO_LISTS, type TodoList } from '@inkadra/doc-schema';
import type { Person, ProjectMember } from '@inkadra/shared';
import { Avatar, Button, Checkbox, Dialog, DialogActions, Icon, IconButton } from '@inkadra/ui';
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.ts';
import { useModules } from '../../lib/modules.ts';
import { ContextMenu } from '../chrome.tsx';
import { type BoardStore, LOCAL } from '../store.ts';
import { Toast } from '../Toast.tsx';
import { sceneIdsOf } from './needed.ts';
import { loadBoardDays } from './production-days.ts';
import { useSlugline } from './storyboard-data.ts';
import './needed.css';

type SceneList = Extract<Element, { type: 'todo' }> & { list: TodoList; sceneId: string };

/** The typed lists of a scene (decision 0058): by kind of list, then oldest first. */
export function listsOfScene(elements: Iterable<Element>, sceneId: string): SceneList[] {
  return [...elements]
    .filter((e): e is SceneList => e.type === 'todo' && !!e.list && e.sceneId === sceneId)
    .sort(
      (a, b) =>
        TODO_LISTS.indexOf(a.list) - TODO_LISTS.indexOf(b.list) || a.createdAt - b.createdAt,
    );
}

/**
 * A new typed list for a scene: the same to-do card a list made on the canvas and linked to the
 * scene is, placed under the scene, since a storyboard has no canvas (decision 0121).
 */
export function addSceneList(
  store: BoardStore,
  scene: SceneElement,
  list: TodoList,
  userId: string,
): string {
  store.undo.stopCapturing();
  const el = createElement(
    store.doc,
    'todo',
    { x: scene.x, y: scene.y + (scene.h ?? 0) + 40 },
    { items: [], list, sceneId: scene.id },
    { userId, origin: LOCAL },
  );
  store.undo.stopCapturing();
  return el.id;
}

/** One undo step for a change made in the pop-up. */
function step(store: BoardStore, change: () => void) {
  store.undo.stopCapturing();
  change();
  store.undo.stopCapturing();
}

/** The first `max` characters, never half of one (an emoji is two UTF-16 units). */
export const clip = (text: string, max: number) => Array.from(text).slice(0, max).join('');

const filled = (lists: readonly SceneList[]) =>
  lists.flatMap((l) => l.items.filter((i) => i.text.trim()));

/**
 * "To bring" on a scene of the Storyboard view: the scene's wardrobe, props and equipment lists,
 * which the shooting days of the scene gather (decision 0058). It belongs to Production
 * (decision 0121): off, a scene that has lists keeps the button to read and tick them, and
 * nothing more (no list or item made, renamed, retyped or deleted); without lists there is no
 * button. Viewers only read.
 */
export function SceneToBring({
  store,
  scene,
  boardId,
  projectId,
  userId,
  readOnly,
}: {
  store: BoardStore;
  scene: SceneElement;
  boardId: string;
  projectId: string;
  userId: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { offers } = useModules();
  const canCreate = !readOnly && offers('menus', 'sceneToBring');
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const lists = listsOfScene(snap.byId.values(), scene.id);
  const items = filled(lists);
  const ready = items.filter((i) => i.done).length;
  const shown = lists.length > 0 || canCreate;
  const label = lists.length
    ? t('needed.scene.label', { number: scene.number, ready, total: items.length })
    : t('needed.scene.labelEmpty', { number: scene.number });
  return (
    <>
      {shown && (
        <Button
          icon="todo"
          className="to-bring-btn"
          data-tour="storyboard-to-bring"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          onClick={(e) => {
            button.current = e.currentTarget;
            setOpen((v) => !v);
          }}
        >
          {t('needed.title')}
          {items.length > 0 && (
            <span className="to-bring-btn__count">
              {ready}/{items.length}
            </span>
          )}
        </Button>
      )}
      {shown && open && button.current && (
        <ToBringPanel
          store={store}
          scene={scene}
          lists={lists}
          anchor={button as RefObject<HTMLButtonElement>}
          boardId={boardId}
          projectId={projectId}
          userId={userId}
          readOnly={readOnly}
          canCreate={canCreate}
          onToast={setToast}
          onClose={(focus) => {
            setOpen(false);
            if (focus) button.current?.focus();
          }}
        />
      )}
      {toast && (
        <Toast
          text={toast}
          onUndo={() => store.undo.undo()}
          history={store.undo}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}

type Menu =
  | { kind: 'add'; style: CSSProperties }
  | { kind: 'list'; id: string; style: CSSProperties }
  | { kind: 'type'; id: string; style: CSSProperties };

function ToBringPanel({
  store,
  scene,
  lists,
  anchor,
  boardId,
  projectId,
  userId,
  readOnly,
  canCreate,
  onToast,
  onClose,
}: {
  store: BoardStore;
  scene: SceneElement;
  lists: SceneList[];
  anchor: RefObject<HTMLButtonElement>;
  boardId: string;
  projectId: string;
  userId: string;
  readOnly: boolean;
  canCreate: boolean;
  onToast: (text: string) => void;
  onClose: (focus: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const slugline = useSlugline();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });
  const [menu, setMenu] = useState<Menu | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [shooting, setShooting] = useState<Array<{ n: number; date: string }>>([]);
  const doc = store.doc;
  const typeName = (list: TodoList) => t(`board.todo.lists.${list}`);
  const nameOf = (l: SceneList) => l.title?.trim() || typeName(l.list);

  // Under the button, or above it when the room below is short; inside the window on a phone.
  useLayoutEffect(() => {
    const r = anchor.current.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 32);
    const left = Math.max(16, Math.min(r.left, window.innerWidth - width - 16));
    const below = window.innerHeight - r.bottom - 22;
    const above = r.top - 22;
    setPlace(
      below >= 320 || below >= above
        ? { left, width, top: r.bottom + 6, maxHeight: below }
        : { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: above },
    );
    panel.current?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (root.current?.contains(target) || anchor.current.contains(target)) return;
      onClose(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      // A menu, the question or a field being typed in takes its own Escape.
      if (e.key !== 'Escape' || menu || confirm) return;
      if (e.target instanceof HTMLInputElement && root.current?.contains(e.target)) return;
      e.stopImmediatePropagation();
      onClose(true);
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [anchor, menu, confirm, onClose]);

  // Who brings each item, and the days that shoot the scene, for the footer.
  useEffect(() => {
    let live = true;
    api
      .get<{ items: ProjectMember[] }>(`/projects/${projectId}/members`)
      .then((r) => live && setPeople(r.items.map((m) => ({ ...m.user, email: null }))))
      .catch(() => {});
    loadBoardDays(boardId, undefined)
      .then((all) => {
        if (!live) return;
        const byId = store.getSnapshot().byId;
        setShooting(
          all.flatMap((day, n) =>
            sceneIdsOf(day, byId).includes(scene.id) ? [{ n: n + 1, date: day.date }] : [],
          ),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [boardId, projectId, scene.id, store]);
  const date = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const days = shooting.length
    ? t('needed.scene.days', {
        days: shooting
          .map(({ n, date: d }) =>
            t('needed.scene.day', { n, date: date.format(Date.parse(`${d}T00:00:00Z`)) }),
          )
          .join(', '),
      })
    : '';

  const openMenu = (e: MouseEvent<HTMLElement>, next: (r: DOMRect) => Menu) => {
    menuAnchor.current = e.currentTarget;
    const r = e.currentTarget.getBoundingClientRect();
    setMenu((m) => (m ? null : next(r)));
  };
  const menuBelow = (r: DOMRect): CSSProperties => ({
    position: 'fixed',
    left: Math.max(8, r.right - 200),
    top: r.bottom + 4,
  });
  const closeMenu = (reason: 'escape' | 'outside' | 'item') => {
    setMenu(null);
    if (reason === 'escape') menuAnchor.current?.focus();
  };

  const addList = (list: TodoList) => {
    const id = addSceneList(store, scene, list, userId);
    setNaming(id);
  };
  const deleteList = (l: SceneList) => {
    step(store, () => deleteElements(doc, [l.id], LOCAL));
    onToast(t('needed.scene.listDeleted'));
  };
  const deleteItem = (l: SceneList, itemId: string) => {
    step(store, () => removeTodoItem(doc, l.id, itemId, LOCAL));
    onToast(t('needed.scene.itemDeleted'));
  };

  const toConfirm = lists.find((l) => l.id === confirm);
  const menuList = menu && menu.kind !== 'add' ? lists.find((l) => l.id === menu.id) : undefined;
  const title = t('needed.scene.title', { number: scene.number });
  const footer = !readOnly && (!!days || canCreate);

  return (
    <div ref={root} className="to-bring-root">
      <div
        ref={panel}
        className="to-bring ink-motion-pop"
        role="dialog"
        aria-label={t('needed.scene.dialog', { number: scene.number })}
        style={place}
        data-chrome=""
      >
        <div className="to-bring__head">
          <div className="to-bring__heading">
            <span className="to-bring__title">{title}</span>
            <span className="to-bring__slug">{slugline(scene)}</span>
          </div>
          <IconButton icon="close" label={t('needed.scene.close')} onClick={() => onClose(true)} />
        </div>
        <div className="to-bring__body">
          {lists.length === 0 && (
            <div className="to-bring__empty">
              <Icon name="todo" size={22} />
              <strong>{t('needed.scene.emptyTitle', { number: scene.number })}</strong>
              <span>{t('needed.scene.emptyBody')}</span>
            </div>
          )}
          {TODO_LISTS.map((type) => {
            const ofType = lists.filter((l) => l.list === type);
            if (!ofType.length) return null;
            return (
              <section key={type} aria-label={typeName(type)}>
                <h3 className="to-bring__type">{typeName(type)}</h3>
                {ofType.map((l) => {
                  const done = filled([l]);
                  return (
                    <div key={l.id} className="to-bring__list">
                      <div className="to-bring__list-head">
                        {naming === l.id ? (
                          <InlineField
                            label={t('needed.scene.listName')}
                            value={l.title ?? ''}
                            placeholder={typeName(l.list)}
                            onSave={(typed) => {
                              const text = clip(typed, 200);
                              setNaming(null);
                              if (text !== (l.title ?? ''))
                                step(store, () =>
                                  updateElement(doc, l.id, { title: text || undefined }, LOCAL),
                                );
                            }}
                            onEnter={() => canCreate && !l.items.length && setAdding(l.id)}
                            onCancel={() => setNaming(null)}
                          />
                        ) : (
                          <span className="to-bring__name">{nameOf(l)}</span>
                        )}
                        <span className="to-bring__count">
                          {done.filter((i) => i.done).length}/{done.length}
                        </span>
                        {canCreate && (
                          <IconButton
                            icon="more"
                            label={t('needed.scene.listOptions', { name: nameOf(l) })}
                            aria-haspopup="menu"
                            aria-expanded={menu?.kind === 'list' && menu.id === l.id}
                            onClick={(e) =>
                              openMenu(e, (r) => ({ kind: 'list', id: l.id, style: menuBelow(r) }))
                            }
                          />
                        )}
                      </div>
                      <ul className="to-bring__items">
                        {l.items.map((item) => {
                          const person = people.find((p) => p.id === item.assigneeId);
                          const key = `${l.id}/${item.id}`;
                          return (
                            <li
                              key={item.id}
                              className={`to-bring__item${item.done ? ' is-done' : ''}`}
                            >
                              <Checkbox
                                checked={item.done}
                                disabled={readOnly}
                                aria-label={item.text || t('needed.scene.itemName')}
                                onChange={() =>
                                  step(store, () =>
                                    updateTodoItem(doc, l.id, item.id, { done: !item.done }, LOCAL),
                                  )
                                }
                              />
                              {renaming === key ? (
                                <InlineField
                                  label={t('needed.scene.itemName')}
                                  value={item.text}
                                  onSave={(text) => {
                                    setRenaming(null);
                                    if (text && text !== item.text)
                                      step(store, () =>
                                        updateTodoItem(doc, l.id, item.id, { text }, LOCAL),
                                      );
                                  }}
                                  onCancel={() => setRenaming(null)}
                                />
                              ) : (
                                // biome-ignore lint/a11y/noStaticElementInteractions: a shortcut for the Rename button beside it
                                <span
                                  className="to-bring__text"
                                  onDoubleClick={() => canCreate && setRenaming(key)}
                                >
                                  {item.text}
                                </span>
                              )}
                              {canCreate && renaming !== key && (
                                <span className="to-bring__actions">
                                  <IconButton
                                    icon="pen"
                                    label={t('needed.scene.rename', { name: item.text })}
                                    onClick={() => setRenaming(key)}
                                  />
                                  <IconButton
                                    icon="close"
                                    label={t('needed.scene.delete', { name: item.text })}
                                    onClick={() => deleteItem(l, item.id)}
                                  />
                                </span>
                              )}
                              {person && (
                                <Avatar name={person.name} image={person.image} size={20} />
                              )}
                            </li>
                          );
                        })}
                        {adding === l.id && (
                          <li className="to-bring__item">
                            <InlineField
                              label={t('needed.scene.itemName')}
                              value=""
                              keepOnEnter
                              onSave={(text) => {
                                if (text)
                                  step(store, () => addTodoItem(doc, l.id, text, undefined, LOCAL));
                              }}
                              onCancel={() => setAdding(null)}
                              onBlur={() => setAdding(null)}
                            />
                          </li>
                        )}
                      </ul>
                      {canCreate && adding !== l.id && (
                        <button
                          type="button"
                          className="to-bring__add"
                          onClick={() => setAdding(l.id)}
                        >
                          <Icon name="plus" size={14} />
                          {t('needed.scene.addItem')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
        {readOnly && lists.length > 0 && (
          <p className="to-bring__foot to-bring__note">{t('needed.scene.readOnly')}</p>
        )}
        {footer && (
          <div className="to-bring__foot">
            <span className="to-bring__days">{days}</span>
            {canCreate && (
              <Button
                icon="plus"
                aria-haspopup="menu"
                aria-expanded={menu?.kind === 'add'}
                onClick={(e) =>
                  openMenu(e, (r) => ({
                    kind: 'add',
                    style: {
                      position: 'fixed',
                      left: Math.max(8, r.right - 200),
                      bottom: window.innerHeight - r.top + 4,
                    },
                  }))
                }
              >
                {t('needed.scene.addList')}
                <Icon name="chevronDown" size={12} />
              </Button>
            )}
          </div>
        )}
      </div>
      {menu?.kind === 'add' && (
        <ContextMenu
          style={menu.style}
          className="to-bring__menu"
          anchor={menuAnchor}
          label={t('needed.scene.listType')}
          onClose={closeMenu}
          items={TODO_LISTS.map((list) => ({ label: typeName(list), action: () => addList(list) }))}
        />
      )}
      {menu?.kind === 'list' && menuList && (
        <ContextMenu
          style={menu.style}
          className="to-bring__menu"
          anchor={menuAnchor}
          label={t('needed.scene.listOptions', { name: nameOf(menuList) })}
          onClose={closeMenu}
          items={[
            { label: t('needed.scene.renameList'), action: () => setNaming(menuList.id) },
            {
              label: t('needed.scene.changeType'),
              action: () => setMenu({ kind: 'type', id: menuList.id, style: menu.style }),
            },
            { divider: true },
            {
              label: t('needed.scene.deleteList'),
              danger: true,
              action: () => setConfirm(menuList.id),
            },
          ]}
        />
      )}
      {menu?.kind === 'type' && menuList && (
        <ContextMenu
          style={menu.style}
          className="to-bring__menu"
          anchor={menuAnchor}
          label={t('needed.scene.changeType')}
          onClose={closeMenu}
          items={TODO_LISTS.map((list) => ({
            label: typeName(list),
            checked: menuList.list === list,
            action: () => step(store, () => updateElement(doc, menuList.id, { list }, LOCAL)),
          }))}
        />
      )}
      <Dialog
        open={!!toConfirm}
        title={toConfirm ? t('needed.scene.deleteTitle', { name: nameOf(toConfirm) }) : ''}
        onClose={() => setConfirm(null)}
      >
        {toConfirm && (
          <p>
            {t('needed.scene.deleteBody', {
              type: typeName(toConfirm.list),
              number: scene.number,
              count: toConfirm.items.length,
            })}
          </p>
        )}
        <DialogActions>
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            {t('needed.scene.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (toConfirm) deleteList(toConfirm);
              setConfirm(null);
            }}
          >
            {t('needed.scene.deleteConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

/**
 * A name typed in place: Enter saves, Escape cancels, leaving it saves. `keepOnEnter` empties it
 * for the next one instead, as adding items does.
 */
function InlineField({
  label,
  value,
  placeholder,
  keepOnEnter,
  onSave,
  onEnter,
  onCancel,
  onBlur,
}: {
  label: string;
  value: string;
  placeholder?: string;
  keepOnEnter?: boolean;
  onSave: (text: string) => void;
  onEnter?: () => void;
  onCancel: () => void;
  onBlur?: () => void;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const save = () => onSave(clip(text.trim(), 2000));
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the field opens on purpose, from a button
      autoFocus
      className="ink-input to-bring__field"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
          if (keepOnEnter) setText('');
          else done.current = true;
          onEnter?.();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!done.current) save();
        onBlur?.();
      }}
    />
  );
}
