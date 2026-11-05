// SPDX-License-Identifier: AGPL-3.0-only

import type { AssetTrack } from '@inkadra/shared';
import { IconButton, useBackdropClick } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoard } from './context.ts';
import { playInline, stopInline, useInlinePlaying } from './inline-player.ts';
import { trackLatLngs } from './maps.ts';

/**
 * The map card being explored (#373) takes the one turn of the board's inline players (#367):
 * exploring a map stops a playing video or sound, and playing one returns the map to its
 * picture, as do Esc and a press outside the card.
 */
export const exploreMap = (id: string | null) => playInline(id);
export const useExploring = useInlinePlaying;

/** "Explore" over a map picture, when the instance serves tiles (not with MAPS=false). */
export function ExploreButton({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();
  if (!useBoard().mapTiles) return null;
  return (
    <button
      type="button"
      className="mcard__explore"
      data-no-drag
      aria-label={t('board.map.exploreLabel', { name })}
      onClick={(event) => {
        event.stopPropagation();
        exploreMap(id);
      }}
    >
      {t('board.map.explore')}
    </button>
  );
}

/** The source switch also changes the non-interactive card picture, without editing the board. */
export function MapSurface({
  id,
  name,
  place,
  track,
  exploring,
}: {
  id: string;
  name: string;
  place?: { lat: number; lon: number; zoom: number };
  track?: AssetTrack;
  exploring: boolean;
}) {
  const { t } = useTranslation();
  const { mapTiles, mapSatelliteAttribution } = useBoard();
  const [satellite, setSatellite] = useState(false);
  if (!mapTiles) return null;
  return (
    <>
      {(exploring || satellite) && (
        <LiveMap
          id={id}
          name={name}
          place={place}
          track={track}
          satellite={satellite}
          interactive={exploring}
        />
      )}
      {!exploring && <ExploreButton id={id} name={name} />}
      {mapSatelliteAttribution && (
        <button
          type="button"
          data-no-drag
          className="mcard__explore mcard__layer"
          aria-pressed={satellite}
          onClick={(e) => {
            e.stopPropagation();
            setSatellite((v) => !v);
          }}
        >
          {t(satellite ? 'board.map.standard' : 'board.map.satellite')}
        </button>
      )}
      {satellite && (
        <span className="mcard__credit mcard__satellite-credit">{mapSatelliteAttribution}</span>
      )}
    </>
  );
}

/**
 * The interactive map, over the picture it replaces: Leaflet, loaded on the first activation,
 * with tiles from Inkadra only. The frame around it (`card__embed`, as the inline player of link
 * cards) and the card's title drag the card; the
 * map itself pans and zooms. A place gets its pin, a route its line and start and end dots.
 */
export function LiveMap({
  id,
  name,
  place,
  track,
  satellite = false,
  interactive = true,
}: {
  id: string;
  name: string;
  place?: { lat: number; lon: number; zoom: number } | undefined;
  track?: AssetTrack | null | undefined;
  satellite?: boolean;
  interactive?: boolean;
}) {
  const { t } = useTranslation();
  const tiles = useBoard().mapTiles;
  const frame = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const layer = useRef<import('leaflet').TileLayer | null>(null);
  const source = useRef('');
  const tileUrl = tiles ? (satellite ? `${tiles}?layer=satellite` : tiles) : '';
  source.current = tileUrl;
  useEffect(() => {
    if (tileUrl) layer.current?.setUrl(tileUrl);
  }, [tileUrl]);

  useEffect(() => {
    if (!interactive) return;
    // The card's own frame and title drag it without leaving the map.
    const card = frame.current?.closest('[data-el]') ?? frame.current;
    const leave = (event: Event) => {
      const done =
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !card?.contains(event.target as Node);
      if (done) stopInline(id);
    };
    window.addEventListener('keydown', leave);
    document.addEventListener('pointerdown', leave, true);
    return () => {
      window.removeEventListener('keydown', leave);
      document.removeEventListener('pointerdown', leave, true);
    };
  }, [id, interactive]);

  const [lat, lon, zoom] = [place?.lat, place?.lon, place?.zoom];
  useEffect(() => {
    const el = holder.current;
    if (!el || !tiles) return;
    let gone = false;
    let cleanup = () => {};
    void Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([L]) => {
      if (gone) return;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const map = L.map(el, {
        attributionControl: false,
        dragging: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        touchZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
        zoomControl: false,
        minZoom: 1,
        maxZoom: 19,
        zoomAnimation: !still,
        fadeAnimation: !still,
        markerZoomAnimation: !still,
        inertia: !still,
      });
      if (interactive)
        L.control
          .zoom({ zoomInTitle: t('board.map.zoomIn'), zoomOutTitle: t('board.map.zoomOut') })
          .addTo(map);
      layer.current = L.tileLayer(source.current, {
        minZoom: 1,
        maxZoom: 19,
      }).addTo(map);
      const line = track ? trackLatLngs(track) : null;
      const first = line?.[0];
      const last = line?.[line.length - 1];
      if (line && first && last) {
        L.polyline(line, { className: 'mcard__live-halo', interactive: false }).addTo(map);
        const route = L.polyline(line, { className: 'mcard__live-route', interactive: false });
        route.addTo(map);
        const dot = { radius: 6, interactive: false };
        L.circleMarker(first, { ...dot, className: 'mcard__live-start' }).addTo(map);
        L.circleMarker(last, { ...dot, className: 'mcard__live-end' }).addTo(map);
        map.fitBounds(route.getBounds(), { padding: [24, 24], animate: false });
      } else if (lat !== undefined && lon !== undefined) {
        map.setView([lat, lon], zoom ?? 16, { animate: false });
        L.circleMarker([lat, lon], {
          radius: 6,
          interactive: false,
          className: 'mcard__live-pin',
        }).addTo(map);
      }
      if (interactive) map.getContainer().focus({ preventScroll: true });
      // A card resized while explored keeps a whole map.
      const resized = new ResizeObserver(() => map.invalidateSize({ animate: false }));
      resized.observe(el);
      cleanup = () => {
        resized.disconnect();
        map.remove();
        layer.current = null;
      };
    });
    return () => {
      gone = true;
      cleanup();
    };
  }, [tiles, lat, lon, zoom, track, t, interactive]);

  return (
    <div className={`card__embed mcard__live${interactive ? '' : ' mcard__static'}`} ref={frame}>
      <div
        className="mcard__leaflet"
        ref={holder}
        data-no-drag
        role="application"
        aria-hidden={!interactive}
        aria-label={t('board.map.interactive', { name })}
        data-explored={id}
      />
    </div>
  );
}

/** The same map as the card, in a modal viewport for inspecting a location. */
export function MapDialog({
  id,
  name,
  place,
  onClose,
}: {
  id: string;
  name: string;
  place: { lat: number; lon: number; zoom: number };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const attribution = useBoard().mapAttribution;
  const dialog = useRef<HTMLDialogElement>(null);
  const backdrop = useBackdropClick(onClose);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="map-dialog"
      aria-label={name}
      data-chrome
      {...backdrop}
      onClose={onClose}
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <span>{name}</span>
        <IconButton icon="close" label={t('board.map.close')} onClick={onClose} />
      </header>
      <div className="map-dialog__map">
        <MapSurface id={id} name={name} place={place} exploring />
        {attribution && <span className="mcard__credit">{attribution}</span>}
      </div>
    </dialog>
  );
}
