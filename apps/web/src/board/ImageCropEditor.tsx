// SPDX-License-Identifier: AGPL-3.0-only
import { type ArrowElement, type Rect, refreshArrows, updateElement } from '@inkadra/canvas-core';
import {
  type Element,
  IMAGE_CROP_ASPECTS,
  type ImageCrop,
  type ImageCropAspect,
} from '@inkadra/doc-schema';
import { Icon } from '@inkadra/ui';
import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAsset } from './assets.ts';
import { useBoard } from './context.ts';
import {
  CROP_HANDLES,
  type CropHandle,
  FULL_CROP,
  fitCropToAspect,
  hasImageTransform,
  isIdentityCrop,
  moveCropRect,
  normalizeRotation,
  resizeCropRect,
  rotateCrop90,
  rotatedBounds,
  sanitizeCrop,
  splitRotation,
} from './image-crop.ts';
import { LOCAL } from './store.ts';

type ImageEl = Extract<Element, { type: 'image' }>;

/** Applies crop and rotation to an image element in the Yjs document and refreshes attached arrows. */
export function applyImageTransform(
  store: ReturnType<typeof useBoard>['store'],
  element: ImageEl,
  nextCrop: ImageCrop | undefined,
  nextRotation: number | undefined,
) {
  const cleanRotation = nextRotation !== undefined ? normalizeRotation(nextRotation) : 0;
  const finalRotation = Math.abs(cleanRotation) < 1e-4 ? undefined : cleanRotation;
  const sanitized = nextCrop ? sanitizeCrop(nextCrop) : undefined;
  const finalCrop = sanitized && !isIdentityCrop(sanitized) ? sanitized : undefined;

  store.doc.transact(() => {
    updateElement(
      store.doc,
      element.id,
      {
        crop: finalCrop,
        rotation: finalRotation,
        h: undefined,
      },
      LOCAL,
    );
    const snap = store.getSnapshot();
    const arrows = snap.canvas.filter((e): e is ArrowElement => e.type === 'arrow');
    if (arrows.length > 0) {
      refreshArrows(
        store.doc,
        arrows,
        [element.id],
        (id) => {
          const el = snap.byId.get(id);
          return el && el.parent === null && el.type !== 'arrow' ? store.rectOf(el) : null;
        },
        LOCAL,
      );
    }
  }, LOCAL);
}

/** Restores an image element to its original uncropped and unrotated state. */
export function restoreOriginalImage(
  store: ReturnType<typeof useBoard>['store'],
  element: ImageEl,
) {
  store.undo.stopCapturing();
  applyImageTransform(store, element, undefined, undefined);
  store.undo.stopCapturing();
}

/**
 * Interactive crop stage rendered inside `ImageCard` while `cropping === element.id`.
 * Shows the full rotated image dimmed outside the crop rectangle, rule-of-thirds grid,
 * and 8 resize handles.
 */
export function ImageCropStage({
  element,
  src,
  alt,
  baseWidth,
  baseHeight,
}: {
  element: ImageEl;
  src: string;
  alt: string;
  baseWidth: number;
  baseHeight: number;
}) {
  const { store } = useBoard();
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    kind: 'move' | CropHandle;
    startX: number;
    startY: number;
    startCrop: ImageCrop;
  } | null>(null);

  const rot = normalizeRotation(element.rotation);
  const crop = element.crop ? sanitizeCrop(element.crop) : FULL_CROP;
  const rBounds = rotatedBounds(baseWidth, baseHeight, rot);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const handleEl = (e.target as HTMLElement).closest<HTMLElement>('[data-crop-handle]');
    const kind: 'move' | CropHandle =
      (handleEl?.dataset.cropHandle as CropHandle | undefined) ?? 'move';
    store.undo.stopCapturing();
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: crop,
    };
    stageRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    e.stopPropagation();
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const next =
      drag.kind === 'move'
        ? moveCropRect(drag.startCrop, dx, dy)
        : resizeCropRect(drag.startCrop, drag.kind, dx, dy, rBounds.width, rBounds.height);
    applyImageTransform(store, element, next, rot);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
    if (stageRef.current?.hasPointerCapture(e.pointerId)) {
      stageRef.current.releasePointerCapture(e.pointerId);
    }
    store.undo.stopCapturing();
  }

  return (
    <div
      ref={stageRef}
      className="crop-stage"
      role="application"
      data-no-drag
      data-testid="image-crop-stage"
      aria-label={t('board.image.cropStage')}
      style={{ aspectRatio: `${rBounds.width} / ${rBounds.height}` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="crop-stage__viewport" aria-hidden="true">
        <div
          className="crop-stage__rot"
          style={{
            width: `${(baseWidth / rBounds.width) * 100}%`,
            height: `${(baseHeight / rBounds.height) * 100}%`,
            transform: `translate(-50%, -50%) rotate(${rot}deg)`,
          }}
        >
          <img src={src} alt={alt} draggable={false} decoding="async" />
        </div>
        <div
          className="crop-stage__scrim"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
          }}
        />
      </div>
      <div
        className="crop-stage__box"
        data-testid="image-crop-box"
        style={{
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.w * 100}%`,
          height: `${crop.h * 100}%`,
        }}
      >
        <div className="crop-stage__grid" aria-hidden="true">
          <span className="crop-stage__line crop-stage__line--v1" />
          <span className="crop-stage__line crop-stage__line--v2" />
          <span className="crop-stage__line crop-stage__line--h1" />
          <span className="crop-stage__line crop-stage__line--h2" />
        </div>
        {CROP_HANDLES.map((h) => (
          <span
            key={h}
            className={`crop-stage__handle crop-stage__handle--${h}`}
            data-crop-handle={h}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Floating toolbar shown above/below the card while cropping and rotating an image.
 * Uses the same `.ctxbar` surface and token system as the selection toolbar.
 */
export function ImageCropToolbar({
  box,
  element,
  onDone,
}: {
  box: Rect;
  element: ImageEl;
  onDone: () => void;
}) {
  const { store } = useBoard();
  const { t } = useTranslation();
  const asset = useAsset(element.assetId);
  const ready = asset && asset !== 'missing' ? asset : null;
  const baseW = ready?.width && ready.width > 0 ? ready.width : 4;
  const baseH = ready?.height && ready.height > 0 ? ready.height : 3;

  const rot = normalizeRotation(element.rotation);
  const { base: quarterBase, fine } = splitRotation(rot);
  const crop = element.crop ? sanitizeCrop(element.crop) : FULL_CROP;
  const activeAspect: ImageCropAspect = crop.aspect ?? 'free';
  const rBounds = rotatedBounds(baseW, baseH, rot);
  const transformed = hasImageTransform(element);

  const top = box.y - 48 < 8 ? box.y + box.h + 8 : box.y - 48;

  function selectAspect(preset: ImageCropAspect) {
    store.undo.stopCapturing();
    const next = fitCropToAspect(crop, preset, rBounds.width, rBounds.height);
    applyImageTransform(store, element, next, rot);
    store.undo.stopCapturing();
  }

  function stepRotate(direction: 1 | -1) {
    store.undo.stopCapturing();
    const nextRot = normalizeRotation(quarterBase + direction * 90 + fine);
    const nextCrop = isIdentityCrop(crop) ? crop : rotateCrop90(crop, direction);
    applyImageTransform(store, element, nextCrop, nextRot);
    store.undo.stopCapturing();
  }

  function changeFineAngle(nextFine: number) {
    const nextRot = normalizeRotation(quarterBase + nextFine);
    applyImageTransform(store, element, crop, nextRot);
  }

  const presetLabel = (preset: ImageCropAspect) =>
    preset === 'free' ? t('board.image.aspect.free') : preset;

  return (
    <div
      className="ctxbar crop-bar"
      role="toolbar"
      aria-label={t('board.image.cropToolbar')}
      style={{ ['--crop-bar-left' as string]: `${Math.max(8, box.x)}px`, top }}
      data-chrome
    >
      <fieldset className="crop-bar__group" aria-label={t('board.image.aspect.label')}>
        {IMAGE_CROP_ASPECTS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`ctxbar__btn crop-bar__preset${activeAspect === preset ? ' is-active' : ''}`}
            aria-pressed={activeAspect === preset}
            aria-label={t('board.image.aspect.preset', { ratio: presetLabel(preset) })}
            title={t('board.image.aspect.preset', { ratio: presetLabel(preset) })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectAspect(preset)}
          >
            {presetLabel(preset)}
          </button>
        ))}
      </fieldset>
      <span className="ctxbar__sep" aria-hidden="true" />
      <button
        type="button"
        className="ctxbar__btn"
        aria-label={t('board.image.rotateLeft')}
        title={t('board.image.rotateLeft')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => stepRotate(-1)}
      >
        <Icon name="rotateLeft" size={14} />
      </button>
      <button
        type="button"
        className="ctxbar__btn"
        aria-label={t('board.image.rotateRight')}
        title={t('board.image.rotateRight')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => stepRotate(1)}
      >
        <Icon name="rotateRight" size={14} />
      </button>
      <label className="crop-bar__angle">
        <input
          type="range"
          min={-45}
          max={45}
          step={1}
          value={fine}
          aria-label={t('board.image.angle')}
          onPointerDown={() => store.undo.stopCapturing()}
          onPointerUp={() => store.undo.stopCapturing()}
          onChange={(e) => changeFineAngle(Number(e.target.value))}
        />
        <span className="crop-bar__deg" aria-live="polite">
          {Math.round(rot)}°
        </span>
      </label>
      <span className="ctxbar__sep" aria-hidden="true" />
      <button
        type="button"
        className="ctxbar__btn crop-bar__text-btn"
        disabled={!transformed}
        aria-label={t('board.image.restoreOriginal')}
        title={t('board.image.restoreOriginal')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => restoreOriginalImage(store, element)}
      >
        <Icon name="undo" size={14} />
        <span>{t('board.image.restoreOriginal')}</span>
      </button>
      <button
        type="button"
        className="ctxbar__btn crop-bar__done is-active"
        aria-label={t('board.image.done')}
        title={t('board.image.done')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDone}
      >
        <Icon name="check" size={14} />
        <span>{t('board.image.done')}</span>
      </button>
    </div>
  );
}
