// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import type { AssetTrack } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import { pickVariant, useAsset } from './assets.ts';
import { useBoard } from './context.ts';
import { openInMapsUrl } from './maps.ts';

type MapElement = Extract<Element, { type: 'map' }>;

/** Width / height of every map picture the server makes (decision 0053). */
export const MAP_ASPECT = '1024 / 560';

/** Credit of the map data, on every map picture. */
export function MapCredit() {
  const text = useBoard().mapAttribution;
  return text ? <span className="mcard__credit">{text}</span> : null;
}

/** A GPX route over its map: the line, a dot where it starts and one where it ends. */
export function TrackLine({ track }: { track: AssetTrack }) {
  const p = track.points;
  if (p.length < 2) return null;
  const pts: string[] = [];
  for (let i = 0; i + 1 < p.length; i += 2)
    pts.push(`${(p[i] as number) * 1024},${(p[i + 1] as number) * 560}`);
  const [sx, sy] = [(p[0] as number) * 1024, (p[1] as number) * 560];
  const [ex, ey] = [(p[p.length - 2] as number) * 1024, (p[p.length - 1] as number) * 560];
  return (
    <svg
      className="mcard__track"
      viewBox="0 0 1024 560"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <polyline className="mcard__halo" points={pts.join(' ')} />
      <polyline points={pts.join(' ')} />
      <circle className="mcard__start" cx={sx} cy={sy} r="15" />
      <circle className="mcard__end" cx={ex} cy={ey} r="15" />
    </svg>
  );
}

/**
 * A map card (#319): the map picture with a pin on the place, its name and "Open in Maps".
 * Without a picture (maps off, an address the server could not place) it is the name, the
 * address and the link, in the footer every file card shares.
 */
export function MapCard({ element, width }: { element: MapElement; width: number }) {
  const { t } = useTranslation();
  const { scale } = useBoard();
  const image = useAsset(element.imageAssetId);
  const ready = image && image !== 'missing' ? image : null;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const src = ready && ready.variants.length > 0 ? pickVariant(ready, width * scale * dpr) : '';
  const href = openInMapsUrl(element);
  const coords =
    element.lat !== undefined && element.lon !== undefined
      ? `${element.lat.toFixed(4)}, ${element.lon.toFixed(4)}`
      : '';
  const title = element.name || element.address || coords || t('board.map.untitled');
  const detail = element.address && element.address !== title ? element.address : '';
  return (
    <div className="fcard mcard">
      {src && (
        <div className="fcard__media">
          <div className="fcard__preview mcard__map" style={{ aspectRatio: MAP_ASPECT }}>
            <img className="fcard__img" src={src} alt="" draggable={false} decoding="async" />
            <span className="mcard__pin" aria-hidden="true" />
            <MapCredit />
          </div>
        </div>
      )}
      <div className="fcard__footer">
        <span className="fcard__name mcard__name" title={title}>
          {!src && <Icon name="pin" size={12} />}
          <span className="fcard__stem">{title}</span>
        </span>
        <span className="fcard__meta">
          {detail && <span className="fcard__meta-text">{detail}</span>}
          {href && (
            <a
              className="mcard__open"
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              data-no-drag
            >
              {t('board.map.open')} ↗
            </a>
          )}
        </span>
      </div>
    </div>
  );
}
