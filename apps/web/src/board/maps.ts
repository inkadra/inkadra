// SPDX-License-Identifier: AGPL-3.0-only
import { updateElement } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { AssetTrack, MapPreview } from '@inkadra/shared';
import type * as Y from 'yjs';
import { api } from '../lib/api.ts';
import { webUrl } from './links.ts';
import { LOCAL } from './store.ts';

type MapElement = Extract<Element, { type: 'map' }>;

/**
 * Asks the server for the place of a map link or an address and its map picture, and fills in
 * the card. A failure leaves the card with what it has: the name, the address or the link.
 */
export async function fillMapPreview(
  doc: Y.Doc,
  elementId: string,
  projectId: string,
  boardId: string,
  from: { url: string } | { query: string },
): Promise<boolean> {
  let preview: MapPreview;
  try {
    preview = await api.post<MapPreview>('/map-previews', { projectId, boardId, ...from });
  } catch {
    return false;
  }
  const map = doc.getMap<Y.Map<unknown>>('elements').get(elementId);
  const name = map?.get('name');
  updateElement(
    doc,
    elementId,
    {
      lat: preview.lat ?? undefined,
      lon: preview.lon ?? undefined,
      zoom: preview.zoom ?? undefined,
      imageAssetId: preview.imageAssetId ?? undefined,
      // A typed address stays the card's name; a link names the place when it can.
      ...('url' in from
        ? { url: webUrl(preview.url ?? undefined) ?? from.url, name: name || preview.name || '' }
        : {}),
    },
    LOCAL,
  );
  return true;
}

/** "Open in Maps": the link the card came from, else OpenStreetMap at the place or the address. */
export function openInMapsUrl(
  el: Pick<MapElement, 'url' | 'lat' | 'lon' | 'zoom' | 'address' | 'name'>,
): string | null {
  const link = webUrl(el.url);
  if (link) return link;
  if (el.lat !== undefined && el.lon !== undefined) {
    const z = el.zoom ?? 16;
    return `https://www.openstreetmap.org/?mlat=${el.lat}&mlon=${el.lon}#map=${z}/${el.lat}/${el.lon}`;
  }
  const query = el.address || el.name;
  return query ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}` : null;
}

/** 25 km, 2,4 km, 850 m: one decimal under ten kilometres. */
export function formatDistance(metres: number, locale?: string): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km);
  return `${n} km`;
}

/** +1050 m of climb. */
export function formatClimb(metres: number): string {
  return `+${Math.round(metres)} m`;
}

/**
 * The points of a route as [lat, lon], for an interactive map: its line is kept in fractions of
 * the map picture, put back on the map through the picture's view (Web Mercator, 256 px tiles).
 * Null for routes read before the view was recorded.
 */
export function trackLatLngs(track: AssetTrack): Array<[number, number]> | null {
  const { view, points } = track;
  if (!view) return null;
  const world = 256 * 2 ** view.zoom;
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = (view.left + (points[i] as number) * 1024) / world;
    const y = (view.top + (points[i + 1] as number) * 560) / world;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
    out.push([lat, x * 360 - 180]);
  }
  return out;
}
