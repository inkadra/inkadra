import {
  addTodoItem,
  formatDuration,
  isContainer,
  removeTodoItem,
  updateElement,
  updateTodoItem,
} from '@inkadra/canvas-core';
import { CARD_COLORS, type ContentCounts, contentCounts, type Element } from '@inkadra/doc-schema';
import type { Person, ProjectMember } from '@inkadra/shared';
import { Checkbox, fadeOutCopy, Icon, ProjectGlyph } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import {
  type CSSProperties,
  type KeyboardEvent,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';
import { api } from '../lib/api.ts';
import { pickVariant, useAsset } from './assets.ts';
import { canRenameBoard, renameBoard } from './boards.ts';
import { CardCaption } from './CardCaption.tsx';
import { CardReview } from './CardReview.tsx';
import { CroppedImage } from './CroppedImage.tsx';
import { CardExtrasContext, GuestModeContext, useBoard } from './context.ts';
import { FileCard, RawImageFooter } from './FileCard.tsx';
import { useBoardAspect } from './film/aspect.ts';
import { FramePicture } from './film/FramePicture.tsx';
import { StoryPicture } from './film/StoryCardPanel.tsx';
import { useSlugline } from './film/storyboard-data.ts';
import { GuestVisibility } from './guest-visibility.tsx';
import { ImageCropStage } from './ImageCropEditor.tsx';
import { croppedRotatedSize, rotatedBounds } from './image-crop.ts';
import { playInline, stopInline, stopWhenOffscreen, useInlinePlaying } from './inline-player.ts';
import { webUrl } from './links.ts';
import { MapCard } from './MapCard.tsx';
import { useMeasure } from './measure.ts';
import { movingVariantUrl } from './moving.tsx';
import { NoteBody, NoteEditor, useFragment } from './note.tsx';
import { LOCAL } from './store.ts';
import { TableCard } from './TableCard.tsx';
import { TodoAssignment } from './TodoAssignment.tsx';
import { TagList } from './tags.tsx';
import { localPreview, useUploadProgress } from './uploads.ts';
import { isInstagramUrl, videoEmbedUrl } from './youtube.ts';

type Of<T extends Element['type']> = Extract<Element, { type: T }>;

export const NOTE_COLORS = CARD_COLORS;

/** "3 cards · 1 file": what a column or a board holds, under its title. */
export function contentSummary(
  t: TFunction,
  c: Pick<ContentCounts, 'cardCount' | 'fileCount' | 'boardCount'>,
): string {
  return [
    (c.cardCount > 0 || (c.fileCount === 0 && c.boardCount === 0)) &&
      t('board.count.cards', { count: c.cardCount }),
    c.fileCount > 0 && t('board.count.files', { count: c.fileCount }),
    c.boardCount > 0 && t('board.count.boards', { count: c.boardCount }),
  ]
    .filter(Boolean)
    .join(' · ');
}

interface CardProps {
  element: Element;
  selected: boolean;
  /** Offset while being dragged, in world units. */
  offset?: { dx: number; dy: number } | undefined;
  /** Drawn inside a column or the "Non ordinati" drawer instead of on the canvas. */
  nested?: boolean;
  /** The source of a drag that shows a ghost elsewhere. */
  dimmed?: boolean;
  /** Geometry override while resizing. */
  resize?: { x: number; y: number; w: number; h: number } | undefined;
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
  const { store, editing, cropping } = useBoard();
  const extras = useContext(CardExtrasContext);
  const { t } = useTranslation();
  const measure = useMeasure(store, element.id, !nested);
  // A card just added (here, by undo or by someone else) pops in; a deleted one fades out.
  const [entering] = useState(() => store.takeAdded(element.id));
  const node = useRef<HTMLDivElement | null>(null);
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      node.current = el;
      measure(el);
    },
    [measure],
  );
  useLayoutEffect(
    () => () => {
      if (!nested && !store.getSnapshot().byId.has(element.id)) fadeOutCopy(node.current);
    },
    [store, element.id, nested],
  );
  const isEditing = editing === element.id;
  const isCropping = cropping === element.id;
  const w = resize?.w ?? element.w;
  const style: CSSProperties = nested
    ? {}
    : {
        left: resize?.x ?? element.x,
        top: resize?.y ?? element.y,
        width: w,
        height: element.type === 'link' || isCropping ? undefined : (resize?.h ?? element.h),
        transform: offset ? `translate(${offset.dx}px, ${offset.dy}px)` : undefined,
      };
  if (zoom !== undefined) (style as Record<string, unknown>)['--zoom'] = zoom;
  const className = [
    'card',
    `card--${element.type}`,
    nested ? 'card--nested' : 'card--free',
    selected && 'is-selected',
    isEditing && 'is-editing',
    isCropping && 'is-cropping',
    offset && 'is-moving',
    dimmed && 'is-dimmed',
    element.locked && 'is-locked',
    element.type === 'note' && element.color && `card--tint-${element.color}`,
    element.type === 'column' && element.color && `card--accent-${element.color}`,
    entering && 'ink-motion-card',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
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
    case 'character':
      return <CharacterCard element={element} />;
    case 'location':
      return <LocationCard element={element} />;
    case 'section':
      return <SectionCard element={element} editing={editing} />;
    case 'table':
      return <TableCard element={element} editing={editing} />;
    case 'map':
      return <MapCard element={element} width={width} />;
  }
}

/** A section heading: large quiet text over a thin rule, without card chrome (#318). */
function SectionCard({ element, editing }: { element: Of<'section'>; editing: boolean }) {
  const { store, setEditing } = useBoard();
  const { t } = useTranslation();
  return editing ? (
    <input
      className="card__inline-input section__title"
      defaultValue={element.title}
      placeholder={t('board.section.placeholder')}
      // biome-ignore lint/a11y/noAutofocus: the field opens because the user asked to rename
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        updateElement(store.doc, element.id, { title: e.target.value.trim() }, LOCAL);
        setEditing(null);
      }}
      onKeyDown={blurOnEnter}
      maxLength={200}
      aria-label={t('board.section.title')}
    />
  ) : (
    <h2 className={`section__title${element.title ? '' : ' is-empty'}`}>
      {element.title || t('board.section.placeholder')}
    </h2>
  );
}

/** Compact face of a character: portrait, name, role; the rest is in its side sheet. */
function CharacterCard({ element }: { element: Of<'character'> }) {
  const { t } = useTranslation();
  const scenes = element.scenes?.length ?? 0;
  return (
    <div className="card__pad story-card story-card--character">
      <StoryPicture assetId={element.assetId} label={element.name} pixels={112} kind="character" />
      <div className="story-card__text">
        <span className={`card__title${element.name ? '' : ' is-empty'}`}>
          {element.name || t('story.character.namePlaceholder')}
        </span>
        {element.role && <span className="card__desc">{element.role}</span>}
        {(element.actor || scenes > 0) && (
          <span className="story-card__meta">
            {[element.actor, scenes > 0 && t('story.sceneCount', { count: scenes })]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}

/** Compact face of a location: photo, name, INT/EXT and the light to shoot in. */
function LocationCard({ element }: { element: Of<'location'> }) {
  const { t } = useTranslation();
  const scenes = element.scenes?.length ?? 0;
  return (
    <>
      {element.assetId && (
        <StoryPicture assetId={element.assetId} label={element.name} pixels={520} kind="location" />
      )}
      <div className="card__pad story-card story-card--location">
        <div className="story-card__head">
          {!element.assetId && <Icon name="pin" size={14} />}
          <span className={`card__title${element.name ? '' : ' is-empty'}`}>
            {element.name || t('story.location.namePlaceholder')}
          </span>
          {element.setting && (
            <span className="film-chip story-chip">
              {t(`film.scene.settings.${element.setting}`)}
            </span>
          )}
        </div>
        {element.light && <span className="card__desc story-card__light">{element.light}</span>}
        {scenes > 0 && (
          <span className="story-card__meta">{t('story.sceneCount', { count: scenes })}</span>
        )}
      </div>
    </>
  );
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
          shapes={element.shapes}
          referenceOpacity={element.referenceOpacity}
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
  const { scale, largeBoard, cropping } = useBoard();
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
  const baseW = ready?.width && ready.width > 0 ? ready.width : 4;
  const baseH = ready?.height && ready.height > 0 ? ready.height : 3;
  const isCropping = cropping === element.id;
  const dims = isCropping
    ? rotatedBounds(baseW, baseH, element.rotation)
    : croppedRotatedSize(baseW, baseH, element.crop, element.rotation);
  const ratio = `${dims.width} / ${dims.height}`;
  return (
    <>
      <div
        className="card__media"
        style={{
          aspectRatio: element.h && !isCropping && element.parent === null ? undefined : ratio,
        }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {src ? (
          isCropping ? (
            <ImageCropStage
              element={element}
              src={src}
              alt={element.caption ?? ready?.filename ?? ''}
              baseWidth={baseW}
              baseHeight={baseH}
            />
          ) : (
            <CroppedImage
              poster={src}
              moving={moving}
              alt={element.caption ?? ready?.filename ?? ''}
              width={baseW}
              height={baseH}
              crop={element.crop}
              rotation={element.rotation}
            />
          )
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
      {ready && <RawImageFooter asset={ready} />}
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

/**
 * The player takes the place of the thumbnail, inside a frame a few pixels wide: the frame and
 * the title below drag the card. Holding Alt lays a shield over the player, so the card can be
 * dragged from anywhere. shortcut: while the player has keyboard focus the page never sees Alt;
 * the frame still drags then.
 */
function InlineVideo({
  element,
  embedUrl,
  title,
  instagram,
}: {
  element: Of<'link'>;
  embedUrl: string;
  title: string;
  instagram: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const [alt, setAlt] = useState(false);
  const id = element.id;
  useEffect(() => {
    mounted.current = true;
    const stop = () => stopInline(id);
    const onKey = (event: { key: string; altKey: boolean }) => {
      if (event.key === 'Escape') stop();
      setAlt(event.altKey);
    };
    const onBlur = () => setAlt(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    // Far off-screen means more than a screen away: a small pan keeps the video running.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && !entry.isIntersecting) stopWhenOffscreen(id);
      },
      { rootMargin: '100% 100% 100% 100%' },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      observer.disconnect();
      mounted.current = false;
      // StrictMode remounts at once: only a card that really went away stops.
      queueMicrotask(() => {
        if (!mounted.current) stop();
      });
    };
  }, [id]);
  return (
    <div
      className={`card__media card__media--link card__embed${instagram ? ' card__embed--portrait' : ''}`}
      ref={ref}
    >
      <iframe
        src={embedUrl}
        title={t('board.menu.videoPlayer', { title })}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
      />
      {alt && <div className="card__shield" />}
      {!instagram && <OpenOutButton element={element} instagram={false} />}
    </div>
  );
}

/** ↗ on a playing card: the viewer for a video, Instagram for a post. */
function OpenOutButton({ element, instagram }: { element: Of<'link'>; instagram: boolean }) {
  const { t } = useTranslation();
  const { openElement } = useBoard();
  const label = t(instagram ? 'board.menu.openOnInstagram' : 'board.menu.openInViewer');
  return (
    <button
      type="button"
      className="card__expand"
      data-no-drag
      data-play-link={element.id}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        stopInline(element.id);
        openElement?.(element);
      }}
    >
      <Icon name="arrow" size={14} />
    </button>
  );
}

function LinkCard({ element, width }: { element: Of<'link'>; width: number }) {
  const { t } = useTranslation();
  const { scale } = useBoard();
  const image = useAsset(element.imageAssetId);
  const playing = useInlinePlaying(element.id);
  const ready = image && image !== 'missing' ? image : null;
  const src = ready ? pickVariant(ready, width * scale * (window.devicePixelRatio || 1)) : '';
  const href = webUrl(element.url);
  const title = element.title || (href ? new URL(href).hostname : element.url);
  const embedUrl = videoEmbedUrl(element.url);
  const instagram = isInstagramUrl(element.url);
  const host = href ? (
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
  );
  return (
    <>
      {embedUrl && playing ? (
        <InlineVideo element={element} embedUrl={embedUrl} title={title} instagram={instagram} />
      ) : src || embedUrl ? (
        <div className={`card__media card__media--link${src ? '' : ' card__video'}`}>
          {src && <img src={src} alt="" draggable={false} decoding="async" />}
          {embedUrl && (
            <button
              type="button"
              className="card__play"
              data-no-drag
              data-play-link={element.id}
              onClick={(event) => {
                event.stopPropagation();
                playInline(element.id);
              }}
              aria-label={t('board.menu.playLink', { title })}
            >
              <Icon name="play" size={16} />
            </button>
          )}
          {instagram && <span className="card__badge">{t('board.menu.instagram')}</span>}
        </div>
      ) : null}
      <div className="card__pad card__link">
        <span className="card__title">{element.title || shortUrl(element.url)}</span>
        {element.description && <span className="card__desc">{element.description}</span>}
        {embedUrl && playing && instagram ? (
          // Instagram's embed fills its picture with its own bars: ↗ waits below, by the host.
          <div className="card__host-row">
            {host}
            <OpenOutButton element={element} instagram />
          </div>
        ) : (
          host
        )}
      </div>
    </>
  );
}

function TodoCard({ element, editing }: { element: Of<'todo'>; editing: boolean }) {
  const { store, readOnly, projectId } = useBoard();
  const guest = useContext(GuestModeContext);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleFailed, setPeopleFailed] = useState(false);
  useEffect(() => {
    if (guest) return;
    let alive = true;
    api
      .get<{ items: ProjectMember[] }>(`/projects/${projectId}/members`)
      .then((r) => {
        if (alive) {
          setPeople(r.items.map((m) => ({ ...m.user, email: null })));
          setPeopleFailed(false);
        }
      })
      .catch(() => {
        if (alive) setPeopleFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [projectId, guest]);
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [assigning, setAssigning] = useState<string | null>(null);
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
            <Checkbox
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
                onKeyDown={(e) => {
                  if (e.key === '@') {
                    e.preventDefault();
                    setAssigning(item.id);
                  } else blurOnEnter(e);
                }}
                aria-label={t('board.todo.item')}
              />
            ) : (
              <span>{item.text}</span>
            )}
            <TodoAssignment
              people={people}
              failed={peopleFailed}
              elementId={element.id}
              item={item}
              editing={editing}
              open={assigning === item.id}
              onClose={() => setAssigning(null)}
            />
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
  const { boards, boardCounts, projectId, setEditing, readOnly } = useBoard();
  const { t } = useTranslation();
  const board = boards?.find((b) => b.id === element.boardId);
  const title = board?.title ?? t('board.board.unknown');
  const counts = boardCounts?.get(element.boardId);
  const icon = board?.icon;
  // The board's own symbol on a tile of its colour, as the project appearance shows it (#322).
  const tile =
    icon && !icon.emoji && icon.color !== 'neutral'
      ? ({ '--board-bg': `var(--ink-tag-${icon.color}-bg)` } as CSSProperties)
      : undefined;
  return (
    <div className="card__board">
      <span className="card__board-tile" style={tile} aria-hidden="true">
        {icon ? (
          <ProjectGlyph {...icon} />
        ) : (
          <Icon
            name={board?.kind === 'storyboard' ? 'storyboard' : 'board'}
            contentKind={board?.kind ?? 'board'}
            size={20}
          />
        )}
      </span>
      <span className="card__board-text">
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
          {/* A storyboard keeps its kind before the count: "Storyboard · 12 cards". */}
          {[
            (board?.kind === 'storyboard' || !counts) &&
              t(board?.kind === 'storyboard' ? 'board.types.storyboard' : 'board.types.board'),
            counts &&
              contentSummary(t, {
                cardCount: counts.cardCount ?? counts.elementCount,
                fileCount: counts.fileCount ?? 0,
                boardCount: counts.boardCount ?? 0,
              }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
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
        ) : scene && slugline(scene) ? (
          // The slugline keeps one line; the scene's own title sits under it, quieter.
          <span
            className="column__title column__title--scene"
            title={[slugline(scene), element.title].filter(Boolean).join(' · ')}
          >
            <span className="column__slug">{slugline(scene)}</span>
            {element.title && <span className="column__name">{element.title}</span>}
          </span>
        ) : scene ? (
          <span className="column__title">{element.title}</span>
        ) : (
          <span className="column__heading">
            <span className="column__title">{element.title || t('board.column.untitled')}</span>
            <span className="column__summary">{contentSummary(t, contentCounts(items))}</span>
          </span>
        )}
        {scene && <span className="column__count">{items.length}</span>}
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
