// SPDX-License-Identifier: AGPL-3.0-only
import type { ImageCrop } from '@inkadra/doc-schema';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CropHandle, moveCropRect, resizeCropRect } from './image-crop.ts';

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
const KEY_STEP = 0.01;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-KEY_STEP, 0],
  ArrowRight: [KEY_STEP, 0],
  ArrowUp: [0, -KEY_STEP],
  ArrowDown: [0, KEY_STEP],
};

/** The photo of a browser tab over the player, with a box to cut away what remains of it. */
export function TabCaptureCrop({
  file,
  width,
  height,
  crop,
  onCrop,
}: {
  file: File;
  width: number;
  height: number;
  crop: ImageCrop;
  onCrop: (crop: ImageCrop) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const picture = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; start: ImageCrop; handle: CropHandle | null } | null>(
    null,
  );
  const startDrag = (e: PointerEvent<HTMLElement>, handle: CropHandle | null) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: crop, handle };
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const box = picture.current?.getBoundingClientRect();
    if (!d || !box?.width) return;
    const dx = (e.clientX - d.x) / box.width;
    const dy = (e.clientY - d.y) / box.height;
    onCrop(
      d.handle
        ? resizeCropRect(d.start, d.handle, dx, dy, width, height)
        : moveCropRect(d.start, dx, dy),
    );
  };
  const endDrag = () => {
    drag.current = null;
  };
  return (
    <div className="viewer__tab-capture">
      <div
        ref={picture}
        className="viewer__tab-picture"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {url && <img src={url} alt={t('frameGrab.tabCaptured')} draggable={false} />}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: moving the box is a pointer shortcut; the corners take the keys. */}
        <div
          className="viewer__tab-crop"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
          }}
          onPointerDown={(e) => startDrag(e, null)}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {CORNERS.map((corner) => (
            <button
              key={corner}
              type="button"
              className={`viewer__tab-handle viewer__tab-handle--${corner}`}
              aria-label={t(`frameGrab.crop.${corner}`)}
              onPointerDown={(e) => startDrag(e, corner)}
              onPointerMove={onMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(e) => {
                const step = ARROWS[e.key];
                if (!step) return;
                e.preventDefault();
                e.stopPropagation();
                onCrop(resizeCropRect(crop, corner, step[0], step[1], width, height));
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
