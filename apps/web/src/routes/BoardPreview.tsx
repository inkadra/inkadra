import type { BoardPreview as Preview, Project } from '@inkadra/shared';
import { Icon, ProjectGlyph } from '@inkadra/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickVariant, useAsset } from '../board/assets.ts';
import { api } from '../lib/api.ts';

/** Reports a load failure so the card falls back to the project tint instead of a broken image. */
function CoverImage({ id, onFail }: { id: string; onFail: () => void }) {
  const asset = useAsset(id);
  const src = asset && asset !== 'missing' ? pickVariant(asset, 512) : '';
  useEffect(() => {
    if (asset === 'missing') onFail();
  }, [asset, onFail]);
  return src ? <img loading="lazy" src={src} alt="" onError={onFail} /> : null;
}

/**
 * One cover image: the board's chosen cover, else its first image (the server orders them).
 * Without images the card shows the project glyph on its own colour, never board text.
 * Re-fetch on mount: no cross-account or indefinitely stale document projection cache.
 */
export function BoardPreview({ boardId, project }: { boardId: string; project?: Project }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const [broken, setBroken] = useState<string[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    setPreview(null);
    setFailed(false);
    setBroken([]);
    api
      .get<Preview>(`/boards/${boardId}/preview`, abort.signal)
      .then(setPreview)
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [boardId]);
  const cover = preview?.assetIds.find((id) => !broken.includes(id));
  const summary = failed
    ? t('home.preview.unavailable')
    : !preview
      ? t('comments.loading')
      : preview.elementCount > 0
        ? t('home.preview.cards', { count: preview.elementCount })
        : t('home.preview.empty');
  const tint = project?.icon.color ?? 'neutral';
  return (
    <span
      className={cover ? 'home__cover home__preview' : 'home__cover home__preview is-tinted'}
      data-tint={cover ? undefined : tint}
    >
      {cover ? (
        <CoverImage key={cover} id={cover} onFail={() => setBroken((ids) => [...ids, cover])} />
      ) : (
        <span className="home__preview-glyph" aria-hidden="true">
          {project ? <ProjectGlyph {...project.icon} /> : <Icon name="board" size={16} />}
        </span>
      )}
      <span className="home__preview-summary">{summary}</span>
    </span>
  );
}
