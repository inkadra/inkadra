/* biome-ignore-all lint/suspicious/noArrayIndexKey: immutable worker grids use stable cell/page coordinates */
// SPDX-License-Identifier: AGPL-3.0-only
import { type Asset, OfficePreview as OfficePreviewSchema } from '@inkadra/shared';
import { Button } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fileBadge, fileFamily } from './file-kinds.ts';
import { type OfficePreview, officeUrl } from './office.ts';

export function useOfficePreview(asset: Asset | null) {
  const [state, setState] = useState<{ id: string; data: OfficePreview | null } | null>(null);
  useEffect(() => {
    if (asset?.status !== 'ready') return;
    const abort = new AbortController();
    fetch(officeUrl(asset.id), { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('Preview unavailable');
        const data = OfficePreviewSchema.parse(await res.json());
        if (!abort.signal.aborted) setState({ id: asset.id, data });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ id: asset.id, data: null });
      });
    return () => abort.abort();
  }, [asset]);
  return asset?.status === 'ready' && state?.id === asset.id ? state.data : undefined;
}

export function OfficeStage({
  asset,
  data,
  page,
  setPage,
}: {
  asset: Asset;
  data: OfficePreview | null | undefined;
  page: number;
  setPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [failed, setFailed] = useState(false);
  const selected = data?.sheets[sheet] ?? data?.sheets[0];
  const pages = data?.pageCount ?? 0;
  if (data === undefined) return <p role="status">{t('office.loading')}</p>;
  if (selected)
    return (
      <div className="office-sheet">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll the bounded sheet */}
        <section className="office-sheet__scroll" tabIndex={0} aria-label={selected.name}>
          <table>
            <tbody>
              {selected.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) =>
                    r === 0 ? (
                      <th key={c} scope="col">
                        {cell}
                      </th>
                    ) : (
                      <td key={c}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="office-sheet__tabs" role="tablist" aria-label={t('office.sheets')}>
          {data?.sheets.map((s, i) => (
            <button
              type="button"
              role="tab"
              aria-selected={sheet === i}
              tabIndex={sheet === i ? 0 : -1}
              key={i}
              onClick={() => setSheet(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
    );
  if (!pages)
    return (
      <div className="viewer__file">
        <span className={`fcard__tile fbadge--${fileFamily(asset)}`} aria-hidden="true">
          {fileBadge(asset)}
        </span>
        <strong>{t('office.unavailable')}</strong>
        <p>{t('office.disabled')}</p>
        <a
          className="ink-btn ink-btn--secondary"
          href={`${asset.url}?download=1`}
          download={asset.filename}
        >
          {t('office.download')}
        </a>
      </div>
    );
  return (
    <div className="office-pages">
      {pages >= 3 && (
        <nav className="office-pages__thumbs" aria-label={t('office.pages')}>
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={t('office.page', { page: i + 1, count: pages })}
              aria-current={page === i + 1 ? 'page' : undefined}
              onClick={() => {
                setFailed(false);
                setPage(i + 1);
              }}
            >
              <img loading="lazy" src={officeUrl(asset.id, `page-${i + 1}.webp`)} alt="" />
            </button>
          ))}
        </nav>
      )}
      <div className="office-pages__paper">
        {failed ? (
          <p role="alert">{t('office.error')}</p>
        ) : (
          <img
            src={officeUrl(asset.id, `page-${page}.webp`)}
            alt={t('office.page', { page, count: pages })}
            style={{ width: `${zoom}%` }}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="office-pages__bar">
        <Button
          data-office-prev
          variant="ghost"
          disabled={page <= 1}
          aria-label={t('office.previous')}
          onClick={() => {
            setFailed(false);
            setPage(page - 1);
          }}
        >
          ‹
        </Button>
        <span aria-live="polite">
          {page} / {pages}
        </span>
        <Button
          data-office-next
          variant="ghost"
          disabled={page >= pages}
          aria-label={t('office.next')}
          onClick={() => {
            setFailed(false);
            setPage(page + 1);
          }}
        >
          ›
        </Button>
        <Button
          variant="ghost"
          disabled={zoom <= 50}
          aria-label={t('office.zoomOut')}
          onClick={() => setZoom(zoom - 25)}
        >
          −
        </Button>
        <span>{zoom}%</span>
        <Button
          variant="ghost"
          disabled={zoom >= 200}
          aria-label={t('office.zoomIn')}
          onClick={() => setZoom(zoom + 25)}
        >
          +
        </Button>
      </div>
    </div>
  );
}

export function OfficeInfo({
  asset,
  data,
  onTable,
}: {
  asset: Asset;
  data: OfficePreview | null | undefined;
  onTable?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const first = data?.sheets[0];
  return (
    <section className="office-info">
      <h3 className="viewer__title">{t('viewer.info')}</h3>
      <dl className="viewer__facts">
        <dt>{t('office.type')}</dt>
        <dd>{t(`office.types.${asset.filename.split('.').at(-1)?.toLowerCase()}`)}</dd>
        <dt>{t('office.size')}</dt>
        <dd>{Math.ceil(asset.size / 1024)} KB</dd>
        {!!data?.pageCount && (
          <>
            <dt>{t('office.pages')}</dt>
            <dd>{data.pageCount}</dd>
          </>
        )}
        {!!data?.sheets.length && (
          <>
            <dt>{t('office.sheets')}</dt>
            <dd>{data.sheets.length}</dd>
          </>
        )}
        {data?.uploadedAt && (
          <>
            <dt>{t('office.uploaded')}</dt>
            <dd>
              {data.uploadedBy ? `${data.uploadedBy} · ` : ''}
              {new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
                new Date(data.uploadedAt),
              )}
            </dd>
          </>
        )}
      </dl>
      {!!data?.pageCount && <p className="ink-muted">{t('office.conversion')}</p>}
      {first && (
        <>
          <Button variant="primary" disabled={!onTable || !first.rows.length} onClick={onTable}>
            {t('office.toTable')}
          </Button>
          <p className="ink-muted">
            {t('office.firstSheet', {
              name: first.name,
              rows: first.rows.length,
              columns: Math.max(0, ...first.rows.map((r) => r.length)),
            })}
          </p>
        </>
      )}
      <a
        className="ink-btn ink-btn--secondary"
        href={`${asset.url}?download=1`}
        download={asset.filename}
      >
        {t('office.download')}
      </a>
    </section>
  );
}
