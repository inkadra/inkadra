import {
  addTodoItem,
  formatDuration,
  isContainer,
  removeTodoItem,
  updateElement,
  updateTodoItem,
} from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { Icon } from '@inkadra/ui';
import {
  type CSSProperties,
  type KeyboardEvent,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';
import { pickVariant, useAsset } from './assets.ts';
import { canRenameBoard, renameBoard } from './boards.ts';
import { CardCaption } from './CardCaption.tsx';
import { CardReview } from './CardReview.tsx';
import { CardExtrasContext, GuestModeContext, useBoard } from './context.ts';
import { useBoardAspect } from './film/aspect.ts';
import { FramePicture } from './film/FramePicture.tsx';
import { useSlugline } from './film/StoryboardView.tsx';
import { GuestVisibility } from './guest-visibility.tsx';
import { webUrl } from './links.ts';
import { useMeasure } from './measure.ts';
import { MovingPicture, movingVariantUrl } from './moving.tsx';
import { NoteBody, NoteEditor, useFragment } from './note.tsx';
import { LOCAL } from './store.ts';
import { TagList } from './tags.tsx';
import { localPreview, useUploadProgress } from './uploads.ts';
import { isYoutubeUrl } from './youtube.ts';

type Of<T extends Element['type']> = Extract<Element, { type: T }>;

export const NOTE_COLORS = ['blue', 'orange', 'purple', 'green'] as const;

interface CardProps {
  element: Element;
  selected: boolean;
  /** Offset while being dragged, in world units. */
  offset?: { dx: number; dy: number } | undefined;
  /** Drawn inside a column or the "Non ordinati" drawer instead of on the canvas. */
  nested?: boolean;
  /** The source of a drag that shows a ghost elsewhere. */
  dimmed?: boolean;
  /** Width override while resizing. */
  resize?: { x: number; w: number } | undefined;
  /** Children of a column. */
  childrenOf?: readonly Element[] | undefined;
  selection?: ReadonlySet<string>;
  draggingIds?: ReadonlySet<string>;
  /**
   * Current zoom, for the outlines and handles that keep a constant screen size. Only cards
   * that draw them get it: a zoom change then restyles a handful of cards, not the board.
   */
  zoom?: number | undefined;
}

export const Card = memo(function Card({
  element,
  selected,
  offset,
  nested,
  dimmed,
  resize,
  childrenOf,
  selection,
  draggingIds,
  zoom,
}: CardProps) {
  const { store, editing, readOnly } = useBoard();
  const extras = useContext(CardExtrasContext);
  const { t } = useTranslation();
  const measure = useMeasure(store, element.id, !nested);
  const isEditing = editing === element.id;
  const w = resize?.w ?? element.w;
  const style: CSSProperties = nested
    ? {}
    : {
        left: resize?.x ?? element.x,
        top: element.y,
        width: w,
        height: element.h,
        transform: offset ? `translate(${offset.dx}px, ${offset.dy}px)` : undefined,
      };
  if (zoom !== undefined) (style as Record<string, unknown>)['--zoom'] = zoom;
  const className = [
    'card',
    `card--${element.type}`,
    nested ? 'card--nested' : 'card--free',
    selected && 'is-selected',
    isEditing && 'is-editing',
    offset && 'is-moving',
    dimmed && 'is-dimmed',
    element.locked && 'is-locked',
    element.type === 'note' && element.color && `card--tint-${element.color}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={measure}
      className={className}
      style={style}
      data-el={element.id}
      data-type={element.type}
      data-nested={nested ? '' : undefined}
    >
      <CardBody
        element={element}
        editing={isEditing}
        selected={selected}
        width={w}
        childrenOf={childrenOf}
        selection={selection}
        draggingIds={draggingIds}
      />
      {!isContainer(element) && element.tags && element.tags.length > 0 && (
        <div className="card__tags">
          <TagList tags={element.tags} />
        </div>
      )}
      {!isContainer(element) && <GuestVisibility store={store} element={element} />}
      {extras?.(element)}
      {element.locked && (
        <span className="card__lock" title={t('board.locked')}>
          <Icon name="lock" size={12} />
        </span>
      )}
      <CardReview elementId={element.id} shifted={!!element.locked} />
      {selected && !nested && !element.locked && !readOnly && (
        <>
          <span className="card__handle card__handle--w" data-handle="w" aria-hidden="true" />
          <span className="card__handle card__handle--e" data-handle="e" aria-hidden="true" />
        </>
      )}
    </div>
  );
});

function CardBody({
  element,
  editing,
  selected,
  width,
  childrenOf,
  selection,
  draggingIds,
}: {
  element: Element;
  editing: boolean;
  selected: boolean;
  width: number;
  childrenOf?: readonly Element[] | undefined;
  selection?: ReadonlySet<string> | undefined;
  draggingIds?: ReadonlySet<string> | undefined;
}) {
  switch (element.type) {
    case 'note':
      return <NoteCard element={element} editing={editing} />;
    case 'image':
      return <ImageCard element={element} width={width} selected={selected} />;
    case 'link':
      return <LinkCard element={element} width={width} />;
    case 'file':
      return <FileCard element={element} width={width} />;
    case 'todo':
      return <TodoCard element={element} editing={editing} />;
    case 'color':
      return <ColorCard element={element} editing={editing} />;
    case 'board':
      return <BoardCard element={element} editing={editing} />;
    case 'column':
    case 'scene':
      return (
        <ColumnCard
          element={element}
          editing={editing}
          items={childrenOf ?? []}
          selection={selection}
          draggingIds={draggingIds}
        />
      );
    case 'frame':
      return <FrameCard element={element} width={width} />;
    case 'arrow':
      // Drawn by the arrow layer, not as a card.
      return null;
  }
}

function FrameCard({ element, width }: { element: Of<'frame'>; width: number }) {
  const { store, scale, frameLabels } = useBoard();
  const guest = useContext(GuestModeContext);
  const { t } = useTranslation();
  const boardAspect = useBoardAspect(store.doc);
  const label = frameLabels.get(element.id) ?? element.label ?? '';
  return (
    <>
      <div className="card__frame">
        <FramePicture
          assetId={element.assetId}
          aspect={element.aspect}
          boardAspect={boardAspect}
          strokes={element.strokes}
          pixels={width * scale * (window.devicePixelRatio || 1)}
        />
      </div>
      <div className="card__pad card__frame-meta">
        <span className="card__title">{label}</span>
        {!guest && (
          <span className={`film-chip film-status--${element.status ?? 'draft'}`}>
            {t(`film.status.${element.status ?? 'draft'}`)}
          </span>
        )}
        {element.durationMs !== undefined && (
          <span className="card__desc">{formatDuration(element.durationMs)}</span>
        )}
      </div>
      {element.action && <div className="card__caption">{element.action}</div>}
    </>
  );
}

function NoteCard({ element, editing }: { element: Of<'note'>; editing: boolean }) {
  const { store, setEditing, setNoteEditor } = useBoard();
  const { t } = useTranslation();
  const body = store.map(element.id)?.get('body');
  // Follows the text here too: a note someone else just created is empty until they type.
  useFragment(body instanceof Y.XmlFragment ? body : null);
  if (!(body instanceof Y.XmlFragment)) return null;
  if (editing) {
    return (
      <div className="card__pad" data-no-drag>
        <NoteEditor
          fragment={body}
          onReady={setNoteEditor}
          onExit={() => {
            setNoteEditor(null);
            setEditing(null);
          }}
        />
      </div>
    );
  }
  return (
    <div className="card__pad">
      {body.length === 0 ? (
        <span className="ink-muted">{t('board.note.empty')}</span>
      ) : (
        <NoteBody fragment={body} />
      )}
    </div>
  );
}

function ImageCard({
  element,
  width,
  selected,
}: {
  element: Of<'image'>;
  width: number;
  selected: boolean;
}) {
  const { scale, largeBoard } = useBoard();
  const { t } = useTranslation();
  const asset = useAsset(element.assetId);
  const progress = useUploadProgress(element.assetId);
  const ready = asset && asset !== 'missing' ? asset : null;
  const [hover, setHover] = useState(false);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const src =
    localPreview(element.assetId) ?? (ready ? pickVariant(ready, width * scale * dpr) : '');
  // A board with many cards keeps the posters and plays a GIF only on hover or selection.
  const moving =
    ready && (!largeBoard || selected || hover)
      ? movingVariantUrl(ready, width * scale * dpr)
      : null;
  const ratio = ready?.width && ready.height ? `${ready.width} / ${ready.height}` : '4 / 3';
  return (
    <>
      <div
        className="card__media"
        style={{ aspectRatio: element.h ? undefined : ratio }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {src ? (
          <MovingPicture
            poster={src}
            moving={moving}
            alt={element.caption ?? ready?.filename ?? ''}
          />
        ) : (
          <span className="card__media-state">
            <Icon name="image" />
            {asset === 'missing' || ready?.status === 'failed'
              ? t('board.image.failed')
              : t('board.image.processing')}
          </span>
        )}
        {progress !== null && (
          <span
            className="card__progress"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
          >
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </div>
      <CardCaption element={element} />
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function shortUrl(url: string): string {
  const text = url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function LinkCard({ element, width }: { element: Of<'link'>; width: number }) {
  const { scale } = useBoard();
  const image = useAsset(element.imageAssetId);
  const ready = image && image !== 'missing' ? image : null;
  const src = ready ? pickVariant(ready, width * scale * (window.devicePixelRatio || 1)) : '';
  const href = webUrl(element.url);
  const isYoutube = isYoutubeUrl(element.url);
  return (
    <>
      {src ? (
        <div className="card__media card__media--link">
          <img src={src} alt="" draggable={false} decoding="async" />
          {isYoutube && (
            <span className="card__play" aria-hidden="true">
              <Icon name="play" size={16} />
            </span>
          )}
        </div>
      ) : isYoutube ? (
        <div className="card__media card__media--link card__video">
          <span className="card__play" aria-hidden="true">
            <Icon name="play" size={16} />
          </span>
        </div>
      ) : null}
      <div className="card__pad card__link">
        <span className="card__title">{element.title || shortUrl(element.url)}</span>
        {element.description && <span className="card__desc">{element.description}</span>}
        {href ? (
          <a
            className="card__host"
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            data-no-drag
          >
            <Icon name="link" size={12} />
            {hostOf(element.url)}
          </a>
        ) : (
          <span className="card__host">{element.url}</span>
        )}
      </div>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function FileCard({ element, width }: { element: Of<'file'>; width: number }) {
  const { t } = useTranslation();
  const { scale } = useBoard();
  const asset = useAsset(element.assetId);
  const progress = useUploadProgress(element.assetId);
  const ready = asset && asset !== 'missing' ? asset : null;
  if (ready?.kind === 'video' && progress === null) {
    const poster = pickVariant(ready, width * scale * (window.devicePixelRatio || 1));
    return (
      <>
        <div
          className="card__media card__video"
          style={{
            aspectRatio:
              ready.width && ready.height ? `${ready.width} / ${ready.height}` : '16 / 9',
          }}
        >
          {poster && ready.variants.length > 0 && (
            <img src={poster} alt={ready.filename} draggable={false} decoding="async" />
          )}
          <span className="card__play" aria-hidden="true">
            <Icon name="play" size={16} />
          </span>
          {ready.durationMs !== null && (
            <span className="card__duration">{formatDuration(ready.durationMs)}</span>
          )}
        </div>
        <div className="card__caption">{ready.filename}</div>
        <CardCaption element={element} />
      </>
    );
  }
  const ext = ready?.filename.split('.').pop()?.slice(0, 4).toUpperCase() ?? '';
  return (
    <>
      <div className="card__pad card__file">
        <span className="card__file-tile" aria-hidden="true">
          {ext || <Icon name="file" size={14} />}
        </span>
        <span className="card__file-meta">
          <span className="card__title">
            {ready ? ready.filename || t('board.types.file') : t('board.file.loading')}
          </span>
          <span className="card__desc">
            {progress !== null
              ? t('board.file.uploading', { percent: Math.round(progress * 100) })
              : ready
                ? ready.size > 0
                  ? formatSize(ready.size)
                  : ''
                : asset === 'missing'
                  ? t('board.file.missing')
                  : ''}
          </span>
        </span>
      </div>
      <CardCaption element={element} />
    </>
  );
}

function TodoCard({ element, editing }: { element: Of<'todo'>; editing: boolean }) {
  const { store, readOnly } = useBoard();
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const done = element.items.filter((i) => i.done).length;
  const addRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) addRef.current?.focus();
  }, [editing]);

  function add() {
    const text = draft.trim();
    if (!text) return;
    addTodoItem(store.doc, element.id, text, undefined, LOCAL);
    setDraft('');
  }

  return (
    <div className="card__pad card__todo">
      <div className="card__todo-head">
        {editing ? (
          <input
            className="card__inline-input card__title"
            defaultValue={element.title ?? ''}
            placeholder={t('board.todo.titlePlaceholder')}
            onBlur={(e) =>
              updateElement(
                store.doc,
                element.id,
                { title: e.target.value.trim() || undefined },
                LOCAL,
              )
            }
            onKeyDown={blurOnEnter}
            aria-label={t('board.todo.title')}
          />
        ) : (
          <span className="card__title">{element.title || t('board.types.todo')}</span>
        )}
        {element.items.length > 0 && (
          <span className="card__desc">
            {done}/{element.items.length}
          </span>
        )}
      </div>
      <ul className="card__todo-list">
        {element.items.map((item) => (
          <li key={item.id} className={item.done ? 'is-done' : undefined}>
            <input
              type="checkbox"
              checked={item.done}
              disabled={readOnly}
              onChange={(e) =>
                updateTodoItem(store.doc, element.id, item.id, { done: e.target.checked }, LOCAL)
              }
              aria-label={item.text}
              data-no-drag
            />
            {editing ? (
              <input
                className="card__inline-input"
                defaultValue={item.text}
                onBlur={(e) => {
                  const text = e.target.value.trim();
                  if (text) updateTodoItem(store.doc, element.id, item.id, { text }, LOCAL);
                  else removeTodoItem(store.doc, element.id, item.id, LOCAL);
                }}
                onKeyDown={blurOnEnter}
                aria-label={t('board.todo.item')}
              />
            ) : (
              <span>{item.text}</span>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <input
          ref={addRef}
          className="card__inline-input card__todo-add"
          value={draft}
          placeholder={t('board.todo.add')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          aria-label={t('board.todo.add')}
        />
      )}
    </div>
  );
}

function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter' || e.key === 'Escape') {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

function ColorCard({ element, editing }: { element: Of<'color'>; editing: boolean }) {
  const { store } = useBoard();
  const { t } = useTranslation();
  return (
    <>
      <div className="card__swatch" style={{ background: element.hex }}>
        {editing && (
          <input
            type="color"
            value={element.hex.toLowerCase()}
            onChange={(e) =>
              updateElement(store.doc, element.id, { hex: e.target.value.toUpperCase() }, LOCAL)
            }
            aria-label={t('board.color.pick')}
            data-no-drag
          />
        )}
      </div>
      <div className="card__pad card__color-meta">
        {editing ? (
          <input
            className="card__inline-input"
            defaultValue={element.label ?? ''}
            placeholder={t('board.color.labelPlaceholder')}
            onBlur={(e) =>
              updateElement(
                store.doc,
                element.id,
                { label: e.target.value.trim() || undefined },
                LOCAL,
              )
            }
            onKeyDown={blurOnEnter}
            aria-label={t('board.color.label')}
          />
        ) : (
          element.label && <span className="card__title">{element.label}</span>
        )}
        <span className="card__desc ink-mono">{element.hex}</span>
      </div>
    </>
  );
}

function BoardCard({ element, editing }: { element: Of<'board'>; editing: boolean }) {
  const { boards, projectId, setEditing, readOnly } = useBoard();
  const { t } = useTranslation();
  const board = boards?.find((b) => b.id === element.boardId);
  const title = board?.title ?? t('board.board.unknown');
  return (
    <div className="card__board">
      <span className="card__board-tile" aria-hidden="true">
        <Icon name={board?.kind === 'storyboard' ? 'storyboard' : 'board'} size={22} />
      </span>
      {editing && board && !readOnly && !element.locked && canRenameBoard(board) ? (
        <input
          className="card__inline-input card__title"
          defaultValue={board.title}
          // biome-ignore lint/a11y/noAutofocus: the field opens because the user asked to rename
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const value = e.target.value.trim();
            setEditing(null);
            if (value && value !== board.title)
              void renameBoard(projectId, board.id, value).catch(() => {});
          }}
          // Escape leaves the field keeping what was typed, like every other card field: a new
          // board is named by typing and pressing Escape.
          onKeyDown={blurOnEnter}
          maxLength={200}
          aria-label={t('board.board.title')}
        />
      ) : (
        <span className="card__title">{title}</span>
      )}
      <span className="card__desc">
        {board?.kind === 'storyboard' ? t('board.types.storyboard') : t('board.types.board')}
      </span>
    </div>
  );
}

function ColumnCard({
  element,
  editing,
  items,
  selection,
  draggingIds,
}: {
  element: Of<'column'> | Of<'scene'>;
  editing: boolean;
  items: readonly Element[];
  selection?: ReadonlySet<string> | undefined;
  draggingIds?: ReadonlySet<string> | undefined;
}) {
  const { store, setEditing, readOnly } = useBoard();
  const { t } = useTranslation();
  const slugline = useSlugline();
  const scene = element.type === 'scene' ? element : null;
  return (
    <>
      <div className="column__head">
        {scene && <span className="column__number">{scene.number}</span>}
        {editing ? (
          <input
            className="card__inline-input column__title"
            defaultValue={element.title}
            placeholder={t('board.column.titlePlaceholder')}
            // biome-ignore lint/a11y/noAutofocus: the field opens because the user asked to rename
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              updateElement(store.doc, element.id, { title: e.target.value.trim() }, LOCAL);
              setEditing(null);
            }}
            onKeyDown={blurOnEnter}
            aria-label={t('board.column.title')}
          />
        ) : (
          <span className="column__title">
            {scene && slugline(scene) && <span className="column__slug">{slugline(scene)}</span>}
            {element.title || (scene ? '' : t('board.column.untitled'))}
          </span>
        )}
        <span className="column__count">{items.length}</span>
        <GuestVisibility store={store} element={element} />
        <button
          type="button"
          className="column__toggle"
          aria-expanded={!element.collapsed}
          aria-label={element.collapsed ? t('board.column.expand') : t('board.column.collapse')}
          disabled={readOnly}
          onClick={() =>
            updateElement(
              store.doc,
              element.id,
              { collapsed: element.collapsed ? undefined : true },
              LOCAL,
            )
          }
        >
          <Icon name="chevronDown" size={14} />
        </button>
      </div>
      {!element.collapsed && (
        <div className="column__body" data-column={element.id}>
          {items.map((child) => (
            <Card
              key={child.id}
              element={child}
              nested
              selected={selection?.has(child.id) ?? false}
              dimmed={draggingIds?.has(child.id)}
            />
          ))}
          {items.length === 0 && <div className="column__empty">{t('board.column.empty')}</div>}
        </div>
      )}
    </>
  );
}
