// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@inkadra/ui';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Render one bounded-size page at a time, without annotations or executable PDF actions. */
export function PdfReader({ url, name }: { url: string; name: string }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    let timedOut = false;
    let task: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      if (alive) setError(true);
      void task?.destroy().catch(() => {});
    }, 15_000);
    setPdf(null);
    setPage(1);
    setError(false);
    void import('pdfjs-dist')
      .then(async ({ GlobalWorkerOptions, getDocument }) => {
        if (!alive || timedOut) return;
        GlobalWorkerOptions.workerSrc = workerUrl;
        task = getDocument({
          url,
          useWorkerFetch: false,
          disableAutoFetch: true,
          stopAtErrors: true,
        });
        const document = await task.promise;
        if (alive) setPdf(document);
      })
      .catch(() => alive && setError(true))
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
      void task?.destroy().catch(() => {});
    };
  }, [url]);
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setRendered(false);
    void pdf
      .getPage(page)
      .then(async (source) => {
        if (!alive || !canvas.current) return;
        const viewport = source.getViewport({ scale: 1 });
        if (![viewport.width, viewport.height].every((n) => Number.isFinite(n) && n > 0))
          throw new Error('Invalid PDF page dimensions');
        const scaled = source.getViewport({
          scale: Math.min(2, 1600 / Math.max(viewport.width, viewport.height)),
        });
        canvas.current.width = scaled.width;
        canvas.current.height = scaled.height;
        render = source.render({ canvas: canvas.current, viewport: scaled });
        await render.promise;
        if (alive) setRendered(true);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
      render?.cancel();
    };
  }, [pdf, page]);
  return (
    <>
      {error ? (
        <p role="alert">{t('viewer.pdfError')}</p>
      ) : (
        !rendered && <p role="status">{t('viewer.pdfLoading')}</p>
      )}
      <canvas
        role="img"
        ref={canvas}
        className="viewer__media viewer__media--contain viewer__pdf-page"
        aria-label={t('viewer.pdfPage', { name, page, total: pdf?.numPages ?? 0 })}
        hidden={!rendered || error}
      />
      {pdf && !error && (
        <div className="viewer__pdf-bar">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('viewer.pdfPrevious')}
          </Button>
          <span aria-live="polite">{t('viewer.pdfPageNumber', { page, total: pdf.numPages })}</span>
          <Button
            variant="secondary"
            disabled={page >= pdf.numPages}
            onClick={() => setPage(page + 1)}
          >
            {t('viewer.pdfNext')}
          </Button>
        </div>
      )}
    </>
  );
}
