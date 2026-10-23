import { createElement, updateElement } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { Asset } from '@inkadra/shared';
import { Button, IconButton } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickVariant, useAsset } from './assets.ts';
import { type BoardStore, LOCAL } from './store.ts';
import { TagEditor } from './tags.tsx';

type Exif = Record<string, unknown>;

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** 1/250 s for short exposures, 2.5 s for long ones. */
export function shutterText(seconds: number): string {
  if (seconds >= 1) return `${Math.round(seconds * 10) / 10} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

/** The EXIF fields worth showing, in the order a photographer reads them. */
export function exifRows(exif: Exif | null, locale: string): Array<{ key: string; value: string }> {
  if (!exif) return [];
  const rows: Array<{ key: string; value: string }> = [];
  const add = (key: string, value: string) => value && rows.push({ key, value });
  const make = text(exif.Make);
  const model = text(exif.Model);
  add('camera', model.startsWith(make) ? model : [make, model].filter(Boolean).join(' '));
  add('lens', text(exif.LensModel));
  const focal = typeof exif.FocalLength === 'number' ? `${Math.round(exif.FocalLength)} mm` : '';
  const ff =
    typeof exif.FocalLengthIn35mmFormat === 'number' &&
    exif.FocalLengthIn35mmFormat !== Math.round(Number(exif.FocalLength))
      ? ` (${exif.FocalLengthIn35mmFormat} mm eq.)`
      : '';
  add('focal', focal && focal + ff);
  add('aperture', typeof exif.FNumber === 'number' ? `ƒ/${exif.FNumber}` : '');
  add('shutter', typeof exif.ExposureTime === 'number' ? shutterText(exif.ExposureTime) : '');
  add('iso', text(exif.ISO));
  const taken = text(exif.DateTimeOriginal);
  const date = taken ? new Date(taken) : null;
  add(
    'taken',
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
      : '',
  );
  return rows;
}

/** Full view of an image or a video, with its shooting data, palette and tags. */
export function MediaViewer({
  store,
  element,
  projectId,
  userId,
  readOnly,
  onClose,
}: {
  store: BoardStore;
  element: Extract<Element, { type: 'image' | 'file' }>;
  projectId: string;
  userId: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const asset = useAsset(element.assetId);
  const ready: Asset | null = asset && asset !== 'missing' ? asset : null;
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      // The canvas behind listens on window too.
      e.stopImmediatePropagation();
      if (e.type === 'keydown' && e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [onClose]);

  const rows = exifRows(ready?.exif ?? null, i18n.language);
  const palette = ready?.palette ?? [];
  const wide = Math.min(2400, window.innerWidth * (window.devicePixelRatio || 1));

  function addColors() {
    store.undo.stopCapturing();
    store.doc.transact(() => {
      palette.forEach((hex, i) => {
        createElement(
          store.doc,
          'color',
          { x: element.x + element.w + 24 + (i % 3) * 132, y: element.y + Math.floor(i / 3) * 132 },
          { hex },
          { userId, origin: LOCAL },
        );
      });
    }, LOCAL);
    onClose();
  }

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={ready?.filename ?? t('viewer.title')}
      data-chrome
    >
      <div
        className="viewer__stage"
        onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {ready?.kind === 'video' ? (
          // biome-ignore lint/a11y/useMediaCaption: people's own footage has no captions
          <video
            className="viewer__media"
            src={ready.url}
            poster={ready.variants.length > 0 ? pickVariant(ready, wide) : undefined}
            controls
            autoPlay
          />
        ) : ready ? (
          <img
            className="viewer__media"
            src={pickVariant(ready, wide) || ready.url}
            alt={element.type === 'image' ? (element.caption ?? ready.filename) : ready.filename}
          />
        ) : null}
      </div>
      <aside className="viewer__side" data-scroll>
        <header className="viewer__head">
          <span className="viewer__name">{ready?.filename}</span>
          <IconButton icon="close" label={t('viewer.close')} onClick={onClose} />
        </header>
        {ready?.width && ready.height && (
          <dl className="viewer__facts">
            <dt>{t('viewer.size')}</dt>
            <dd>
              {ready.width} × {ready.height}
            </dd>
          </dl>
        )}
        {ready?.kind !== 'video' && (
          <section>
            <h3 className="viewer__title">{t('viewer.exif')}</h3>
            {rows.length === 0 ? (
              <p className="ink-muted viewer__none">{t('viewer.noExif')}</p>
            ) : (
              <dl className="viewer__facts">
                {rows.map((r) => (
                  <div key={r.key} className="viewer__fact">
                    <dt>{t(`viewer.fields.${r.key}`)}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        )}
        {palette.length > 0 && (
          <section>
            <h3 className="viewer__title">{t('viewer.palette')}</h3>
            <div className="viewer__palette">
              {palette.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className="viewer__swatch"
                  style={{ background: hex }}
                  aria-label={t('viewer.copyHex', { hex })}
                  title={t('viewer.copyHex', { hex })}
                  onClick={() => {
                    void navigator.clipboard?.writeText(hex);
                    setCopied(hex);
                  }}
                >
                  <span className="ink-mono">{hex}</span>
                </button>
              ))}
            </div>
            <p className="viewer__copied" role="status">
              {copied ? t('viewer.copied', { hex: copied }) : ''}
            </p>
            {!readOnly && (
              <Button icon="color" onClick={addColors}>
                {t('viewer.addColors')}
              </Button>
            )}
          </section>
        )}
        <section>
          <h3 className="viewer__title">{t('tags.title')}</h3>
          <TagEditor
            tags={element.tags ?? []}
            readOnly={readOnly}
            projectId={projectId}
            onChange={(tags) => updateElement(store.doc, element.id, { tags }, LOCAL)}
          />
        </section>
        {ready && (
          <a
            className="ink-btn ink-btn--ghost viewer__download"
            href={ready.url}
            download={ready.filename}
          >
            {t('viewer.download')}
          </a>
        )}
      </aside>
    </div>
  );
}
