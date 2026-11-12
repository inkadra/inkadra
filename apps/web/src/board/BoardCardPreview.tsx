// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import type { Board, BoardCount, BoardPreview } from '@inkadra/shared';
import { Icon, kindStyle, ProjectGlyph } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moveTabFocus } from '../lib/tabs.ts';
import { pickVariant, useAsset } from './assets.ts';
import { type PreviewEntry, useBoardPreview } from './board-previews.ts';
import { productionOf, useBoardsWith } from './boards.ts';
import { loadCardView, saveCardView } from './canvas-prefs.ts';
import { useBoard } from './context.ts';
import { usePresetText } from './film/fields.tsx';
import { type BoardView, boardViews, kindIcon, viewIcon, viewLabelKey } from './views.ts';

/**
 * Size of a new board card, which previews the board (decision 0121). Cards made before keep
 * no height and stay compact: they never grow over their neighbours by themselves.
 */
export const BOARD_CARD_SIZE = { w: 320, h: 260 } as const;
/** Shorter cards show the board's name only, as before decision 0121. */
const PREVIEW_MIN_H = 150;

/** Whether a board card is tall enough to preview its board rather than name it. */
export function showsPreview(el: Pick<Element, 'h'>): boolean {
  return (el.h ?? 0) >= PREVIEW_MIN_H;
}

/** The view a card shows: the one this person chose on this device while the board has it. */
export function cardView(views: readonly BoardView[], chosen: string | null): BoardView | null {
  return views.find((v) => v === chosen) ?? views[0] ?? null;
}

/** First frames shown as pictures, and rows of the shot list. */
const THUMBS = 3;
const ROWS = 5;

/**
 * The card of a sub-board that previews it: the board's name in a pill of its kind, a short
 * count, small tabs when it has more than one view, and the chosen view drawn from the server's
 * bounded projection, never the board's document.
 */
export function BoardCardPreview({
  element,
  board,
  counts,
  title,
}: {
  element: Element;
  board: Board;
  counts: BoardCount | undefined;
  /** The name, or the field that renames it. */
  title: ReactNode;
}) {
  const { t } = useTranslation();
  const { userId } = useBoard();
  const views = boardViews(board, counts, !!productionOf(useBoardsWith(board.id)));
  const [chosen, setChosen] = useState(() => loadCardView(userId, element.id));
  const view = cardView(views, chosen) ?? 'canvas';
  // What the canvas already knows of the board: when it changes the preview is asked again.
  const version = `${board.editedAt ?? board.updatedAt}|${counts?.elementCount ?? ''}|${counts?.framesToShoot ?? ''}`;
  const entry = useBoardPreview(board.id, version);
  const icon = board.icon;
  const pill: CSSProperties =
    icon && !icon.emoji && icon.color !== 'neutral'
      ? ({
          '--kind-bg': `var(--ink-tag-${icon.color}-bg)`,
          '--kind-fg': `var(--ink-tag-${icon.color})`,
        } as CSSProperties)
      : kindStyle(board.kind);
  const choose = (v: BoardView) => {
    setChosen(v);
    saveCardView(userId, element.id, v);
  };
  const preview = entry && 'preview' in entry ? entry.preview : undefined;
  return (
    <div className="board-card">
      <div className="board-card__head">
        <span className="board-card__pill" style={pill}>
          {icon ? <ProjectGlyph {...icon} /> : <Icon name={kindIcon(board.kind)} size={14} />}
          {title}
        </span>
        <span className="board-card__meta">{metaOf(t, view, counts, preview)}</span>
      </div>
      {views.length > 1 && (
        <div
          className="board-card__tabs"
          role="tablist"
          aria-label={t('board.board.views', { name: board.title })}
          onKeyDown={moveTabFocus}
        >
          {views.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              className="board-card__tab"
              aria-selected={v === view}
              tabIndex={v === view ? 0 : -1}
              onClick={() => choose(v)}
              // Double clicking a tab looks at it; it does not open the board.
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <Icon name={viewIcon(v)} contentKind={v} size={12} />
              {t(viewLabelKey(v, board.kind))}
            </button>
          ))}
        </div>
      )}
      <div className="board-card__body" role={views.length > 1 ? 'tabpanel' : undefined}>
        <ViewPreview view={view} entry={entry} counts={counts} />
      </div>
    </div>
  );
}

/** The count on the right of the name, for the chosen view. */
/** The frames the client has not decided on yet. */
export function pendingReview(review: { total: number; approved: number; changes: number }) {
  return Math.max(0, review.total - review.approved - review.changes);
}

function metaOf(
  t: TFunction,
  view: BoardView,
  counts: BoardCount | undefined,
  preview: BoardPreview | undefined,
): string {
  switch (view) {
    case 'storyboard':
    case 'shotlist':
      return t('board.board.frames', { count: frameTotal(counts, preview) });
    case 'schedule':
      return preview?.dayCount === undefined
        ? ''
        : t('board.board.days', { count: preview.dayCount });
    case 'troupe':
      return preview?.crewCount === undefined
        ? ''
        : t('board.board.people', { count: preview.crewCount });
    case 'review':
      // What still waits for the client: the bar below says how many are approved.
      return preview?.review
        ? t('board.board.toReview', { count: pendingReview(preview.review) })
        : '';
    case 'moodboard':
      return counts?.referenceCount === undefined
        ? ''
        : t('board.board.references', { count: counts.referenceCount });
    default:
      return counts
        ? t('board.count.cards', { count: counts.cardCount ?? counts.elementCount })
        : '';
  }
}

function frameTotal(counts: BoardCount | undefined, preview: BoardPreview | undefined): number {
  return counts?.frameCount ?? preview?.review?.total ?? preview?.frames?.length ?? 0;
}

function ViewPreview({
  view,
  entry,
  counts,
}: {
  view: BoardView;
  entry: PreviewEntry | undefined;
  counts: BoardCount | undefined;
}) {
  const { t } = useTranslation();
  const preview = entry && 'preview' in entry ? entry.preview : undefined;
  if (!preview) {
    if (entry?.status === 'denied' || entry?.status === 'error')
      return <p className="board-card__note">{t('board.board.unavailable')}</p>;
    return (
      <p className="board-card__note" aria-busy="true">
        {t('board.board.loading')}
      </p>
    );
  }
  switch (view) {
    case 'storyboard':
      return <StoryboardPreview preview={preview} total={frameTotal(counts, preview)} />;
    case 'shotlist':
      return <ShotListPreview preview={preview} />;
    case 'review':
      return <ReviewPreview preview={preview} />;
    case 'moodboard':
      return <MoodboardPreview preview={preview} />;
    case 'schedule':
      return (
        <Empty>
          {preview.dayCount
            ? t('board.board.days', { count: preview.dayCount })
            : t('board.board.empty.schedule')}
        </Empty>
      );
    case 'troupe':
      return (
        <Empty>
          {preview.crewCount === undefined
            ? t('board.board.empty.troupeHidden')
            : preview.crewCount
              ? t('board.board.people', { count: preview.crewCount })
              : t('board.board.empty.troupe')}
        </Empty>
      );
    default:
      return <CanvasPreview preview={preview} />;
  }
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="board-card__empty">{children}</p>;
}

/** A picture of the board, sized for the card at the current zoom. */
function Picture({ id, width }: { id: string; width: number }) {
  const { scale } = useBoard();
  const asset = useAsset(id);
  const src =
    asset && asset !== 'missing'
      ? pickVariant(asset, width * scale * (window.devicePixelRatio || 1))
      : '';
  return src ? (
    <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
  ) : (
    <span className="board-card__blank" />
  );
}

function CanvasPreview({ preview }: { preview: BoardPreview }) {
  const { t } = useTranslation();
  if (preview.elementCount === 0) return <Empty>{t('board.board.empty.canvas')}</Empty>;
  const pictures = preview.assetIds.slice(0, 2);
  return (
    <div className="board-card__canvas">
      {pictures.length > 0 && (
        <div className="board-card__pictures">
          {pictures.map((id) => (
            <Picture key={id} id={id} width={150} />
          ))}
        </div>
      )}
      {preview.excerpts.map((text) => (
        <p key={text} className="board-card__excerpt">
          {text}
        </p>
      ))}
    </div>
  );
}

function MoodboardPreview({ preview }: { preview: BoardPreview }) {
  const { t } = useTranslation();
  const colors = preview.colors ?? [];
  if (preview.assetIds.length === 0 && colors.length === 0)
    return <Empty>{t('board.board.empty.moodboard')}</Empty>;
  const [first, ...rest] = preview.assetIds;
  return (
    <div className="board-card__mood">
      {first && (
        <div className={rest.length ? 'board-card__mosaic' : 'board-card__mosaic is-single'}>
          <Picture id={first} width={200} />
          {rest.slice(0, 2).map((id) => (
            <Picture key={id} id={id} width={100} />
          ))}
        </div>
      )}
      {colors.length > 0 && (
        <div className="board-card__palette">
          {colors.slice(0, 4).map((hex) => (
            <span key={hex} className="board-card__swatch">
              <i style={{ background: hex }} />
              {hex}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StoryboardPreview({ preview, total }: { preview: BoardPreview; total: number }) {
  const { t } = useTranslation();
  const presetText = usePresetText();
  const frames = (preview.frames ?? []).slice(0, THUMBS);
  if (frames.length === 0) return <Empty>{t('board.board.empty.storyboard')}</Empty>;
  return (
    <>
      <div className="board-card__frames">
        {frames.map((f) => (
          <div key={f.label} className="board-card__frame">
            <span className="board-card__shot" style={{ aspectRatio: String(f.ratio) }}>
              {f.assetId && <Picture id={f.assetId} width={100} />}
              {f.drawing.length > 0 && (
                <svg viewBox="0 0 4096 4096" preserveAspectRatio="none" aria-hidden="true">
                  {f.drawing.map((p) => (
                    <path
                      key={p.path}
                      d={p.path}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={p.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </svg>
              )}
              {!f.assetId && f.drawing.length === 0 && <Icon name="frame" size={14} />}
            </span>
            <span className="board-card__label">
              <b>{f.label}</b> {f.shot ? presetText('shotSizes', f.shot) : ''}
            </span>
            {f.lens && <span className="board-card__lens">{f.lens}</span>}
          </div>
        ))}
      </div>
      {total > frames.length && (
        <p className="board-card__more">
          {t('board.board.more', { count: total - frames.length })}
        </p>
      )}
    </>
  );
}

function ShotListPreview({ preview }: { preview: BoardPreview }) {
  const { t } = useTranslation();
  const presetText = usePresetText();
  const frames = (preview.frames ?? []).slice(0, ROWS);
  if (frames.length === 0) return <Empty>{t('board.board.empty.shotlist')}</Empty>;
  return (
    <table className="board-card__table">
      <thead>
        <tr>
          <th>#</th>
          <th>{t('board.board.shotSize')}</th>
          <th>{t('board.board.lens')}</th>
        </tr>
      </thead>
      <tbody>
        {frames.map((f) => (
          <tr key={f.label}>
            <td className="board-card__id">{f.label}</td>
            <td>{f.shot ? presetText('shotSizes', f.shot) : ''}</td>
            <td className="board-card__lens">{f.lens ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReviewPreview({ preview }: { preview: BoardPreview }) {
  const { t } = useTranslation();
  const review = preview.review;
  if (!review || review.total === 0) return <Empty>{t('board.board.empty.review')}</Empty>;
  return (
    <div className="board-card__review">
      <span
        className="board-card__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={review.total}
        aria-valuenow={review.approved}
        aria-label={t('board.board.approved', { count: review.approved, total: review.total })}
      >
        <i style={{ width: `${(review.approved / review.total) * 100}%` }} />
      </span>
      <span className="board-card__review-line">
        <span>{t('board.board.approved', { count: review.approved, total: review.total })}</span>
        {review.changes > 0 && (
          <span className="board-card__changes">
            {t('board.board.changes', { count: review.changes })}
          </span>
        )}
      </span>
    </div>
  );
}
