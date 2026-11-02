/* biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA combobox keeps focus in its input and identifies options with aria-activedescendant. */

import type { Point } from '@inkadra/canvas-core';
import type { MapSearchPlace, MapSearchResults } from '@inkadra/shared';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { webUrl } from './links.ts';
import './map-draft.css';

export type MapSource = { url: string } | { place: MapSearchPlace; query: string };

/** Suggestions never create image assets; only the chosen coordinates generate a preview. */
export function MapDraft({
  at,
  projectId,
  boardId,
  geocoding,
  onSubmit,
  onCancel,
}: {
  at: Point;
  projectId: string;
  boardId: string;
  geocoding: boolean;
  onSubmit: (source: MapSource) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState('');
  const [items, setItems] = useState<MapSearchPlace[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const query = value.trim();
  const link = /^https?:\/\//i.test(query);
  useEffect(() => {
    setItems([]);
    setActive(0);
    if (!geocoding || link || query.length < 3) {
      setStatus('idle');
      return;
    }
    if (query.length > 500) {
      setStatus('error');
      return;
    }
    let current = true;
    setStatus('loading');
    const timer = setTimeout(() => {
      api
        .post<MapSearchResults>('/map-search', { projectId, boardId, query })
        .then((result) => {
          if (!current) return;
          setItems(result.items);
          setStatus(result.items.length ? 'idle' : 'empty');
        })
        .catch(() => {
          if (current) setStatus('error');
        });
    }, 600);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [projectId, boardId, query, geocoding, link]);
  const pick = (place: MapSearchPlace) => onSubmit({ place, query });
  return (
    <form
      className="canvas__linkdraft map-draft"
      style={{
        left: Math.max(8, Math.min(at.x, window.innerWidth - 316)),
        top: Math.max(8, Math.min(at.y, window.innerHeight - 340)),
      }}
      data-chrome
      onSubmit={(e) => {
        e.preventDefault();
        const url = link && webUrl(query);
        if (url) onSubmit({ url });
        else if (items[active]) pick(items[active]);
        else if (status !== 'loading') setStatus('error');
      }}
    >
      <input
        className="ink-input"
        role="combobox"
        aria-label={t('board.map.label')}
        aria-expanded={items.length > 0}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={items.length ? `${id}-${active}` : undefined}
        aria-describedby={`${id}-status`}
        aria-invalid={status === 'error' || undefined}
        autoComplete="off"
        maxLength={2048}
        // biome-ignore lint/a11y/noAutofocus: the user explicitly opened the map tool.
        autoFocus
        placeholder={t('board.map.placeholder')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setItems([]);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else if (items.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          }
        }}
      />
      <ul id={id} role="listbox" aria-label={t('board.map.suggestions')} hidden={!items.length}>
        {items.map((place, i) => (
          <li
            key={`${place.lat}:${place.lon}:${place.name}`}
            tabIndex={-1}
            role="option"
            id={`${id}-${i}`}
            aria-selected={i === active}
          >
            <button
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(place)}
            >
              {place.name}
            </button>
          </li>
        ))}
      </ul>
      <p id={`${id}-status`} role={status === 'error' ? 'alert' : 'status'} aria-live="polite">
        {!geocoding && !link && query
          ? t('board.map.geocoderUnavailable')
          : status === 'loading'
            ? t('board.map.searching')
            : status === 'empty'
              ? t('board.map.noResults')
              : status === 'error'
                ? t('board.map.searchError')
                : query.length > 0 && query.length < 3 && !link
                  ? t('board.map.searchHint')
                  : ''}
      </p>
    </form>
  );
}
