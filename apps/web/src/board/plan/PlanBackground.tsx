// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Box,
  backgroundBox,
  fitBackground,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type Point,
  scaleBackground,
  updateElement,
} from '@inkadra/canvas-core';
import { Button, Icon, Slider, Switch } from '@inkadra/ui';
import { type CSSProperties, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickVariant, useAsset } from '../assets.ts';
import { uploadBoardId } from '../frame-grab.ts';
import { type BoardStore, LOCAL } from '../store.ts';
import { startUpload } from '../uploads.ts';
import type { Ed } from './editing.ts';

export type PlanBackground = NonNullable<PlanElement['background']>;
/** How a new background starts: faint and grey, to trace over (decision 0110). */
const NEW_BACKGROUND = { opacity: 0.4, grey: true } as const;
const round = (v: number) => Math.round(v * 10) / 10;

/** The picture under a plan, where it lies, at its opacity and in greys if asked. */
export function PlanBackgroundView({ background }: { background: PlanBackground }) {
  const asset = useAsset(background.assetId);
  const ready = asset && asset !== 'missing' ? asset : null;
  const src = ready ? pickVariant(ready, 2048) : '';
  if (!src || background.hidden) return null;
  const box = backgroundBox(background);
  return (
    <image
      className="plan__background"
      href={src}
      x={box.x}
      y={box.y}
      width={box.w}
      height={box.h}
      preserveAspectRatio="none"
      opacity={background.opacity ?? 1}
      style={background.grey ? { filter: 'grayscale(1)' } : undefined}
    />
  );
}

/**
 * Uploads a picture as the background of plan `ownerId`, by the upload path of the cards'
 * pictures. The plan changes only when all the bytes have arrived, as one undo step, fitted in
 * the middle of the drawing with its shape kept.
 */
export async function uploadBackground(input: {
  store: BoardStore;
  ownerId: string;
  projectId: string;
  file: File;
  onPlaced: () => void;
  onFailed: () => void;
}) {
  const { store, ownerId, file } = input;
  const boardId = uploadBoardId(store);
  if (!boardId) return input.onFailed();
  let box: Box = { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H };
  try {
    const bitmap = await createImageBitmap(file);
    box = fitBackground(bitmap.width, bitmap.height);
    bitmap.close();
  } catch {
    // A picture the browser cannot read here is stretched over the drawing until it is placed.
  }
  startUpload({
    file,
    projectId: input.projectId,
    boardId,
    onAsset: () => {},
    onFailed: () => input.onFailed(),
    onComplete: (assetId) => {
      const plan = store.getSnapshot().byId.get(ownerId);
      if (plan?.type !== 'plan') return;
      store.undo.stopCapturing();
      updateElement(
        store.doc,
        ownerId,
        {
          background: {
            assetId,
            ...NEW_BACKGROUND,
            x: round(box.x),
            y: round(box.y),
            w: round(box.w),
            h: round(box.h),
          },
        },
        LOCAL,
      );
      store.undo.stopCapturing();
      input.onPlaced();
    },
  });
}

/** The background of what the editor shows: the base's, for a setup (decision 0110). */
export const backgroundOf = (ed: Ed) => ed.drawn.background;

/**
 * Picking a picture for the background: the hidden file field, the upload and its state. The
 * picture goes on the base of a setup, like the rest of the Set.
 */
export function useBackgroundPicker(ed: Ed) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'uploading' | 'failed'>('idle');
  const projectId = ed.projectId;
  const field = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      data-plan-background-file=""
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !projectId) return;
        setState('uploading');
        void uploadBackground({
          store: ed.store,
          ownerId: ed.scaleOwner,
          projectId,
          file,
          onPlaced: () => {
            setState('idle');
            ed.setPlacingBackground(true);
          },
          onFailed: () => setState('failed'),
        });
      }}
    />
  );
  return { field, state, can: !!projectId, pick: () => input.current?.click() };
}

/** The controls of the background: opacity, greys, hide, move and scale, replace, remove. */
export function BackgroundPanel({
  ed,
  picker,
  style,
  onClose,
}: {
  ed: Ed;
  picker: ReturnType<typeof useBackgroundPicker>;
  style?: CSSProperties | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const background = backgroundOf(ed);
  const asset = useAsset(background?.assetId);
  const name = asset && asset !== 'missing' ? asset.filename : '';
  const set = (patch: Partial<PlanBackground>) => {
    if (!background) return;
    const next = { ...background, ...patch };
    for (const [k, v] of Object.entries(patch))
      if (v === undefined) delete (next as Record<string, unknown>)[k];
    ed.editPlan({ background: next }, ed.scaleOwner);
  };
  const opacity = Math.round((background?.opacity ?? 1) * 100);
  return (
    <div
      className="plan-pop plan-background ink-motion-pop"
      role="dialog"
      aria-label={t('board.plan.background.title')}
      data-tour="plan-background-panel"
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="plan-scale__head">
        <b>{t('board.plan.background.title')}</b>
        <Button variant="ghost" onClick={onClose}>
          {t('film.pen.done')}
        </Button>
      </div>
      {picker.state === 'uploading' && (
        <p className="plan-pop__text" role="status">
          {t('board.plan.background.uploading')}
        </p>
      )}
      {picker.state === 'failed' && (
        <p className="plan-pop__wrong" role="alert">
          {t('board.plan.background.failed')}
        </p>
      )}
      {background ? (
        <>
          <p className="plan-background__name">
            <Icon name="image" size={16} />
            <span>{name || t('board.plan.background.picture')}</span>
          </p>
          <div className="plan-props__row">
            <span className="plan-prop__label">{t('board.plan.background.opacity')}</span>
            <span className="plan-chip">{opacity}%</span>
          </div>
          <Slider
            aria-label={t('board.plan.background.opacity')}
            min={5}
            max={100}
            step={5}
            value={opacity}
            onFocus={() => ed.store.undo.stopCapturing()}
            onChange={(v) => {
              const next = { ...background, opacity: v / 100 };
              updateElement(ed.doc, ed.scaleOwner, { background: next }, LOCAL);
            }}
            onPointerUp={() => ed.store.undo.stopCapturing()}
          />
          <label className="plan-props__row">
            <span>{t('board.plan.background.grey')}</span>
            <Switch
              checked={!!background.grey}
              onChange={(e) => set({ grey: e.target.checked || undefined })}
            />
          </label>
          <label className="plan-props__row">
            <span>{t('board.plan.background.show')}</span>
            <Switch
              checked={!background.hidden}
              onChange={(e) => set({ hidden: e.target.checked ? undefined : true })}
            />
          </label>
          <div className="plan-props__actions">
            <Button
              disabled={!!background.hidden}
              onClick={() => {
                ed.setPlacingBackground(true);
                onClose();
              }}
            >
              {t('board.plan.background.place')}
            </Button>
            <Button disabled={!picker.can} onClick={picker.pick}>
              {t('board.plan.background.replace')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                ed.editPlan({ background: undefined }, ed.scaleOwner);
                ed.setPlacingBackground(false);
                onClose();
              }}
            >
              {t('board.plan.background.remove')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="plan-pop__text">{t('board.plan.background.empty')}</p>
          <Button variant="primary" disabled={!picker.can} onClick={picker.pick}>
            {t('board.plan.background.choose')}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The "place the background" state (decision 0110): the picture framed with four corner
 * handles; dragging it moves it, a corner scales it with its shape kept. Each drag is one undo
 * step; Done locks it under everything again.
 */
export function useBackgroundPlacing(ed: Ed, zoom: number) {
  const { t } = useTranslation();
  const background = backgroundOf(ed);
  const [live, setLive] = useState<Box | null>(null);
  const gesture = useRef<{ start: Point; box: Box; corner: 0 | 1 | 2 | 3 | null } | null>(null);
  const active = ed.placingBackground && !!background && !background.hidden;
  const box = live ?? (background ? backgroundBox(background) : null);
  const k = zoom / 100;
  const view = (p: Point) => ({ x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H });
  const down = (p: Point, target: Element): boolean => {
    if (!active || !box) return false;
    const corner = target.closest<SVGElement>('[data-bg-corner]');
    const q = view(p);
    const inside = q.x >= box.x && q.x <= box.x + box.w && q.y >= box.y && q.y <= box.y + box.h;
    if (!corner && !inside) return true;
    gesture.current = {
      start: q,
      box,
      corner: corner ? (Number(corner.dataset.bgCorner) as 0 | 1 | 2 | 3) : null,
    };
    return true;
  };
  const move = (p: Point): boolean => {
    const g = gesture.current;
    if (!g) return false;
    const q = view(p);
    setLive(
      g.corner === null
        ? { ...g.box, x: g.box.x + q.x - g.start.x, y: g.box.y + q.y - g.start.y }
        : scaleBackground(g.box, g.corner, q),
    );
    return true;
  };
  const up = (): boolean => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return false;
    if (live && background)
      ed.editPlan(
        {
          background: {
            ...background,
            x: round(live.x),
            y: round(live.y),
            w: round(live.w),
            h: round(live.h),
          },
        },
        ed.scaleOwner,
      );
    setLive(null);
    return true;
  };
  const grip = (ed.phone ? 24 : 12) / k;
  const overlay = active && box && (
    <g className="plan-editor__selection plan-background__frame">
      <rect x={box.x} y={box.y} width={box.w} height={box.h} />
      {(
        [
          [box.x, box.y],
          [box.x + box.w, box.y],
          [box.x + box.w, box.y + box.h],
          [box.x, box.y + box.h],
        ] as const
      ).map(([x, y], i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: the four corners, in order.
          key={i}
          data-bg-corner={i}
          className={`plan-editor__handle plan-editor__handle--${['nw', 'ne', 'se', 'sw'][i]}`}
          x={x - grip / 2}
          y={y - grip / 2}
          width={grip}
          height={grip}
          rx={2}
        />
      ))}
    </g>
  );
  const bar = active && (
    <div
      className="plan-float plan-canvas__movebar ink-motion-pop"
      role="toolbar"
      aria-label={t('board.plan.background.placing')}
    >
      <span>{t('board.plan.background.placing')}</span>
      <span className="plan-float__sep" aria-hidden="true" />
      <Button variant="primary" onClick={() => ed.setPlacingBackground(false)}>
        {t('film.pen.done')}
      </Button>
    </div>
  );
  return { active, down, move, up, overlay, bar, preview: live };
}
