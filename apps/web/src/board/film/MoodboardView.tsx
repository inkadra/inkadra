// SPDX-License-Identifier: AGPL-3.0-only
import {
  createElement,
  deleteElements,
  type FrameElement,
  frameLabels,
  type SceneGroup,
  storyboardOf,
  updateElements,
} from '@inkadra/canvas-core';
import { ASPECT_RATIOS, aspectValue, type Element, MAX_TAGS } from '@inkadra/doc-schema';
import { Button, Checkbox, EmptyState, Icon, IconButton, Segmented } from '@inkadra/ui';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useClassifications } from '../../lib/classifications.ts';
import { getCachedAsset, pickVariant, useAsset, useAssetPalettes } from '../assets.ts';
import { CroppedImage } from '../CroppedImage.tsx';
import { CopyHexButton } from '../cards.tsx';
import { Toast, UploadPanel } from '../chrome.tsx';
import { copyHex, hexToRgb } from '../colors.ts';
import { uploadBoardId } from '../frame-grab.ts';
import { croppedRotatedSize, hasImageTransform } from '../image-crop.ts';
import { fillLinkPreview, webUrl } from '../links.ts';
import { PresentationView } from '../PresentationView.tsx';
import { isTyping } from '../shortcuts.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { normaliseTag } from '../tags.tsx';
import { startUpload } from '../uploads.ts';
import { MediaViewer } from '../viewer.tsx';
import { addFramesToBoard, framesFromReferences, placeFrames } from './send-to-storyboard.ts';
import './film.css';

export type Reference = Extract<Element, { type: 'image' | 'link' | 'color' }>;
export type MediaReference = Exclude<Reference, { type: 'color' }>;
type ImageElement = Extract<Element, { type: 'image' }>;

export function referencesOf(elements: readonly Element[], tag = ''): Reference[] {
  return elements
    .filter(
      (el): el is Reference =>
        (el.type === 'image' || el.type === 'color' || (el.type === 'link' && !!el.imageAssetId)) &&
        (!tag || (el.tags ?? []).some((value) => normaliseTag(value) === normaliseTag(tag))),
    )
    .sort((a, b) => a.z.localeCompare(b.z) || a.id.localeCompare(b.id));
}

/** The named groups by name and, last, the references without one (decision 0077). */
export function referenceGroups(
  references: readonly Reference[],
): Array<{ name: string | null; items: Reference[] }> {
  const named = new Map<string, { name: string; items: Reference[] }>();
  const loose: Reference[] = [];
  for (const el of references) {
    if (!el.group) {
      loose.push(el);
      continue;
    }
    const key = normaliseTag(el.group);
    const group = named.get(key) ?? { name: el.group, items: [] };
    group.items.push(el);
    named.set(key, group);
  }
  return [
    ...[...named.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...(loose.length ? [{ name: null, items: loose }] : []),
  ];
}

/** Up to five colours: the strongest of each picture, then the next of each, without repeats. */
export function mergePalette(palettes: readonly (readonly string[])[], max = 5): string[] {
  const out = new Set<string>();
  const longest = Math.max(0, ...palettes.map((palette) => palette.length));
  for (let rank = 0; rank < longest; rank += 1)
    for (const palette of palettes) {
      const hex = palette[rank];
      if (hex && out.size < max) out.add(hex);
    }
  return [...out];
}

/** Whether a picture, as cropped and rotated, is taller than wide: it takes two rows of tiles. */
function isUpright(
  image: Pick<ImageElement, 'crop' | 'rotation'>,
  width: number | null | undefined,
  height: number | null | undefined,
): boolean {
  if (!width || !height) return false;
  const out = croppedRotatedSize(width, height, image.crop, image.rotation);
  return out.height > out.width;
}

const nearestAspect = (ratio: number) =>
  ASPECT_RATIOS.reduce((best, next) =>
    Math.abs(aspectValue(next) - ratio) < Math.abs(aspectValue(best) - ratio) ? next : best,
  );

/**
 * The pictures on screen as the slides of a presentation: frames that exist only for it, with
 * the note as the action and the group as the place.
 * shortcut: slides draw the original picture, not its crop or drawing, because frames have
 * neither; give FramePicture the image's transform if people present cropped references.
 */
export function referenceSlides(references: readonly Reference[]): {
  groups: SceneGroup[];
  labels: Map<string, string>;
} {
  const frames = references.flatMap((el): FrameElement[] => {
    const assetId = el.type === 'image' ? el.assetId : el.type === 'link' ? el.imageAssetId : '';
    if (!assetId) return [];
    const asset = getCachedAsset(assetId);
    const known = asset && asset !== 'missing' && asset.width && asset.height ? asset : null;
    return [
      {
        id: el.id,
        type: 'frame',
        x: 0,
        y: 0,
        w: el.w,
        z: el.z,
        parent: null,
        createdBy: el.createdBy,
        createdAt: el.createdAt,
        assetId,
        aspect: known
          ? nearestAspect((known.width as number) / (known.height as number))
          : undefined,
        action: noteOf(el),
        location: el.group,
      } as FrameElement,
    ];
  });
  return {
    groups: [{ scene: null, frames }],
    labels: new Map(frames.map((frame, i) => [frame.id, String(i + 1)])),
  };
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
  if (element.type === 'image' && (hasImageTransform(element) || element.strokes?.length)) {
    return (
      <CroppedImage
        strokes={element.type === 'image' ? element.strokes : undefined}
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
  inline = false,
}: {
  store: BoardStore;
  projectId: string;
  userId: string;
  onNotice: (text: string) => void;
  /** The three actions as buttons in the empty state, instead of the bar's "+ Add" menu. */
  inline?: boolean;
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
        onFailed: (assetId, refused) => {
          if (!assetId && !refused) onNotice(t('board.errors.upload', { name: file.name }));
        },
        onCancelled: (assetId) =>
          deleteElements(
            store.doc,
            [...store.getSnapshot().byId.values()]
              .filter((el) => el.type === 'image' && el.assetId === assetId)
              .map((el) => el.id),
          ),
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

  const inputs = (
    <>
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
    </>
  );
  const linkForm = (
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
  );
  const pickImages = () => {
    setAdding(null);
    files.current?.click();
  };
  const pickColor = () => {
    setAdding(null);
    color.current?.click();
  };

  if (inline)
    return (
      <div className="moodboard__add moodboard__add--inline" ref={root}>
        {inputs}
        <div className="moodboard__actions">
          <Button icon="upload" onClick={pickImages}>
            {t('moodboard.addImage')}
          </Button>
          <Button icon="link" onClick={() => setAdding('link')}>
            {t('moodboard.addLink')}
          </Button>
          <Button icon="color" onClick={pickColor}>
            {t('moodboard.addColor')}
          </Button>
        </div>
        {adding === 'link' && linkForm}
      </div>
    );

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
      {inputs}
      {adding && (
        <div className="moodboard__popover" id={menuId}>
          {adding === 'menu' ? (
            <div role="menu" aria-label={t('moodboard.add')}>
              <button type="button" role="menuitem" onClick={pickImages}>
                <Icon name="upload" size={16} />
                {t('moodboard.addImage')}
              </button>
              <button type="button" role="menuitem" onClick={() => setAdding('link')}>
                <Icon name="link" size={16} />
                {t('moodboard.addLink')}
              </button>
              <button type="button" role="menuitem" onClick={pickColor}>
                <Icon name="color" size={16} />
                {t('moodboard.addColor')}
              </button>
            </div>
          ) : (
            linkForm
          )}
        </div>
      )}
    </div>
  );
}

const TILE_SIZES = ['s', 'm', 'l'] as const;
type TileSize = (typeof TILE_SIZES)[number];
const KINDS = ['image', 'link', 'color'] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABELS = {
  image: 'moodboard.images',
  link: 'moodboard.links',
  color: 'moodboard.colors',
};
type BulkPanel = null | 'group' | 'tag' | 'note';

/** The field each kind of reference already has for a line about it (decision 0077). */
const NOTE_FIELDS = {
  image: { key: 'caption', max: 2000 },
  link: { key: 'title', max: 500 },
  color: { key: 'label', max: 80 },
} as const;
const noteOf = (el: Reference) =>
  el.type === 'image' ? el.caption : el.type === 'link' ? el.title : el.label;

/** The tile of one reference: its checkbox beside the card, and a taller row for an upright picture. */
function ReferenceTile({
  element,
  name,
  picked,
  picking,
  selectable,
  onToggle,
  children,
}: {
  element: Reference;
  name: string;
  picked: boolean;
  picking: boolean;
  /** Every action on a selection edits the board: people who can only read don't get one. */
  selectable: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const asset = useAsset(element.type === 'image' ? element.assetId : undefined);
  const tall =
    element.type === 'image' &&
    !!asset &&
    asset !== 'missing' &&
    isUpright(element, asset.width, asset.height);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the checkbox is the keyboard's way
    // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut; the checkbox is the keyboard's way
    <div
      className="moodboard__tile"
      data-tall={tall || undefined}
      data-picked={picked || undefined}
      data-picking={picking || undefined}
      onClickCapture={(event) => {
        if (!selectable || !(picking || event.ctrlKey || event.metaKey)) return;
        if ((event.target as HTMLElement).closest('.moodboard__check')) return;
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      {children}
      {selectable && (
        <span className="moodboard__check">
          <Checkbox
            checked={picked}
            aria-label={t('moodboard.select', { name })}
            onChange={onToggle}
          />
        </span>
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
  storyboardBoardId = null,
}: {
  store: BoardStore;
  projectId: string;
  userId: string;
  readOnly: boolean;
  boardTitle?: string;
  /** The board that holds the project's storyboard; null when it is this one. */
  storyboardBoardId?: string | null;
}) {
  const { tagLabel, tagOption } = useClassifications();
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [tag, setTag] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  const [size, setSize] = useState<TileSize>('m');
  const [opened, setOpened] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [panel, setPanel] = useState<BulkPanel>(null);
  const [sending, setSending] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  const closeCopied = useCallback(() => setCopied(''), []);
  const opener = useRef<HTMLButtonElement | null>(null);
  const bar = useRef<HTMLFieldSetElement | null>(null);
  const root = useRef<HTMLElement | null>(null);
  // The group whose heading gets the focus back once a rename by keyboard ends.
  const refocusGroup = useRef<string | null>(null);
  const all = [...snapshot.byId.values()];
  const references = referencesOf(all);
  const tagIds = (el: Reference) =>
    (el.tags ?? []).map((value) => tagOption(value)?.id ?? normaliseTag(value));
  const counts = new Map<string, number>();
  for (const el of references)
    for (const id of new Set(tagIds(el))) counts.set(id, (counts.get(id) ?? 0) + 1);
  const tags = [...counts.keys()].sort();
  const sections = referenceGroups(
    references.filter((el) => (!tag || tagIds(el).includes(tag)) && (!kind || el.type === kind)),
  );
  // What is on screen, in the order it is on screen: the keys of the viewer follow it.
  const shown = sections.flatMap((section) => section.items);
  const groupNames = referenceGroups(references).flatMap((s) => (s.name ? [s.name] : []));
  const chosen = shown.filter((el) => picked.has(el.id));
  const chosenMedia = chosen.filter((el): el is MediaReference => el.type !== 'color');
  const media = shown.filter((el): el is MediaReference => el.type !== 'color');
  const index = media.findIndex((el) => el.id === opened);
  const current = media[index];
  const palette = mergePalette(
    useAssetPalettes(shown.flatMap((el) => (el.type === 'image' ? [el.assetId] : []))),
  );
  useEffect(() => {
    if (opened && !current) {
      setOpened(null);
      opener.current?.focus();
    }
  }, [opened, current]);
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
    setOpened(null);
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
    setOpened(element.id);
  };
  const nameOf = (element: MediaReference) =>
    element.type === 'image' ? element.caption : element.title || element.url;
  const toggle = (id: string) =>
    setPicked((before) => {
      const next = new Set(before);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const closePanel = () => {
    bar.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus();
    setPanel(null);
  };

  // Escape closes the open panel of the selection bar, then the selection itself. The viewer and
  // the presentation have their own Escape.
  const picking = chosen.length > 0;
  const blocked = !!current || presenting;
  useEffect(() => {
    if (!picking || blocked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (panel) closePanel();
      // A tile's checkbox is an input too, but nobody types there.
      else if (!isTyping(event.target) || (event.target as HTMLInputElement).type === 'checkbox')
        clearSelection();
    };
    const away = (event: PointerEvent) => {
      if (panel && !bar.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', away);
    };
  });
  const clearSelection = () => {
    // The bar goes with the focus in it: back to a tile that was selected.
    if (bar.current?.contains(document.activeElement))
      bar.current.closest('.moodboard')?.querySelector<HTMLElement>('[data-picked] input')?.focus();
    setPicked(new Set());
    setPanel(null);
  };

  /** Changes the chosen references that are not locked, as one step of undo. */
  const change = (patch: (el: Reference) => Partial<Reference> | null) => {
    const editable = chosen.filter((el) => !el.locked);
    const skipped = chosen.length - editable.length;
    setNotice(skipped ? t('moodboard.lockedSkipped', { count: skipped }) : '');
    store.undo.stopCapturing();
    updateElements(
      store.doc,
      editable.flatMap((el) => {
        const fields = patch(el);
        return fields ? [{ id: el.id, patch: fields }] : [];
      }),
      LOCAL,
    );
    store.undo.stopCapturing();
    closePanel();
  };
  const moveToGroup = (typed: string | undefined) => {
    const name = typed?.trim();
    // A name the board already uses, in another case, joins that group.
    const group =
      name && (groupNames.find((known) => normaliseTag(known) === normaliseTag(name)) ?? name);
    change(() => ({ group: group || undefined }));
  };
  const addTag = (typed: string) => {
    const value = typed.trim();
    if (!value) return;
    change((el) => {
      const before = el.tags ?? [];
      const id = tagOption(value)?.id ?? normaliseTag(value);
      const has = before.some((v) => (tagOption(v)?.id ?? normaliseTag(v)) === id);
      return has || before.length >= MAX_TAGS ? null : { tags: [...before, value] };
    });
  };
  const saveNote = (typed: string) => {
    const el = chosen[0];
    if (el) change(() => ({ [NOTE_FIELDS[el.type].key]: typed.trim() || undefined }));
  };
  useEffect(() => {
    if (renaming || !refocusGroup.current) return;
    const wanted = refocusGroup.current;
    refocusGroup.current = null;
    root.current
      ?.querySelector<HTMLElement>(`[data-group="${CSS.escape(wanted)}"] button`)
      ?.focus();
  });
  const renameGroup = (from: string, to: string) => {
    const name = to.trim();
    setRenaming(null);
    if (refocusGroup.current) refocusGroup.current = normaliseTag(name || from);
    if (!name || name === from) return;
    store.undo.stopCapturing();
    updateElements(
      store.doc,
      references
        .filter((el) => el.group && normaliseTag(el.group) === normaliseTag(from))
        .map((el) => ({ id: el.id, patch: { group: name } })),
      LOCAL,
    );
    store.undo.stopCapturing();
  };
  const sendToStoryboard = async () => {
    const lookup = (id: string) => snapshot.byId.get(id);
    const frames = framesFromReferences(chosenMedia, lookup);
    setNotice('');
    setSending(true);
    try {
      if (storyboardBoardId) await addFramesToBoard(storyboardBoardId, frames, userId);
      else {
        store.undo.stopCapturing();
        placeFrames(store.doc, frames, { userId, origin: LOCAL });
        store.undo.stopCapturing();
      }
      setCopied(t('moodboard.sent', { count: frames.length }));
    } catch {
      setNotice(t('moodboard.sendFailed'));
    } finally {
      setSending(false);
    }
  };
  const copyPalette = () =>
    void copyHex(palette.join(' ')).then((ok) => ok && setCopied(t('moodboard.paletteCopied')));
  const slides = presenting ? referenceSlides(shown) : null;

  const card = (element: Reference) => {
    if (element.type === 'color')
      return (
        <article
          className="moodboard__card moodboard__card--color"
          style={{ background: element.hex }}
          data-light={isLight(element.hex) || undefined}
        >
          <span className="card__rgb ink-mono" aria-hidden="true">
            {hexToRgb(element.hex).join(' ')}
          </span>
          <CopyHexButton hex={element.hex} onCopied={setCopied} />
          <code>{element.hex}</code>
          {element.label && <span>{element.label}</span>}
        </article>
      );
    const label = t('moodboard.open', { name: nameOf(element) || t('viewer.title') });
    if (element.type === 'link')
      return (
        <button
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
        type="button"
        className="moodboard__card moodboard__card--image"
        aria-label={label}
        onClick={open(element)}
      >
        <ReferenceImage element={element} />
        {(element.caption || tagged) && (
          <span className="moodboard__caption">
            {element.caption && <span>{element.caption}</span>}
            {tagged && <small>{tagged}</small>}
          </span>
        )}
      </button>
    );
  };
  const gallery = (items: readonly Reference[]) => (
    <div className="moodboard__gallery">
      {items.map((element) => (
        <ReferenceTile
          key={element.id}
          element={element}
          name={
            element.type === 'color'
              ? element.label || element.hex
              : nameOf(element) || t('viewer.title')
          }
          picked={picked.has(element.id)}
          picking={picking}
          selectable={!readOnly}
          onToggle={() => toggle(element.id)}
        >
          {card(element)}
        </ReferenceTile>
      ))}
    </div>
  );

  return (
    <section
      className="moodboard"
      ref={root}
      aria-label={t('nav.moodboard')}
      data-size={size}
      data-tour="moodboard"
    >
      <div className="moodboard__main">
        <div className="moodboard__bar">
          <h2 className="moodboard__title">{t('moodboard.title')}</h2>
          <span
            className="moodboard__count"
            role="status"
            aria-label={t('moodboard.count', { count: shown.length })}
          >
            · {shown.length}
          </span>
          <fieldset
            className="moodboard__chips"
            aria-label={t('moodboard.filter')}
            data-tour="moodboard-filter"
          >
            <button
              type="button"
              className="moodboard__chip"
              aria-pressed={tag === '' && kind === ''}
              onClick={() => {
                setTag('');
                setKind('');
              }}
            >
              {t('moodboard.all')}
            </button>
            {KINDS.map((value) => (
              <button
                key={value}
                type="button"
                className="moodboard__chip"
                aria-pressed={kind === value}
                onClick={() => setKind(kind === value ? '' : value)}
              >
                {t(KIND_LABELS[value])}
              </button>
            ))}
            {chips.map((value) => (
              <button
                key={value}
                type="button"
                className="moodboard__chip"
                aria-pressed={tag === value}
                onClick={() => choose(value)}
              >
                #{tagLabel(value)}
              </button>
            ))}
          </fieldset>
          <div className="moodboard__tools">
            <Segmented
              label={t('film.playback.size')}
              value={size}
              onChange={setSize}
              options={TILE_SIZES.map((value) => ({
                value,
                label: value.toUpperCase(),
                tooltip: t(`film.playback.sizes.${value}`),
              }))}
            />
            <Button
              disabled={!shown.some((el) => el.type !== 'color')}
              onClick={() => setPresenting(true)}
            >
              {t('film.playback.present')}
            </Button>
            {!readOnly && (
              <AddReferences
                store={store}
                projectId={projectId}
                userId={userId}
                onNotice={setNotice}
              />
            )}
          </div>
        </div>
        {palette.length > 0 && (
          <div className="moodboard__palette" data-tour="moodboard-palette">
            <span id="moodboard-palette">{t('moodboard.palette')}</span>
            <ul aria-labelledby="moodboard-palette">
              {palette.map((hex) => (
                <li key={hex} style={{ background: hex }} title={hex}>
                  <span className="story__sr">{hex}</span>
                </li>
              ))}
            </ul>
            <Button className="moodboard__palette-copy" icon="copy" onClick={copyPalette}>
              {t('moodboard.copy')}
            </Button>
          </div>
        )}
        {notice && (
          <p className="moodboard__notice" role="alert">
            {notice}
          </p>
        )}
        {shown.length === 0 ? (
          <div className="moodboard__empty">
            <EmptyState
              icon="image"
              title={t(references.length ? 'moodboard.noMatches' : 'moodboard.empty')}
              actions={
                !readOnly && references.length === 0 ? (
                  <AddReferences
                    inline
                    store={store}
                    projectId={projectId}
                    userId={userId}
                    onNotice={setNotice}
                  />
                ) : undefined
              }
            />
          </div>
        ) : groupNames.length === 0 ? (
          gallery(shown)
        ) : (
          sections.map(({ name, items }) => (
            <section key={name ?? ''} className="moodboard__group">
              <h3
                className="moodboard__group-title"
                data-group={name ? normaliseTag(name) : undefined}
              >
                {name && renaming === name ? (
                  <input
                    className="ink-input"
                    // biome-ignore lint/a11y/noAutofocus: the field opens because the user asked to rename
                    autoFocus
                    defaultValue={name}
                    maxLength={60}
                    aria-label={t('moodboard.groupName')}
                    onBlur={(event) => renameGroup(name, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape')
                        refocusGroup.current = name;
                      if (event.key === 'Enter') {
                        // The focus moves to the heading's button: this Enter must not press it.
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        event.currentTarget.value = name;
                        event.currentTarget.blur();
                      }
                    }}
                  />
                ) : name && !readOnly ? (
                  <button
                    type="button"
                    aria-label={t('moodboard.renameGroup', { name })}
                    data-ink-tooltip={t('moodboard.renameGroup', { name })}
                    onClick={() => setRenaming(name)}
                  >
                    {name}
                  </button>
                ) : (
                  <span>{name ?? t('moodboard.ungrouped')}</span>
                )}
                <small>{items.length}</small>
              </h3>
              {gallery(items)}
            </section>
          ))
        )}
        {picking && (
          <fieldset
            className="moodboard__selection"
            ref={bar}
            aria-label={t('moodboard.selection')}
          >
            <span className="moodboard__selection-count" role="status">
              {t('moodboard.selected', { count: chosen.length })}
            </span>
            <Button
              aria-expanded={panel === 'group'}
              onClick={() => setPanel(panel === 'group' ? null : 'group')}
            >
              {t('moodboard.moveToGroup')}
            </Button>
            <Button
              aria-expanded={panel === 'tag'}
              onClick={() => setPanel(panel === 'tag' ? null : 'tag')}
            >
              {t('moodboard.tags')}
            </Button>
            {chosen.length === 1 && (
              <Button
                aria-expanded={panel === 'note'}
                onClick={() => setPanel(panel === 'note' ? null : 'note')}
              >
                {t('moodboard.note')}
              </Button>
            )}
            <Button
              disabled={sending || chosenMedia.length === 0}
              onClick={() => void sendToStoryboard()}
            >
              {t('moodboard.sendToStoryboard')}
            </Button>
            <IconButton
              icon="close"
              label={t('moodboard.clearSelection')}
              onClick={clearSelection}
            />
            {panel === 'group' && (
              <div className="moodboard__popover moodboard__popover--up">
                <div className="moodboard__options">
                  {groupNames.map((name) => (
                    <button key={name} type="button" onClick={() => moveToGroup(name)}>
                      {name}
                    </button>
                  ))}
                  <button type="button" onClick={() => moveToGroup(undefined)}>
                    {t('moodboard.noGroup')}
                  </button>
                </div>
                <BulkInput label={t('moodboard.newGroup')} max={60} onSubmit={moveToGroup} />
              </div>
            )}
            {panel === 'tag' && (
              <div className="moodboard__popover moodboard__popover--up">
                {tags.length > 0 && (
                  <div className="moodboard__options">
                    {tags.map((value) => (
                      <button key={value} type="button" onClick={() => addTag(value)}>
                        #{tagLabel(value)}
                      </button>
                    ))}
                  </div>
                )}
                <BulkInput label={t('moodboard.addTag')} max={40} onSubmit={addTag} />
              </div>
            )}
            {panel === 'note' && chosen[0] && (
              <div className="moodboard__popover moodboard__popover--up">
                <BulkInput
                  label={t('moodboard.note')}
                  initial={noteOf(chosen[0])}
                  max={NOTE_FIELDS[chosen[0].type].max}
                  onSubmit={saveNote}
                />
              </div>
            )}
          </fieldset>
        )}
      </div>
      <UploadPanel />
      {copied && <Toast key={copied} text={copied} ok onClose={closeCopied} />}
      {slides && (
        <PresentationView
          store={store}
          projectId={projectId}
          groups={slides.groups}
          labels={slides.labels}
          boardTitle={boardTitle || t('nav.moodboard')}
          onClose={() => setPresenting(false)}
        />
      )}
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
            onPrevious: () => setOpened(media[index - 1]?.id ?? current.id),
            onNext: () => setOpened(media[index + 1]?.id ?? current.id),
            onSelect: (i: number) => setOpened(media[i]?.id ?? current.id),
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

/** One field of the selection bar's panels: Enter applies it. */
function BulkInput({
  label,
  initial = '',
  max,
  onSubmit,
}: {
  label: string;
  initial?: string | undefined;
  max: number;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <input
        className="ink-input"
        // biome-ignore lint/a11y/noAutofocus: the field opens because the user asked for it
        autoFocus
        value={value}
        maxLength={max}
        placeholder={label}
        aria-label={label}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
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
