// SPDX-License-Identifier: AGPL-3.0-only
import {
  type CastAppearance,
  castAppearances,
  deleteElements,
  updateElement,
} from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { Button, Icon, IconButton, Select } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import {
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { pickVariant, useAsset } from '../assets.ts';
import { GuestModeContext } from '../context.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { TagEditor } from '../tags.tsx';
import {
  localPreview,
  retryUpload,
  startUpload,
  useUploadProgress,
  useUploads,
} from '../uploads.ts';
import { useCastAppearances } from './cast-appearances.ts';
import { blurOnEnter, PresetField, TextField } from './fields.tsx';

export type StoryCard = Extract<Element, { type: 'character' | 'location' }>;
type Patch = Record<string, unknown>;

/** "1, 3A, 12" → ['1', '3A', '12']: unique, as written, at most 200. */
export function parseScenes(text: string): string[] | undefined {
  const scenes = [
    ...new Set(
      text
        .split(/[,;\s]+/)
        .map((s) => s.trim().slice(0, 12))
        .filter(Boolean),
    ),
  ].slice(0, 200);
  return scenes.length > 0 ? scenes : undefined;
}

/**
 * A web address for `mapUrl`, or null when the text is not one: other schemes, addresses with a
 * user name or password, and anything longer than the 2048 characters the schema keeps.
 */
export function parseMapUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}

/** Search for an address on OpenStreetMap, opened in a new tab: no map is embedded. */
export function mapSearchUrl(address: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;
}

/**
 * Side sheet of a character or location card (decision 0044), in the frame panel's pattern.
 * Fields guests never receive (contacts, notes, a location's address) sit under "Team only".
 */
export function StoryCardPanel({
  store,
  card,
  projectId,
  boardId,
  readOnly,
  onClose,
}: {
  store: BoardStore;
  card: StoryCard;
  projectId: string;
  boardId: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const guest = useContext(GuestModeContext);
  const locked = readOnly || !!card.locked;
  const set = (patch: Patch) => !locked && updateElement(store.doc, card.id, patch, LOCAL);
  const text = (v: string, max: number) => v.trim().slice(0, max) || undefined;
  const panel = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [badMap, setBadMap] = useState(false);
  // A new card opens with its name to type.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when another card opens
  useEffect(() => {
    if (card.name || locked) return;
    // After the canvas has handled the click that created the card.
    const frame = requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLInputElement>('.story-panel__name input')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [card.id]);
  const kind = card.type;
  return (
    <aside
      ref={panel}
      className="film-panel story-panel"
      aria-label={t(`story.${kind}.details`)}
      data-chrome
      data-scroll
    >
      <header className="film-panel__head">
        <span className="film-panel__label">{t(`board.types.${kind}`)}</span>
        {card.type === 'location' && card.setting && (
          <span className="film-chip story-chip">{t(`film.scene.settings.${card.setting}`)}</span>
        )}
        <span className="ink-header__spacer" />
        <IconButton icon="close" label={t('story.close')} onClick={onClose} />
      </header>
      <div className="film-panel__body">
        {card.type === 'character' ? (
          <CharacterSheet
            store={store}
            card={card}
            projectId={projectId}
            boardId={boardId}
            readOnly={readOnly}
          />
        ) : (
          <>
            <div className="story-panel__picture">
              <StoryPicture assetId={card.assetId} label={card.name} pixels={640} kind={kind} />
              {!locked && (
                <div className="film-panel__picture-actions">
                  <Button icon="upload" variant="ghost" onClick={() => fileInput.current?.click()}>
                    {t('story.upload')}
                  </Button>
                  <Button
                    icon="image"
                    variant="ghost"
                    aria-expanded={picking}
                    onClick={() => setPicking(!picking)}
                  >
                    {t('story.fromBoard')}
                  </Button>
                  {card.assetId && (
                    <Button variant="ghost" onClick={() => set({ assetId: undefined })}>
                      {t('story.removePicture')}
                    </Button>
                  )}
                </div>
              )}
              {picking && !locked && (
                <BoardPictures
                  store={store}
                  onPick={(assetId) => {
                    set({ assetId });
                    setPicking(false);
                  }}
                />
              )}
            </div>
            <TextField
              label={t('story.location.name')}
              value={card.name}
              placeholder={t('story.location.namePlaceholder')}
              readOnly={locked}
              className="story-panel__name"
              onCommit={(v) => set({ name: v.trim().slice(0, 200) })}
            />
            <SettingField
              value={card.setting}
              readOnly={locked}
              onCommit={(setting) => set({ setting })}
            />
            <TextField
              label={t('story.location.light')}
              value={card.light ?? ''}
              placeholder={t('story.location.lightPlaceholder')}
              multiline
              readOnly={locked}
              onCommit={(v) => set({ light: text(v, 1000) })}
            />
            <TextField
              label={t('story.location.availability')}
              value={card.availability ?? ''}
              readOnly={locked}
              onCommit={(v) => set({ availability: text(v, 1000) })}
            />
            <TextField
              label={t('story.scenes')}
              value={(card.scenes ?? []).join(', ')}
              hint={t('story.scenesHint')}
              readOnly={locked}
              onCommit={(v) => set({ scenes: parseScenes(v) })}
            />
            {!guest && (
              <section className="story-panel__team" aria-labelledby={`team-${card.id}`}>
                <h3 id={`team-${card.id}`} className="story-panel__team-title">
                  {t('story.teamOnly')}
                </h3>
                <p className="story-panel__team-hint">{t('story.teamOnlyHint')}</p>
                <>
                  <TextField
                    label={t('story.location.address')}
                    value={card.address ?? ''}
                    readOnly={locked}
                    onCommit={(v) => set({ address: text(v, 500) })}
                  />
                  <TextField
                    label={t('story.location.mapUrl')}
                    value={card.mapUrl ?? ''}
                    placeholder="https://"
                    hint={
                      badMap ? t('story.location.mapUrlInvalid') : t('story.location.mapUrlHint')
                    }
                    readOnly={locked}
                    onCommit={(v) => {
                      if (!v.trim()) {
                        setBadMap(false);
                        set({ mapUrl: undefined });
                        return;
                      }
                      const url = parseMapUrl(v);
                      setBadMap(!url);
                      if (url) set({ mapUrl: url });
                    }}
                  />
                  {(card.mapUrl || card.address) && (
                    <a
                      className="story-panel__map"
                      href={card.mapUrl ?? mapSearchUrl(card.address ?? '')}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {card.mapUrl ? t('story.location.openMap') : t('story.location.searchMap')}
                    </a>
                  )}
                </>
                <TextField
                  label={t('story.location.contact')}
                  value={card.contact ?? ''}
                  readOnly={locked}
                  onCommit={(v) => set({ contact: text(v, 500) })}
                />
                <TextField
                  label={t('story.notes')}
                  value={card.notes ?? ''}
                  multiline
                  readOnly={locked}
                  onCommit={(v) => set({ notes: text(v, 4000) })}
                />
              </section>
            )}
          </>
        )}
        {!guest && (
          <div className="film-field">
            <span className="film-field__label">{t('tags.title')}</span>
            <TagEditor
              tags={card.tags ?? []}
              readOnly={locked}
              projectId={projectId}
              onChange={(tags) => set({ tags })}
            />
          </div>
        )}
        {!locked && (
          <Button
            icon="trash"
            variant="danger"
            className="film-panel__delete"
            onClick={() => {
              store.undo.stopCapturing();
              deleteElements(store.doc, [card.id], LOCAL);
              onClose();
            }}
          >
            {t(`story.${kind}.delete`)}
          </Button>
        )}
      </div>
      {card.type === 'location' && (
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const id = card.id;
            startUpload({
              file,
              projectId,
              boardId,
              onAsset: (assetId) => updateElement(store.doc, id, { assetId }, LOCAL),
            });
          }}
        />
      )}
    </aside>
  );
}

function SettingField({
  value,
  readOnly,
  onCommit,
}: {
  value: 'int' | 'ext' | 'int-ext' | undefined;
  readOnly: boolean;
  onCommit: (value: 'int' | 'ext' | 'int-ext' | undefined) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="film-field">
      <label htmlFor={id}>{t('film.scene.setting')}</label>
      <Select
        id={id}
        className="ink-input"
        value={value ?? ''}
        disabled={readOnly}
        onChange={(e) => onCommit((e || undefined) as typeof value)}
      >
        <option value="">–</option>
        {(['int', 'ext', 'int-ext'] as const).map((s) => (
          <option key={s} value={s}>
            {t(`film.scene.settings.${s}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** The picture of a story card, or its type icon on a quiet surface. */
export function StoryPicture({
  assetId,
  label,
  pixels,
  kind,
  preview: uploading,
}: {
  assetId: string | undefined;
  label: string;
  pixels: number;
  kind: 'character' | 'location';
  /** A new photo still uploading: shown over the current one. */
  preview?: string | null | undefined;
}) {
  const asset = useAsset(assetId);
  useUploadProgress(assetId);
  const preview = assetId ? localPreview(assetId) : null;
  const ready = asset && asset !== 'missing' ? asset : null;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return (
    <div className={`story-picture story-picture--${kind}`}>
      {uploading || ready || preview ? (
        <img
          src={uploading || (ready && pickVariant(ready, pixels * dpr)) || preview || undefined}
          alt={label}
          draggable={false}
        />
      ) : (
        <span className="story-picture__empty" aria-hidden="true">
          {kind === 'character' ? initials(label) : null}
        </span>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase())
    .join('');
}

/** Pictures already on the board: image cards and drawn-over frame references. */
function BoardPictures({
  store,
  onPick,
}: {
  store: BoardStore;
  onPick: (assetId: string) => void;
}) {
  const { t } = useTranslation();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const pictures = [
    ...new Set(
      [...snap.byId.values()].flatMap((el) =>
        el.type === 'image' ? [el.assetId] : el.type === 'frame' && el.assetId ? [el.assetId] : [],
      ),
    ),
  ].slice(0, 60);
  if (pictures.length === 0) return <p className="ink-muted">{t('story.noPictures')}</p>;
  return (
    <ul className="story-panel__pictures" aria-label={t('story.fromBoard')}>
      {pictures.map((assetId) => (
        <li key={assetId}>
          <BoardPicture assetId={assetId} onPick={() => onPick(assetId)} />
        </li>
      ))}
    </ul>
  );
}

function BoardPicture({ assetId, onPick }: { assetId: string; onPick: () => void }) {
  const { t } = useTranslation();
  const asset = useAsset(assetId);
  const ready = asset && asset !== 'missing' ? asset : null;
  if (!ready) return null;
  return (
    <button
      type="button"
      className="story-panel__pick"
      aria-label={t('story.usePicture', { name: ready.filename })}
      onClick={onPick}
    >
      <img src={pickVariant(ready, 160)} alt="" draggable={false} />
    </button>
  );
}

/** Where a character appears: its scenes come from the cast of the frames, by name. */
export function characterAppearance(
  name: string,
  elements: Iterable<Element>,
  otherBoards: readonly CastAppearance[] = [],
): { frames: number; scenes: string[] } {
  const key = name.trim().toLocaleLowerCase();
  const found = [...castAppearances([...elements]), ...otherBoards].filter(
    (entry) => key && entry.name === key,
  );
  return {
    frames: found.reduce((sum, entry) => sum + entry.frames, 0),
    scenes: [...new Set(found.flatMap((entry) => entry.scenes))],
  };
}

/** "Protagonista · 34 anni": a plain number becomes an age, anything else stays as written. */
export function characterSubtitle(
  card: { role?: string | undefined; age?: string | undefined },
  t: TFunction,
): string {
  const age =
    card.age && /^\d+$/.test(card.age)
      ? t('story.character.ageYears', { age: card.age })
      : card.age;
  return [card.role, age].filter(Boolean).join(' · ');
}

const ROLE_CODES = ['protagonist', 'coprotagonist', 'antagonist', 'supporting'] as const;

type CharacterCard = Extract<Element, { type: 'character' }>;

/** A section that closes; its first state is decided once, the person's choice then stays. */
function Section({
  title,
  count,
  open = false,
  children,
}: {
  title: string;
  count?: string | undefined;
  open?: boolean | undefined;
  children: ReactNode;
}) {
  const [initiallyOpen] = useState(open);
  return (
    <details className="story-section" open={initiallyOpen}>
      <summary>
        <span className="story-section__title">{title}</span>
        {count && <small>{count}</small>}
        <Icon name="chevronDown" size={14} />
      </summary>
      <div className="story-section__body">{children}</div>
    </details>
  );
}

/** The sheet of a character, in sections (approved mockup, variant A). */
function CharacterSheet({
  store,
  card,
  projectId,
  boardId,
  readOnly,
}: {
  store: BoardStore;
  card: CharacterCard;
  projectId: string;
  boardId: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const guest = useContext(GuestModeContext);
  const locked = readOnly || !!card.locked;
  const set = (patch: Patch) => !locked && updateElement(store.doc, card.id, patch, LOCAL);
  const clean = (v: string, max: number) => v.trim().slice(0, max) || undefined;
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const otherBoards = useCastAppearances(projectId, boardId, guest);
  const { frames, scenes } = useMemo(
    () => characterAppearance(card.name, snap.byId.values(), otherBoards),
    [card.name, snap, otherBoards],
  );
  const allScenes = [...new Set([...scenes, ...(card.scenes ?? [])])];
  const [picking, setPicking] = useState<'photo' | 'reference' | null>(null);
  const [addingRelation, setAddingRelation] = useState(false);
  const [uploadKey, setUploadKey] = useState<string | null>(null);
  const upload = useUploads().find((item) => item.key === uploadKey);
  const uploading = upload?.state === 'uploading' || upload?.state === 'offline';
  const failed = upload?.state === 'failed';
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<'photo' | 'reference'>('photo');
  const references = card.references ?? [];
  const relations = card.relations ?? [];
  const subtitle = characterSubtitle(card, t);

  const chooseFile = (target: 'photo' | 'reference') => {
    uploadTarget.current = target;
    fileInput.current?.click();
  };
  const addReference = (assetId: string, latest: readonly string[]) =>
    updateElement(
      store.doc,
      card.id,
      { references: [...new Set([...latest, assetId])].slice(0, 60) },
      LOCAL,
    );
  const onFile = (file: File) => {
    const id = card.id;
    const target = uploadTarget.current;
    const key = startUpload({
      file,
      projectId,
      boardId,
      onAsset: (assetId) => {
        if (target === 'photo') {
          updateElement(store.doc, id, { assetId }, LOCAL);
          return;
        }
        const latest = store.getSnapshot().byId.get(id);
        addReference(assetId, latest?.type === 'character' ? (latest.references ?? []) : []);
      },
    });
    if (target === 'photo') setUploadKey(key);
    setPicking(null);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && picking) {
      e.stopPropagation();
      setPicking(null);
    }
  };

  /** One field: an input, or for guests only the text it holds. */
  const field = (
    key:
      | 'age'
      | 'nickname'
      | 'profession'
      | 'origin'
      | 'actor'
      | 'appearance'
      | 'description'
      | 'wants'
      | 'fears'
      | 'arc'
      | 'costume',
    max: number,
    rows?: number,
  ) => {
    const label = t(`story.character.${key}`);
    const value = card[key] ?? '';
    if (guest) return value ? <ReadField label={label} value={value} key={key} /> : null;
    return (
      <TextField
        key={key}
        label={label}
        value={value}
        multiline={!!rows}
        rows={rows}
        readOnly={locked}
        onCommit={(v) => set({ [key]: clean(v, max) })}
      />
    );
  };
  const filled = (...values: Array<string | undefined>) => values.filter(Boolean).length;
  const fieldCount = (count: number) =>
    count > 0 ? t('story.character.fieldCount', { count }) : t('story.character.empty');
  const emptyMark = (hasContent: boolean) =>
    hasContent || guest ? undefined : t('story.character.empty');
  const identityFilled = filled(
    card.role,
    card.age,
    card.nickname,
    card.profession,
    card.origin,
    card.actor,
  );
  const storyFilled = filled(card.description, card.wants, card.fears, card.arc);
  const looksFilled = !!card.appearance || references.length > 0;
  const candidates = [...snap.byId.values()].filter(
    (el): el is CharacterCard =>
      el.type === 'character' &&
      el.id !== card.id &&
      !relations.some((relation) => relation.characterId === el.id),
  );

  const pictureChooser = (target: 'photo' | 'reference') =>
    picking === target &&
    !locked && (
      <div className="story-panel__chooser">
        <BoardPictures
          store={store}
          onPick={(assetId) => {
            if (target === 'photo') set({ assetId });
            else addReference(assetId, references);
            setPicking(null);
          }}
        />
        <div className="story-panel__chooser-actions">
          {target === 'reference' && (
            <Button icon="upload" variant="ghost" onClick={() => chooseFile('reference')}>
              {t('story.character.photo')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setPicking(null)}>
            {t('story.character.closePicker')}
          </Button>
        </div>
      </div>
    );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc from the controls inside closes the chooser
    <div className="story-panel__sheet" onKeyDown={onKeyDown}>
      <div className="story-panel__intro">
        <div className="story-panel__picture">
          <StoryPicture
            assetId={card.assetId}
            label={card.name}
            pixels={192}
            kind="character"
            preview={uploading || failed ? upload?.preview : undefined}
          />
          {card.assetId && !locked && !uploading && (
            <IconButton
              icon="close"
              label={t('story.removePicture')}
              onClick={() => set({ assetId: undefined })}
            />
          )}
        </div>
        <div className="story-panel__who">
          {guest ? (
            <>
              <strong className="story-panel__guest-name">{card.name}</strong>
              {subtitle && <span>{subtitle}</span>}
              {card.actor && <span>{t('story.character.actorLine', { name: card.actor })}</span>}
            </>
          ) : (
            <>
              <TextField
                label={t('story.character.name')}
                value={card.name}
                placeholder={t('story.character.namePlaceholder')}
                readOnly={locked}
                className="story-panel__name"
                onCommit={(v) => set({ name: v.trim().slice(0, 120) })}
              />
              {uploading ? (
                <div className="story-panel__progress">
                  <span role="status">
                    {t('story.character.uploading', {
                      percent: upload?.size ? Math.round((upload.sent / upload.size) * 100) : 0,
                    })}
                  </span>
                  <div className="story-panel__bar" aria-hidden="true">
                    <i
                      style={{
                        transform: `scaleX(${upload?.size ? upload.sent / upload.size : 0})`,
                      }}
                    />
                  </div>
                </div>
              ) : !locked ? (
                <div className="film-panel__picture-actions">
                  <Button icon="upload" variant="ghost" onClick={() => chooseFile('photo')}>
                    {t('story.character.photo')}
                  </Button>
                  <Button
                    icon="image"
                    variant="ghost"
                    aria-expanded={picking === 'photo'}
                    onClick={() => setPicking(picking === 'photo' ? null : 'photo')}
                  >
                    {t('story.fromBoard')}
                  </Button>
                </div>
              ) : (
                card.locked && (
                  <div className="film-panel__picture-actions">
                    <Button icon="upload" variant="ghost" disabled>
                      {t('story.character.photo')}
                    </Button>
                    <span className="film-chip story-panel__locked">
                      <Icon name="lock" size={12} />
                      {t('story.character.locked')}
                    </span>
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
      {failed && upload && !locked && (
        <div className="story-panel__alert" role="alert">
          <strong>{t('story.character.uploadFailed')}</strong>
          <span>{t('story.character.uploadFailedHint')}</span>
          <div className="film-panel__picture-actions">
            <Button variant="secondary" onClick={() => retryUpload(upload.key)}>
              {t('story.character.retry')}
            </Button>
            <Button variant="ghost" onClick={() => setPicking('photo')}>
              {t('story.fromBoard')}
            </Button>
          </div>
        </div>
      )}
      {pictureChooser('photo')}
      {(!guest || filled(card.nickname, card.profession, card.origin) > 0) && (
        <Section
          title={t('story.character.identity')}
          count={guest ? undefined : fieldCount(identityFilled)}
          open={identityFilled > 0}
        >
          <div className="story-section__grid">
            {!guest && (
              <PresetField
                label={t('story.character.role')}
                value={
                  ROLE_CODES.find((code) => t(`story.character.roles.${code}`) === card.role) ??
                  card.role
                }
                codes={ROLE_CODES}
                prefix="story.character.roles"
                readOnly={locked}
                onCommit={(v) => {
                  const code = ROLE_CODES.find((c) => c === v);
                  // shortcut: a preset is stored in the language of who picks it, so the card, its
                  // export and older clients show it as text; a shared code needs a schema change.
                  set({ role: code ? t(`story.character.roles.${code}`) : clean(v ?? '', 200) });
                }}
              />
            )}
            {!guest && field('age', 40)}
            {field('nickname', 120)}
            {field('profession', 200)}
            {field('origin', 200)}
            {!guest && field('actor', 120)}
          </div>
        </Section>
      )}
      {(!guest || looksFilled) && (
        <Section
          title={t('story.character.appearance')}
          count={
            references.length > 0
              ? t('story.character.referenceCount', { count: references.length })
              : emptyMark(looksFilled)
          }
          open={looksFilled}
        >
          {field('appearance', 4000, 2)}
          {(references.length > 0 || !locked) && (
            <div className="story-panel__thumbs">
              {references.map((assetId, index) => (
                <div className="story-panel__thumb" key={assetId}>
                  <StoryPicture
                    assetId={assetId}
                    label={t('story.character.referenceLabel', {
                      name: card.name,
                      number: index + 1,
                    })}
                    pixels={160}
                    kind="character"
                  />
                  {!locked && (
                    <IconButton
                      icon="close"
                      label={t('story.character.removeReference', { number: index + 1 })}
                      onClick={() => set({ references: references.filter((id) => id !== assetId) })}
                    />
                  )}
                </div>
              ))}
              {!locked && references.length < 60 && (
                <button
                  type="button"
                  className="story-panel__thumb-add"
                  aria-label={t('story.character.addReference')}
                  aria-expanded={picking === 'reference'}
                  onClick={() => setPicking(picking === 'reference' ? null : 'reference')}
                >
                  <Icon name="plus" size={16} />
                </button>
              )}
            </div>
          )}
          {pictureChooser('reference')}
        </Section>
      )}
      {(!guest || storyFilled > 0) && (
        <Section
          title={t('story.character.history')}
          count={guest ? undefined : fieldCount(storyFilled)}
        >
          {field('description', 4000, 2)}
          {field('wants', 4000)}
          {field('fears', 4000)}
          {field('arc', 4000)}
        </Section>
      )}
      {(!guest || relations.length > 0) && (
        <Section
          title={t('story.character.relations')}
          count={relations.length > 0 ? String(relations.length) : emptyMark(false)}
        >
          {relations.map((relation, index) => {
            const other = snap.byId.get(relation.characterId);
            const known = other?.type === 'character' ? other : undefined;
            const name = known
              ? known.name || t('story.character.namePlaceholder')
              : t('story.character.missing');
            return (
              <div className={`story-rel${known ? '' : ' is-missing'}`} key={relation.characterId}>
                <StoryPicture assetId={known?.assetId} label={name} pixels={48} kind="character" />
                <span className="story-rel__name" title={name}>
                  {name}
                </span>
                {locked ? (
                  relation.label && <small>{relation.label}</small>
                ) : (
                  <>
                    <input
                      key={relation.label}
                      className="ink-input story-rel__label"
                      aria-label={t('story.character.relationWith', { name })}
                      placeholder={t('story.character.relationPlaceholder')}
                      defaultValue={relation.label}
                      onKeyDown={blurOnEnter}
                      onBlur={(e) => {
                        const label = e.target.value.trim().slice(0, 200);
                        if (label !== relation.label)
                          set({
                            relations: relations.map((r, i) => (i === index ? { ...r, label } : r)),
                          });
                      }}
                    />
                    <IconButton
                      icon="close"
                      label={t('story.character.removeRelation', { name })}
                      onClick={() => set({ relations: relations.filter((_, i) => i !== index) })}
                    />
                  </>
                )}
              </div>
            );
          })}
          {!locked &&
            (addingRelation ? (
              candidates.length > 0 ? (
                <Select
                  aria-label={t('story.character.addRelation')}
                  value=""
                  onChange={(characterId) => {
                    if (!characterId) return;
                    set({ relations: [...relations, { characterId, label: '' }] });
                    setAddingRelation(false);
                  }}
                >
                  <option value="">{t('story.character.pickCharacter')}</option>
                  {candidates.map((el) => (
                    <option key={el.id} value={el.id}>
                      {el.name || t('story.character.namePlaceholder')}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="film-field__hint">{t('story.character.noOtherCharacters')}</p>
              )
            ) : (
              <button
                type="button"
                className="story-panel__link"
                onClick={() => setAddingRelation(true)}
              >
                + {t('story.character.addRelation')}
              </button>
            ))}
        </Section>
      )}
      {(!guest || card.costume) && (
        <Section title={t('story.character.costume')} count={emptyMark(!!card.costume)}>
          {field('costume', 4000, 2)}
        </Section>
      )}
      {(!guest || allScenes.length > 0) && (
        <Section
          title={t('story.scenes')}
          count={allScenes.length > 0 ? String(allScenes.length) : emptyMark(false)}
        >
          {allScenes.length > 0 && (
            <ul className="story-panel__scenes">
              {allScenes.map((number) => (
                <li className="film-chip story-chip" key={number}>
                  {t('needed.sceneNumber', { number })}
                </li>
              ))}
            </ul>
          )}
          {frames > 0 && (
            <p className="film-field__hint">
              {t('story.character.scenesFromFrames', {
                frames: t('story.character.frameCount', { count: frames }),
              })}
            </p>
          )}
          {!guest && (
            <TextField
              label={t('story.character.manualScenes')}
              value={(card.scenes ?? []).join(', ')}
              hint={t('story.scenesHint')}
              readOnly={locked}
              onCommit={(v) => set({ scenes: parseScenes(v) })}
            />
          )}
        </Section>
      )}
      {!guest && (
        <Section title={t('story.teamOnly')} count={fieldCount(filled(card.contact, card.notes))}>
          <p className="film-field__hint">{t('story.teamOnlyHint')}</p>
          <TextField
            label={t('story.character.contact')}
            value={card.contact ?? ''}
            readOnly={locked}
            onCommit={(v) => set({ contact: clean(v, 500) })}
          />
          <TextField
            label={t('story.notes')}
            value={card.notes ?? ''}
            multiline
            readOnly={locked}
            onCommit={(v) => set({ notes: clean(v, 4000) })}
          />
        </Section>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="film-field story-panel__read">
      <span className="film-field__label">{label}</span>
      <p>{value}</p>
    </div>
  );
}
