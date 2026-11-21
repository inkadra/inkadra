import {
  createElement,
  deleteElements,
  type FrameElement,
  updateElement,
} from '@inkadra/canvas-core';
import { ASPECT_RATIOS, type AspectRatio, type Element } from '@inkadra/doc-schema';
import {
  type CrewCharacter,
  type CrewMember,
  castNameKey,
  type SearchResult,
} from '@inkadra/shared';
import { Button, Icon, IconButton, Input, Select } from '@inkadra/ui';
import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterActions } from '../../commands/actions.ts';
import {
  duplicateInStore,
  framePanelActions,
  setFrameStatus,
} from '../../commands/board-actions.ts';
import { api, RequestError } from '../../lib/api.ts';
import { useModules } from '../../lib/modules.ts';
import { useAsset } from '../assets.ts';
import { ContextMenu } from '../chrome.tsx';
import { CrewEditorContext, GuestModeContext } from '../context.ts';
import { authorName, editableText } from '../review-model.ts';
import { openComments, useReviews } from '../review-store.ts';
import { type BoardStore, LOCAL, REPAIR } from '../store.ts';
import { TagEditor } from '../tags.tsx';
import { aspectLabel } from './aspect.ts';
import { castCharacter } from './call-sheet.ts';
import {
  castPerformers,
  characterTakenBy,
  crewInput,
  freePerformers,
  useCrew,
} from './day-calls.ts';
import { FramePicture } from './FramePicture.tsx';
import { ShotField, StatusSelect, TextField } from './fields.tsx';
import { moveImageToFrame } from './frame-image.ts';
import { FrameUploadState, uploadToFrame } from './frame-upload.tsx';
import { VideoReferencePicker } from './VideoReferencePicker.tsx';

type Patch = Partial<Omit<FrameElement, 'id' | 'type'>>;

/** Side panel with every field of a frame. */
export function FramePanel({
  store,
  frame,
  label,
  boardAspect,
  projectId,
  boardId,
  readOnly,
  userId = null,
  id,
  takeFocus = false,
  dropping = false,
  onClose,
  onDraw,
  onInserted,
}: {
  store: BoardStore;
  frame: FrameElement;
  label: string;
  boardAspect: AspectRatio;
  projectId: string;
  boardId: string;
  readOnly: boolean;
  userId?: string | null;
  id?: string;
  /** Move focus into the panel when it opens, for a panel that covers what opened it. */
  takeFocus?: boolean;
  /** Image files are being dragged over the picture (storyboard): dropping them replaces it. */
  dropping?: boolean;
  onClose: () => void;
  onDraw: () => void;
  /** A picture has just become the frame's; `kept` when its card stayed on the board. */
  onInserted?: (result: 'moved' | 'kept') => void;
}) {
  const { t } = useTranslation();
  const duplicate = () => {
    duplicateInStore(store, [frame.id], userId);
  };
  const guest = useContext(GuestModeContext);
  useRegisterActions(
    framePanelActions({ readOnly: readOnly || guest, store, frameId: frame.id, duplicate, t }),
  );
  const [pictureMenu, setPictureMenu] = useState(false);
  const [boardPictures, setBoardPictures] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Patch) => !readOnly && updateElement(store.doc, frame.id, patch, LOCAL);
  const text = (v: string) => v.trim() || undefined;
  const panel = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when another frame opens
  useEffect(() => {
    if (takeFocus) panel.current?.focus();
  }, [takeFocus, frame.id]);
  return (
    <aside
      ref={panel}
      id={id}
      className="film-panel"
      aria-label={t('film.frame.details')}
      tabIndex={takeFocus ? -1 : undefined}
      data-chrome
      data-scroll
    >
      <header className="film-panel__head">
        <span className="film-panel__label">{label}</span>
        <StatusSelect
          value={frame.status}
          readOnly={readOnly}
          label={t('film.frame.status')}
          onCommit={(status) => {
            if (!readOnly) setFrameStatus(store, frame.id, status);
          }}
        />
        <span className="ink-header__spacer" />
        <IconButton icon="close" label={t('film.frame.close')} onClick={onClose} />
      </header>
      <div className="film-panel__body">
        <div
          className={`film-panel__picture${dropping ? ' is-drop' : ''}`}
          data-story-frame={frame.id}
        >
          <FramePicture
            assetId={frame.assetId}
            aspect={frame.aspect}
            boardAspect={boardAspect}
            strokes={frame.strokes}
            shapes={frame.shapes}
            referenceOpacity={frame.referenceOpacity}
            pixels={640}
          />
          <FrameUploadState frameId={frame.id} />
          {!readOnly && (
            <div className="film-panel__picture-actions">
              <Button icon="pen" onClick={onDraw}>
                {t('film.frame.draw')}
              </Button>
              <Button
                icon="image"
                variant="ghost"
                aria-expanded={pictureMenu}
                onClick={() => setPictureMenu(!pictureMenu)}
              >
                {t('board.types.image')}
              </Button>
              {pictureMenu && (
                <div className="film-panel__image-menu">
                  <Button icon="upload" variant="ghost" onClick={() => fileInput.current?.click()}>
                    {t('film.frame.upload')}
                  </Button>
                  {!guest && userId && (
                    <VideoReferencePicker
                      store={store}
                      frameId={frame.id}
                      projectId={projectId}
                      userId={userId}
                      readOnly={readOnly}
                      onInserted={() => onInserted?.('moved')}
                    />
                  )}
                  <Button
                    icon="board"
                    variant="ghost"
                    aria-expanded={boardPictures}
                    onClick={() => setBoardPictures(!boardPictures)}
                  >
                    {t('story.fromBoard')}
                  </Button>
                  {boardPictures && (
                    <BoardPictures
                      store={store}
                      frameId={frame.id}
                      boardAspect={boardAspect}
                      onDone={(moved) => {
                        setBoardPictures(false);
                        setPictureMenu(false);
                        if (moved) onInserted?.(moved);
                      }}
                    />
                  )}
                  {frame.assetId && (
                    <Button
                      icon="trash"
                      variant="ghost"
                      className="film-panel__image-remove"
                      onClick={() => set({ assetId: undefined, source: undefined })}
                    >
                      {t('film.frame.removePicture')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="film-panel__row">
          <TextField
            label={t('film.frame.label')}
            value={frame.label ?? ''}
            placeholder={t('film.frame.labelAuto', { label })}
            readOnly={readOnly}
            onCommit={(v) => set({ label: text(v)?.slice(0, 12) })}
          />
          <div className="film-field">
            <label htmlFor={`aspect-${frame.id}`}>{t('film.aspect.label')}</label>
            <Select
              id={`aspect-${frame.id}`}
              className="ink-input"
              value={frame.aspect ?? ''}
              disabled={readOnly}
              onChange={(e) => set({ aspect: (e || undefined) as AspectRatio })}
            >
              <option value="">
                {t('film.aspect.board', { ratio: aspectLabel(boardAspect) })}
              </option>
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {aspectLabel(r)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <TextField
          label={t('film.frame.action')}
          value={frame.action ?? ''}
          placeholder={t('film.frame.actionPlaceholder')}
          multiline
          readOnly={readOnly}
          onCommit={(v) => set({ action: text(v) })}
        />
        <div className="film-panel__row">
          <ShotField
            label={t('film.frame.shot')}
            value={frame.shot}
            catalog="shotSizes"
            readOnly={readOnly}
            onCommit={(shot) => set({ shot })}
          />
          <ShotField
            label={t('film.frame.angle')}
            value={frame.angle}
            catalog="shotAngles"
            readOnly={readOnly}
            onCommit={(angle) => set({ angle })}
          />
        </div>
        <div className="film-panel__row">
          <ShotField
            label={t('film.frame.movement')}
            value={frame.movement}
            catalog="shotMovements"
            readOnly={readOnly}
            onCommit={(movement) => set({ movement })}
          />
          <TextField
            label={t('film.frame.lens')}
            value={frame.lens ?? ''}
            placeholder="35mm"
            readOnly={readOnly}
            onCommit={(v) => set({ lens: text(v)?.slice(0, 60) })}
          />
        </div>
        <TextField
          label={t('film.frame.location')}
          value={frame.location ?? ''}
          readOnly={readOnly}
          onCommit={(v) => set({ location: text(v)?.slice(0, 200) })}
        />
        <TextField
          label={t('film.frame.cast')}
          value={(frame.cast ?? []).join(', ')}
          hint={t('film.frame.castHint')}
          readOnly={readOnly}
          onCommit={(v) => {
            const cast = [
              ...new Set(
                v
                  .split(',')
                  .map((c) => c.trim().slice(0, 80))
                  .filter(Boolean),
              ),
            ].slice(0, 30);
            set({ cast: cast.length > 0 ? cast : undefined });
          }}
        />
        {!guest && (frame.cast ?? []).length > 0 && (
          <CastPerformers
            store={store}
            projectId={projectId}
            boardId={boardId}
            cast={frame.cast ?? []}
            userId={userId}
            readOnly={readOnly}
          />
        )}
        {!readOnly && !guest && (
          <CastLinks
            store={store}
            projectId={projectId}
            cast={frame.cast ?? []}
            onAdd={(name) => set({ cast: [...(frame.cast ?? []), name].slice(0, 30) })}
          />
        )}
        <TextField
          label={t('film.frame.dialogue')}
          value={frame.dialogue ?? ''}
          multiline
          readOnly={readOnly}
          onCommit={(v) => set({ dialogue: text(v) })}
        />
        <TextField
          label={t('film.frame.audio')}
          value={frame.audio ?? ''}
          readOnly={readOnly}
          onCommit={(v) => set({ audio: text(v)?.slice(0, 500) })}
        />
        <TextField
          label={t('film.frame.notes')}
          value={frame.notes ?? ''}
          multiline
          readOnly={readOnly}
          onCommit={(v) => set({ notes: text(v) })}
        />
        <div className="film-field">
          <span className="film-field__label">{t('tags.title')}</span>
          <TagEditor
            tags={frame.tags ?? []}
            readOnly={readOnly}
            projectId={projectId}
            onChange={(tags) => set({ tags })}
          />
        </div>
        <FrameComments elementId={frame.id} />
        {!readOnly && (
          <div className="film-panel__actions">
            <Button icon="copy" onClick={duplicate}>
              {t('film.frame.duplicate')}
            </Button>
            {frame.status !== 'ready' && (
              <Button
                icon="check"
                variant="primary"
                onClick={() => setFrameStatus(store, frame.id, 'ready')}
              >
                {t('film.frame.markReady')}
              </Button>
            )}
          </div>
        )}
        {!readOnly && (
          <Button
            icon="trash"
            variant="danger"
            className="film-panel__delete"
            onClick={() => {
              store.undo.stopCapturing();
              deleteElements(store.doc, [frame.id], LOCAL);
              onClose();
            }}
          >
            {t('film.frame.delete')}
          </Button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          uploadToFrame({
            store,
            frameId: frame.id,
            file,
            projectId,
            boardId,
            onInserted: () => onInserted?.('moved'),
          });
        }}
      />
    </aside>
  );
}

/** Unlocked image cards of the board, subscribed only while the picker is open. */
function BoardPictures({
  store,
  frameId,
  boardAspect,
  onDone,
}: {
  store: BoardStore;
  frameId: string;
  boardAspect: AspectRatio;
  onDone: (moved: 'moved' | 'kept' | null) => void;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div className="film-panel__video-picker">
      {[...snapshot.byId.values()].flatMap((image) =>
        image.type === 'image' && image.assetId && !image.locked
          ? [
              <BoardPicture
                key={image.id}
                image={image}
                boardAspect={boardAspect}
                onPick={() => onDone(moveImageToFrame(store, image.id, frameId))}
              />,
            ]
          : [],
      )}
    </div>
  );
}

/** A picture of the board to put into the frame, named by its caption or file. */
function BoardPicture({
  image,
  boardAspect,
  onPick,
}: {
  image: Extract<Element, { type: 'image' }>;
  boardAspect: AspectRatio;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const asset = useAsset(image.assetId);
  const name =
    image.caption?.trim() ||
    (asset && asset !== 'missing' ? asset.filename : '') ||
    t('board.types.image');
  return (
    <button type="button" className="ink-btn ink-btn--ghost" onClick={onPick}>
      <FramePicture
        aspect={undefined}
        strokes={undefined}
        assetId={image.assetId}
        boardAspect={boardAspect}
        pixels={160}
      />
      <span>{name}</span>
    </button>
  );
}

/**
 * Who plays each name of the frame's cast, by the call sheet's rules (decision 0091). "Link" picks
 * a free person of the Troupe and links their row to the card of that name, made on this board
 * when the project has none; it shows only to project editors, who can write the crew. Nothing
 * when Production is off or the roster cannot be read (a grant on one board).
 */
export function CastPerformers({
  store,
  projectId,
  boardId,
  cast,
  userId,
  readOnly,
}: {
  store: BoardStore;
  projectId: string;
  boardId: string;
  cast: readonly string[];
  userId: string | null;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const production = useModules().isOn('production');
  const canLink = useContext(CrewEditorContext) && !readOnly;
  const crew = useCrew(production ? projectId : undefined, boardId);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const labelId = useId();
  const list = useRef<HTMLUListElement>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [picking, setPicking] = useState<{ name: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  // After a link the focus goes to the name's row: its "Link" again when it failed.
  const settle = useRef<string | null>(null);
  useEffect(() => {
    const name = settle.current;
    const row = [...(list.current?.querySelectorAll<HTMLElement>('li') ?? [])].find(
      (li) => li.dataset.cast === name,
    );
    if (!row) return;
    settle.current = null;
    (row.querySelector<HTMLElement>('button') ?? row).focus();
  });
  if (!production || !crew.items) return null;
  const free = freePerformers(crew.items, snap.byId, crew.characters);
  /**
   * The card of a cast name: on this board, else the first of the project (the server lists
   * storyboards first, in a fixed order). This board is read again after the request, so a card
   * a colleague made meanwhile is used rather than a second one made.
   */
  const cardOf = async (name: string) => {
    const here = () => castCharacter(name, store.getSnapshot().byId);
    const local = here();
    if (local) return { boardId, elementId: local.id };
    const { items } = await api.get<{ items: CrewCharacter[] }>(
      `/projects/${projectId}/crew/characters`,
    );
    const there = items.find((c) => castNameKey(c.name) === castNameKey(name));
    if (there) return { boardId: there.boardId, elementId: there.elementId };
    const arrived = here();
    return arrived ? { boardId, elementId: arrived.id } : null;
  };
  /**
   * A new card for the name, below everything on this board. Only the name: who plays it is the
   * crew link, so a link that fails leaves no performer behind. No step of the person's undo
   * (REPAIR): undoing it would leave the link pointing at nothing.
   * shortcut: two editors making the first card of one name in the same moment get two cards;
   * the server's one-row-per-card rule does not see names. Upgrade: create cards on the server.
   */
  const newCard = (name: string) => {
    const bottom = [...store.getSnapshot().byId.values()]
      .filter((el) => !el.parent)
      .reduce((max, el) => Math.max(max, el.y + (el.h ?? 200)), 0);
    return createElement(
      store.doc,
      'character',
      { x: 0, y: bottom + 40 },
      { name },
      { userId, origin: REPAIR },
    ).id;
  };
  const link = async (name: string, member: CrewMember) => {
    setBusy(name);
    setProblem('');
    let made: string | null = null;
    try {
      let character = await cardOf(name);
      if (!character) {
        made = newCard(name);
        character = { boardId, elementId: made };
      }
      // A card made here reaches the server with the next sync: until then the link is 400
      // "Character not found", so it is tried again for a few seconds.
      for (let attempt = 0; ; attempt++) {
        try {
          await api.put(`/projects/${projectId}/crew/${member.id}`, {
            ...crewInput(member),
            character,
            revision: member.revision,
          });
          break;
        } catch (e) {
          if (!made || attempt >= 5 || !(e instanceof RequestError && e.status === 400)) throw e;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } catch (e) {
      // The card made for this link goes again; a card that was there stays as it was.
      if (made) deleteElements(store.doc, [made], REPAIR);
      const taken = characterTakenBy(e);
      setProblem(
        taken
          ? t('film.frame.performerTaken', { name, performer: taken.name })
          : e instanceof RequestError && e.status === 409
            ? t('film.frame.performerChanged')
            : t('film.frame.performerFailed'),
      );
    } finally {
      settle.current = name;
      setBusy(null);
      crew.reload();
    }
  };
  return (
    <div className="film-field">
      <span className="film-field__label" id={labelId}>
        {t('film.frame.performers')}
      </span>
      <ul ref={list} className="film-performers" aria-labelledby={labelId}>
        {castPerformers(cast, crew.items, snap.byId, crew.characters).map(({ name, performer }) => (
          <li key={name} data-cast={name} tabIndex={-1}>
            <strong>{name}</strong>
            {performer ? (
              <span>{performer}</span>
            ) : (
              <>
                <span className="film-performers__none">{t('film.frame.noPerformer')}</span>
                {canLink && (
                  <button
                    type="button"
                    className="ink-btn ink-btn--ghost"
                    aria-label={t('film.frame.linkPerformer', { name })}
                    aria-haspopup="menu"
                    aria-expanded={picking?.name === name}
                    // Not `disabled`: the focus stays on it while the link is saved.
                    aria-disabled={busy !== null || undefined}
                    onClick={(e) => {
                      if (busy !== null) return;
                      anchor.current = e.currentTarget;
                      const rect = e.currentTarget.getBoundingClientRect();
                      setPicking(
                        picking?.name === name ? null : { name, x: rect.left, y: rect.bottom + 4 },
                      );
                    }}
                  >
                    {t('film.frame.link')}
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {problem && (
        <p className="film-field__hint" role="alert">
          {problem}
        </p>
      )}
      {picking && (
        <ContextMenu
          className="menu--canvas"
          anchor={anchor}
          x={picking.x}
          y={picking.y}
          label={t('film.frame.whoPlays', { name: picking.name })}
          onClose={(reason) => {
            setPicking(null);
            if (reason !== 'outside') anchor.current?.focus();
          }}
          items={
            free.length
              ? free.map((member) => ({
                  label: member.role.trim()
                    ? `${member.name} · ${member.role.trim()}`
                    : member.name,
                  action: () => void link(picking.name, member),
                }))
              : [
                  {
                    label: t('film.frame.noFreeCrew'),
                    disabled: true,
                    hint: t('film.frame.noFreeCrewHint'),
                  },
                ]
          }
        />
      )}
    </div>
  );
}

/**
 * Character cards of the project (search) and of this board, to add to the frame's cast by
 * name (decision 0044). A name already in the cast, ignoring case, shows as linked.
 */
function CastLinks({
  store,
  projectId,
  cast,
  onAdd,
}: {
  store: BoardStore;
  projectId: string;
  cast: readonly string[];
  onAdd: (name: string) => void;
}) {
  const { t } = useTranslation();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<string[]>([]);
  const filterId = useId();
  // The project's characters, by name; past the first page, typing finds the rest.
  useEffect(() => {
    let live = true;
    const words = query.trim();
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({
          type: 'character',
          projectId,
          limit: String(CAST_PAGE),
          ...(words ? { q: words } : {}),
        });
        api
          .get<SearchResult>(`/search?${params}`)
          .then((r) => live && setFound(r.items.map((hit) => hit.title)))
          .catch(() => {});
      },
      words ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [projectId, query]);
  const needle = query.trim().toLocaleLowerCase();
  const here = [...snap.byId.values()].flatMap((el) =>
    el.type === 'character' && el.name.toLocaleLowerCase().includes(needle) ? [el.name] : [],
  );
  const seen = new Set<string>();
  const names = [...here, ...found]
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n.toLocaleLowerCase()) && seen.add(n.toLocaleLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  if (names.length === 0 && !needle) return null;
  const inCast = new Set(cast.map((c) => c.toLocaleLowerCase()));
  return (
    <div className="film-field">
      <label className="film-field__label" htmlFor={filterId}>
        {t('film.frame.castLinks')}
      </label>
      <Input
        id={filterId}
        type="search"
        value={query}
        placeholder={t('film.frame.castFilter')}
        onChange={(e) => setQuery(e.target.value.slice(0, 200))}
      />
      {names.length === 0 ? (
        <p className="film-field__hint">{t('film.frame.castNone')}</p>
      ) : (
        <ul className="film-cast__links">
          {names.map((name) => {
            const linked = inCast.has(name.toLocaleLowerCase());
            return (
              <li key={name}>
                <button
                  type="button"
                  className={`film-cast__link${linked ? ' is-linked' : ''}`}
                  aria-label={t(linked ? 'film.frame.castLinked' : 'film.frame.castLink', {
                    name,
                  })}
                  disabled={linked}
                  onClick={() => onAdd(name.slice(0, 80))}
                >
                  <Icon name={linked ? 'check' : 'user'} size={12} />
                  {name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Characters listed before typing; the search finds the others. */
const CAST_PAGE = 50;

const PREVIEW_THREADS = 3;

/**
 * The open comment threads of the frame, newest first, from the board's comments; the full
 * thread opens in the comments panel. Nothing on the guest page nor while a version is shown.
 */
function FrameComments({ elementId }: { elementId: string }) {
  const { t } = useTranslation();
  const guest = useContext(GuestModeContext);
  const available = useReviews((s) => !!s.boardId && !s.preview);
  const open = useReviews((s) => s.counts.get(elementId)?.open ?? 0);
  const all = useReviews((s) => s.threads);
  if (guest || !available) return null;
  const threads = all
    .filter((th) => th.elementId === elementId && !th.resolvedAt && !th.deletedAt)
    .slice(0, PREVIEW_THREADS);
  return (
    <section className="film-comments" aria-labelledby={`comments-${elementId}`}>
      <div className="film-comments__head">
        <h3 id={`comments-${elementId}`}>{t('film.frame.comments')}</h3>
        {open > 0 && <span>{t('film.frame.commentsCount', { count: open })}</span>}
      </div>
      {threads.length === 0 ? (
        <p className="film-comments__empty">{t('film.frame.commentsNone')}</p>
      ) : (
        <ul>
          {threads.map((th) => (
            <li key={th.id}>
              <button
                type="button"
                className="film-comments__thread"
                onClick={() => openComments({ elementId, threadId: th.id })}
              >
                <strong>{authorName(th.author) ?? t('comments.deletedAuthor')}</strong>
                <span>{editableText(th)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" icon="comment" onClick={() => openComments({ elementId })}>
        {t('film.frame.commentsOpen')}
      </Button>
    </section>
  );
}
