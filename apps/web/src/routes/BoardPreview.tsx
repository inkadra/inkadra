import type { BoardPreview as Preview, Project } from '@inkadra/shared';
import { Icon, ProjectGlyph } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickVariant, useAsset } from '../board/assets.ts';
import { api } from '../lib/api.ts';

function PreviewImage({ id }: { id: string }) {
  const asset = useAsset(id);
  const [failed, setFailed] = useState(false);
  const src = asset && asset !== 'missing' ? pickVariant(asset, 512) : '';
  return src && !failed ? (
    <img loading="lazy" src={src} alt="" onError={() => setFailed(true)} />
  ) : null;
}

/** Re-fetch on mount: no cross-account or indefinitely stale document projection cache. */
export function BoardPreview({ boardId, project }: { boardId: string; project?: Project }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setPreview(null);
    setFailed(false);
    api
      .get<Preview>(`/boards/${boardId}/preview`, abort.signal)
      .then(setPreview)
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [boardId]);
  const hasContent = preview && preview.elementCount > 0;
  return (
    <span className="home__cover home__preview">
      {project && (
        <span className="home__preview-glyph" aria-hidden="true">
          <ProjectGlyph {...project.icon} />
        </span>
      )}
      {preview && preview.assetIds.length > 0 && (
        <span className="home__preview-images">
          {preview.assetIds.map((id) => (
            <PreviewImage key={id} id={id} />
          ))}
        </span>
      )}
      {preview && preview.drawing.length > 0 && (
        <svg className="home__preview-drawing" viewBox="0 0 4096 4096" aria-hidden="true">
          {preview.drawing.map((line) => (
            <path
              key={line.path}
              d={line.path}
              stroke={line.color}
              strokeWidth={line.width}
              fill="none"
              strokeLinecap="round"
            />
          ))}
        </svg>
      )}
      {preview && preview.excerpts.length > 0 && (
        <span className="home__preview-text">
          {[...new Set(preview.excerpts)].map((text) => (
            <span key={text}>{text}</span>
          ))}
        </span>
      )}
      <span className="home__preview-summary">
        {!project && <Icon name="board" size={16} />}
        {failed
          ? t('home.preview.unavailable')
          : !preview
            ? t('comments.loading')
            : hasContent
              ? t('home.preview.cards', { count: preview.elementCount })
              : t('home.preview.empty')}
      </span>
    </span>
  );
}
