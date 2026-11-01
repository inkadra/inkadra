// SPDX-License-Identifier: AGPL-3.0-only
import type { Asset } from '@inkadra/shared';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Scoped FontFace, no CSS interpolation or font installation. Browser sanitises the upload. */
export function FontSpecimen({ asset, editable = false }: { asset: Asset; editable?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const [loaded, setLoaded] = useState(false);
  const [sample, setSample] = useState('Aa');
  const family = `inkadra-font-${id.replace(/[^a-zA-Z0-9-]/g, '')}`;
  useEffect(() => {
    setLoaded(false);
    // shortcut: fonts above 8 MiB keep the fallback; raise only with measured browser limits.
    if (asset.size > 8 * 1024 ** 2 || typeof FontFace === 'undefined') return;
    const url = new URL(asset.url, location.href);
    if (url.origin !== location.origin) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let face: FontFace | undefined;
    let disposed = false;
    void (async () => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 8 * 1024 ** 2) return;
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      if (disposed) return;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      face = new FontFace(family, bytes.buffer);
      await face.load();
      if (disposed) return;
      document.fonts.add(face);
      setLoaded(true);
    })()
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      if (face) document.fonts.delete(face);
    };
  }, [asset.url, asset.size, family]);
  const name =
    typeof asset.exif?.filePreview === 'object' && asset.exif.filePreview !== null
      ? (asset.exif.filePreview as Record<string, unknown>).family
      : null;
  const specimenStyle = {
    fontFamily: loaded ? `"${family}"` : 'serif',
    fontWeight: 400,
    fontStyle: 'normal',
    fontSynthesis: 'none',
  } as const;
  return (
    <div
      className={editable ? 'font-specimen font-specimen--viewer' : 'font-specimen'}
      style={specimenStyle}
      data-font-loaded={loaded}
    >
      {editable ? (
        <textarea
          style={specimenStyle}
          aria-label={t('board.file.sampleText')}
          value={sample}
          maxLength={2000}
          onChange={(event) => setSample(event.target.value)}
        />
      ) : (
        <span style={specimenStyle} aria-hidden="true">
          Aa
        </span>
      )}
      {typeof name === 'string' && <span className="font-specimen__family">{name}</span>}
    </div>
  );
}

export function ModelTile() {
  return (
    <svg
      className="model-tile"
      viewBox="0 0 24 24"
      width="44"
      height="44"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </svg>
  );
}
