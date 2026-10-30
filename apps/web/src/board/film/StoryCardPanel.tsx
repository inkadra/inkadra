// SPDX-License-Identifier: AGPL-3.0-only
import { deleteElements, updateElement } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { Button, IconButton } from '@inkadra/ui';
import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { pickVariant, useAsset } from '../assets.ts';
import { GuestModeContext } from '../context.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { TagEditor } from '../tags.tsx';
import { startUpload } from '../uploads.ts';
import { TextField } from './fields.tsx';

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
          label={t(`story.${kind}.name`)}
          value={card.name}
          placeholder={t(`story.${kind}.namePlaceholder`)}
          readOnly={locked}
          className="story-panel__name"
          onCommit={(v) => set({ name: v.trim().slice(0, kind === 'character' ? 120 : 200) })}
        />
        {card.type === 'character' ? (
          <>
            <div className="film-panel__row">
              <TextField
                label={t('story.character.role')}
                value={card.role ?? ''}
                placeholder={t('story.character.rolePlaceholder')}
                readOnly={locked}
                onCommit={(v) => set({ role: text(v, 200) })}
              />
              <TextField
                label={t('story.character.age')}
                value={card.age ?? ''}
                readOnly={locked}
                onCommit={(v) => set({ age: text(v, 40) })}
              />
            </div>
            <TextField
              label={t('story.character.actor')}
              value={card.actor ?? ''}
              readOnly={locked}
              onCommit={(v) => set({ actor: text(v, 120) })}
            />
            <TextField
              label={t('story.character.description')}
              value={card.description ?? ''}
              multiline
              readOnly={locked}
              onCommit={(v) => set({ description: text(v, 4000) })}
            />
          </>
        ) : (
          <>
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
          </>
        )}
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
            {card.type === 'location' && (
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
                  hint={badMap ? t('story.location.mapUrlInvalid') : t('story.location.mapUrlHint')}
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
            )}
            <TextField
              label={t(`story.${kind}.contact`)}
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
      <select
        id={id}
        className="ink-input"
        value={value ?? ''}
        disabled={readOnly}
        onChange={(e) => onCommit((e.target.value || undefined) as typeof value)}
      >
        <option value="">–</option>
        {(['int', 'ext', 'int-ext'] as const).map((s) => (
          <option key={s} value={s}>
            {t(`film.scene.settings.${s}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The picture of a story card, or its type icon on a quiet surface. */
export function StoryPicture({
  assetId,
  label,
  pixels,
  kind,
}: {
  assetId: string | undefined;
  label: string;
  pixels: number;
  kind: 'character' | 'location';
}) {
  const asset = useAsset(assetId);
  const ready = asset && asset !== 'missing' ? asset : null;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return (
    <div className={`story-picture story-picture--${kind}`}>
      {ready ? (
        <img src={pickVariant(ready, pixels * dpr)} alt={label} draggable={false} />
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
