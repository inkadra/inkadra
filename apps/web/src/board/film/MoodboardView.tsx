// SPDX-License-Identifier: AGPL-3.0-only
import { frameLabels, storyboardOf } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { Button } from '@inkadra/ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useClassifications } from '../../lib/classifications.ts';
import { pickVariant, useAsset } from '../assets.ts';
import type { BoardStore } from '../store.ts';
import { normaliseTag } from '../tags.tsx';
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
  if (!asset || asset === 'missing' || !pickVariant(asset, 640)) {
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
  return (
    <img
      src={pickVariant(asset, 640)}
      alt={label || asset.filename}
      loading="lazy"
      width={asset.width ?? undefined}
      height={asset.height ?? undefined}
    />
  );
}

export function MoodboardView({
  store,
  projectId,
  userId,
  readOnly,
  onClose,
}: {
  store: BoardStore;
  projectId: string;
  userId: string;
  readOnly: boolean;
  onClose?: () => void;
}) {
  const { tagLabel, tagOption } = useClassifications();
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [tag, setTag] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const all = [...snapshot.byId.values()];
  const references = referencesOf(all);
  const tags = [
    ...new Set(
      references.flatMap((el) => (el.tags ?? []).map((v) => tagOption(v)?.id ?? normaliseTag(v))),
    ),
  ].sort();
  const filtered = referencesOf(all).filter(
    (el) => !tag || el.tags?.some((v) => (tagOption(v)?.id ?? normaliseTag(v)) === tag),
  );
  const media = filtered.filter((el): el is MediaReference => el.type !== 'color');
  const index = media.findIndex((el) => el.id === selected);
  const current = media[index];
  useEffect(() => {
    if (selected && !current) {
      setSelected(null);
      opener.current?.focus();
    }
  }, [selected, current]);
  const colors = filtered.filter((el) => el.type === 'color');
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

  return (
    <section className="film-shell moodboard" aria-label={t('nav.moodboard')}>
      <header>
        <h1>{t('nav.moodboard')}</h1>
        <span role="status">{t('moodboard.count', { count: filtered.length })}</span>
        {onClose && <Button onClick={onClose}>{t('shells.close')}</Button>}
      </header>
      <label className="moodboard__filter">
        {t('moodboard.filter')}
        <select value={tag} onChange={(event) => setTag(event.target.value)}>
          <option value="">{t('moodboard.all')}</option>
          {tags.map((value) => (
            <option key={value} value={value}>
              {tagLabel(value)}
            </option>
          ))}
          {tag && !tags.includes(tag) && <option value={tag}>{tagLabel(tag)}</option>}
        </select>
      </label>
      {colors.length > 0 && (
        <section aria-label={t('moodboard.palette')} className="moodboard__palette">
          <h2>{t('moodboard.palette')}</h2>
          <div>
            {colors.map((color) => (
              <div key={color.id} className="moodboard__color">
                <span style={{ background: color.hex }} />
                <span>{color.label || color.hex}</span>
                <code>{color.label ? color.hex : ''}</code>
              </div>
            ))}
          </div>
        </section>
      )}
      {filtered.length === 0 && (
        <p>{t(references.length ? 'moodboard.noMatches' : 'moodboard.empty')}</p>
      )}
      <div className="moodboard__gallery">
        {filtered.map((element) =>
          element.type === 'color' ? (
            <article key={element.id} className="moodboard__card">
              <div className="moodboard__swatch" style={{ background: element.hex }} />
              <div className="moodboard__caption">
                {element.label || element.hex}
                <small>{(element.tags ?? []).map(tagLabel).join(' · ')}</small>
              </div>
            </article>
          ) : (
            <button
              key={element.id}
              type="button"
              className="moodboard__card"
              aria-label={t('moodboard.open', {
                name:
                  (element.type === 'image' ? element.caption : element.title || element.url) ||
                  t('viewer.title'),
              })}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setSelected(element.id);
              }}
            >
              <ReferenceImage element={element} />
              <span className="moodboard__caption">
                {element.type === 'image' ? element.caption : element.title || element.url}
                <small>{(element.tags ?? []).map(tagLabel).join(' · ')}</small>
              </span>
            </button>
          ),
        )}
      </div>
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
