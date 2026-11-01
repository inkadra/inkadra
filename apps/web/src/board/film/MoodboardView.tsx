// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, frameLabels, storyboardOf } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { Button, EmptyState, Icon } from '@inkadra/ui';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useClassifications } from '../../lib/classifications.ts';
import { pickVariant, useAsset } from '../assets.ts';
import { CroppedImage } from '../CroppedImage.tsx';
import { UploadPanel } from '../chrome.tsx';
import { uploadBoardId } from '../frame-grab.ts';
import { hasImageTransform } from '../image-crop.ts';
import { fillLinkPreview, webUrl } from '../links.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { normaliseTag } from '../tags.tsx';
import { startUpload } from '../uploads.ts';
import { MediaViewer } from '../viewer.tsx';
import './film.css';

export type Reference = Extract<Element, { type: 'image' | 'link' | 'color' }>;
export type MediaReference = Exclude<Reference, { type: 'color' }>;

export function referencesOf(elements: readonly Element[], tag = ''): Reference[] {
  return elements
    .filter(
      (el): el is Reference =>
        (el.type === 'image' || el.type === 'color' || (el.type === 'link' && !!el.imageAssetId)) &&
        (!tag || (el.tags ?? []).some((value) => normaliseTag(value) === normaliseTag(tag))),
    )
    .sort((a, b) => a.z.localeCompare(b.z) || a.id.localeCompare(b.id));
}

function ReferenceImage({ element }: { element: MediaReference }) {
  const { t } = useTranslation();
  const asset = useAsset(element.type === 'image' ? element.assetId : element.imageAssetId);
  const label = element.type === 'image' ? element.caption : element.title || element.url;
  const src = asset && asset !== 'missing' ? pickVariant(asset, 640) : '';
  if (!asset || asset === 'missing' || !src) {
    return (
      <span className="moodboard__placeholder">
        {t(
          asset === 'missing' || asset?.status === 'failed'
            ? 'moodboard.unavailable'
            : 'moodboard.loading',
        )}
      </span>
    );
  }
  if (element.type === 'image' && hasImageTransform(element)) {
    return (
      <CroppedImage
        poster={src}
        alt={label || asset.filename}
        width={asset.width}
        height={asset.height}
        crop={element.crop}
        rotation={element.rotation}
      />
    );
  }
  return (
    <img
      src={src}
      alt={label || asset.filename}
      loading="lazy"
      width={asset.width ?? undefined}
      height={asset.height ?? undefined}
    />
  );
}

/** The site a link points at, without "www.": what the tile shows under the title. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Below everything on the board, so a reference added here never lands on another card. */
function freeSpot(elements: readonly Element[]) {
  const bottom = elements
    .filter((el) => !el.parent)
    .reduce((max, el) => Math.max(max, el.y + (el.h ?? 200)), 0);
  return { x: 0, y: bottom + 40 };
}

type Adding = null | 'menu' | 'link';

/** "+ Add": the three ways to put a reference on the board that the canvas already has. */
function AddReferences({
  store,
  projectId,
  userId,
  onNotice,
}: {
  store: BoardStore;
  projectId: string;
  userId: string;
  onNotice: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState<Adding>(null);
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const files = useRef<HTMLInputElement | null>(null);
  const color = useRef<HTMLInputElement | null>(null);
  const menuId = useId();
  const boardId = uploadBoardId(store) ?? '';
  const at = () => freeSpot([...store.getSnapshot().byId.values()]);
  const opts = { userId, origin: LOCAL };

  useEffect(() => {
    if (!adding) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setAdding(null);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setAdding(null);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', onKey);
    };
  }, [adding]);

  // The native `change` fires when a color is chosen; React's onChange fires on every step of
  // the picker's drag, which would add a card for each.
  useEffect(() => {
    const input = color.current;
    if (!input) return;
    const chosen = () => {
      createElement(store.doc, 'color', at(), { hex: input.value.toUpperCase() }, opts);
      store.undo.stopCapturing();
    };
    input.addEventListener('change', chosen);
    return () => input.removeEventListener('change', chosen);
  });

  const upload = (picked: File[]) => {
    picked.forEach((file, i) => {
      startUpload({
        file,
        projectId,
        boardId,
        onAsset: (assetId) => {
          const known = [...store.getSnapshot().byId.values()].some(
            (el) => el.type === 'image' && el.assetId === assetId,
          );
          if (known) return;
          createElement(store.doc, 'image', at(), { assetId }, opts);
          store.undo.stopCapturing();
        },
        onFailed: (assetId) => {
          if (!assetId) onNotice(t('board.errors.upload', { name: file.name }));
        },
      });
      if (i === 0) onNotice('');
    });
  };

  const addLink = () => {
    const typed = url.trim();
    const href = webUrl(/^[a-z]+:\/\//i.test(typed) ? typed : `https://${typed}`);
    if (!typed || !href) {
      setInvalid(true);
      return;
    }
    const el = createElement(store.doc, 'link', at(), { url: href }, opts);
    store.undo.stopCapturing();
    setAdding(null);
    setUrl('');
    // A link shows in the gallery once it has a picture: say so when the server finds none.
    void fillLinkPreview(store.doc, el.id, projectId, boardId, href).then((ok) => {
      if (!ok) onNotice(t('moodboard.noPreview'));
    });
  };

  return (
    <div className="moodboard__add" ref={root}>
      <Button
        icon="plus"
        aria-haspopup="menu"
        aria-expanded={adding !== null}
        aria-controls={menuId}
        onClick={() => setAdding(adding ? null : 'menu')}
      >
        {t('moodboard.add')}
      </Button>
      <input
        ref={files}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="moodboard-files"
        onChange={(event) => {
          upload([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      <input
        ref={color}
        type="color"
        defaultValue="#808086"
        hidden
        tabIndex={-1}
        aria-label={t('moodboard.addColor')}
        data-testid="moodboard-color"
      />
      {adding && (
        <div className="moodboard__popover" id={menuId}>
          {adding === 'menu' ? (
            <div role="menu" aria-label={t('moodboard.add')}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdding(null);
                  files.current?.click();
                }}
              >
                <Icon name="upload" size={16} />
                {t('moodboard.addImage')}
              </button>
              <button type="button" role="menuitem" onClick={() => setAdding('link')}>
                <Icon name="link" size={16} />
                {t('moodboard.addLink')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdding(null);
                  color.current?.click();
                }}
              >
                <Icon name="color" size={16} />
                {t('moodboard.addColor')}
              </button>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addLink();
              }}
            >
              <input
                className="ink-input"
                // biome-ignore lint/a11y/noAutofocus: the field opens because the user asked for a link
                autoFocus
                value={url}
                placeholder={t('board.link.placeholder')}
                aria-label={t('board.link.label')}
                aria-invalid={invalid || undefined}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setInvalid(false);
                }}
              />
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function MoodboardView({
  store,
  projectId,
  userId,
  readOnly,
  boardTitle,
}: {
  store: BoardStore;
  projectId: string;
  userId: string;
  readOnly: boolean;
  boardTitle?: string;
}) {
  const { tagLabel, tagOption } = useClassifications();
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [tag, setTag] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const opener = useRef<HTMLButtonElement | null>(null);
  const all = [...snapshot.byId.values()];
  const references = referencesOf(all);
  const tagIds = (el: Reference) =>
    (el.tags ?? []).map((value) => tagOption(value)?.id ?? normaliseTag(value));
  const counts = new Map<string, number>();
  for (const el of references)
    for (const id of new Set(tagIds(el))) counts.set(id, (counts.get(id) ?? 0) + 1);
  const tags = [...counts.keys()].sort();
  const filtered = references.filter((el) => !tag || tagIds(el).includes(tag));
  const media = filtered.filter((el): el is MediaReference => el.type !== 'color');
  const index = media.findIndex((el) => el.id === selected);
  const current = media[index];
  useEffect(() => {
    if (selected && !current) {
      setSelected(null);
      opener.current?.focus();
    }
  }, [selected, current]);
  const groups = storyboardOf(all);
  const labels = frameLabels(groups);
  const assetId = current?.type === 'image' ? current.assetId : current?.imageAssetId;
  const usedIn = assetId
    ? groups.flatMap((group) =>
        group.frames
          .filter((frame) => frame.assetId === assetId)
          .map((frame) => labels.get(frame.id) ?? frame.id),
      )
    : [];
  const closeViewer = () => {
    setSelected(null);
    opener.current?.focus();
  };
  const choose = (id: string) => setTag(id === tag ? '' : id);
  const chips = [
    ...tags,
    // A tag whose last reference is gone stays selectable, so the filter never vanishes under you.
    ...(tag && !tags.includes(tag) ? [tag] : []),
  ];
  const open = (element: MediaReference) => (event: { currentTarget: HTMLButtonElement }) => {
    opener.current = event.currentTarget;
    setSelected(element.id);
  };
  const nameOf = (element: MediaReference) =>
    element.type === 'image' ? element.caption : element.title || element.url;

  return (
    <section className="moodboard" aria-label={t('nav.moodboard')}>
      <aside className="moodboard__side">
        <strong>{boardTitle || t('nav.moodboard')}</strong>
        <span>{t('moodboard.count', { count: references.length })}</span>
        {chips.length > 0 && (
          <>
            <h2>{t('moodboard.tags')}</h2>
            <ul>
              {chips.map((value) => (
                <li key={value}>
                  <button type="button" aria-pressed={tag === value} onClick={() => choose(value)}>
                    <span>{tagLabel(value)}</span>
                    <small>{counts.get(value) ?? 0}</small>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
      <div className="moodboard__main">
        <div className="moodboard__bar">
          <span className="moodboard__count" role="status">
            {t('moodboard.count', { count: filtered.length })}
          </span>
          <fieldset className="moodboard__chips" aria-label={t('moodboard.filter')}>
            <button
              type="button"
              className="moodboard__chip"
              aria-pressed={tag === ''}
              onClick={() => setTag('')}
            >
              {t('moodboard.all')}
            </button>
            {chips.map((value) => (
              <button
                key={value}
                type="button"
                className="moodboard__chip"
                aria-pressed={tag === value}
                onClick={() => choose(value)}
              >
                {tagLabel(value)}
              </button>
            ))}
          </fieldset>
          {!readOnly && (
            <AddReferences
              store={store}
              projectId={projectId}
              userId={userId}
              onNotice={setNotice}
            />
          )}
        </div>
        {notice && (
          <p className="moodboard__notice" role="alert">
            {notice}
          </p>
        )}
        {filtered.length === 0 ? (
          <div className="moodboard__empty">
            <EmptyState
              icon="image"
              title={t(references.length ? 'moodboard.noMatches' : 'moodboard.empty')}
            />
          </div>
        ) : (
          <div className="moodboard__gallery">
            {filtered.map((element) => {
              if (element.type === 'color')
                return (
                  <article
                    key={element.id}
                    className="moodboard__card moodboard__card--color"
                    style={{ background: element.hex }}
                    data-light={isLight(element.hex) || undefined}
                  >
                    <code>{element.hex}</code>
                    {element.label && <span>{element.label}</span>}
                  </article>
                );
              const label = t('moodboard.open', { name: nameOf(element) || t('viewer.title') });
              if (element.type === 'link')
                return (
                  <button
                    key={element.id}
                    type="button"
                    className="moodboard__card moodboard__card--link"
                    aria-label={label}
                    onClick={open(element)}
                  >
                    <ReferenceImage element={element} />
                    <span className="moodboard__text">
                      {element.title || element.url}
                      <small>{domainOf(element.url)}</small>
                    </span>
                  </button>
                );
              const tagged = (element.tags ?? []).map(tagLabel).join(' · ');
              return (
                <button
                  key={element.id}
                  type="button"
                  className="moodboard__card moodboard__card--image"
                  aria-label={label}
                  onClick={open(element)}
                >
                  <ReferenceImage element={element} />
                  {(element.caption || tagged) && (
                    <span className="moodboard__caption">
                      {element.caption}
                      {tagged && <small>{tagged}</small>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <UploadPanel />
      {current && (
        <MediaViewer
          store={store}
          element={current}
          projectId={projectId}
          userId={userId}
          readOnly={readOnly}
          onClose={closeViewer}
          gallery={{
            index,
            total: media.length,
            onPrevious: () => setSelected(media[index - 1]?.id ?? current.id),
            onNext: () => setSelected(media[index + 1]?.id ?? current.id),
            onSelect: (i: number) => setSelected(media[i]?.id ?? current.id),
            items: media.map((m) => ({
              id: m.id,
              assetId: m.type === 'link' ? m.imageAssetId : m.assetId,
              filename: m.type === 'image' ? m.caption : m.title,
              type: m.type,
            })),
            usedIn,
          }}
        />
      )}
    </section>
  );
}

/** Whether dark text reads better than light on this colour (WCAG relative luminance). */
export function isLight(hex: string): boolean {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}
