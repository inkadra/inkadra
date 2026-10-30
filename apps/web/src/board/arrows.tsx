import {
  type ArrowElement,
  type ArrowGeometry,
  arrowPathData,
  type Point,
  type Rect,
  setArrowPath,
  updateElement,
  updateElements,
} from '@inkadra/canvas-core';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Y from 'yjs';
import { BarButton } from './chrome.tsx';
import { LOCAL } from './store.ts';

const NEXT_HEADS = { end: 'both', both: 'none', none: 'end' } as const;

/**
 * Arrows between cards, drawn in world coordinates above the cards. Each arrow is a thin
 * visible line plus a wide invisible one that takes the clicks.
 */
export const ArrowLayer = memo(function ArrowLayer({
  doc,
  arrows,
  ends,
  selection,
  editing,
  draft,
  onDone,
}: {
  doc: Y.Doc;
  arrows: readonly ArrowElement[];
  ends: ReadonlyMap<string, ArrowGeometry>;
  selection: ReadonlySet<string>;
  editing: string | null;
  /** The arrow being drawn with the arrow tool. */
  draft: { a: Point; b: Point } | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <svg className="arrows" aria-hidden="true">
        <defs>
          <marker
            id="ink-arrow-head"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" className="arrows__head" />
          </marker>
          <marker
            id="ink-arrow-head-selected"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" className="arrows__head arrows__head--selected" />
          </marker>
        </defs>
        {arrows.map((arrow) => {
          const end = ends.get(arrow.id);
          if (!end) return null;
          const selected = selection.has(arrow.id);
          const head = `url(#${selected ? 'ink-arrow-head-selected' : 'ink-arrow-head'})`;
          const heads = arrow.heads ?? 'end';
          const d = arrowPathData(end);
          return (
            <g key={arrow.id} data-el={arrow.id} data-type="arrow">
              <path d={d} className="arrows__hit" />
              <path
                d={d}
                className={`arrows__line${selected ? ' is-selected' : ''}`}
                strokeDasharray={arrow.line === 'dashed' ? '8 6' : undefined}
                markerEnd={heads !== 'none' ? head : undefined}
                markerStart={heads === 'both' ? head : undefined}
              />
            </g>
          );
        })}
        {draft && (
          <path
            d={`M${draft.a.x} ${draft.a.y}L${draft.b.x} ${draft.b.y}`}
            className="arrows__line is-selected"
            markerEnd="url(#ink-arrow-head-selected)"
          />
        )}
      </svg>
      {arrows.map((arrow) => {
        const end = ends.get(arrow.id);
        if (!end || (!arrow.label && editing !== arrow.id)) return null;
        const at = end.mid;
        return (
          <div
            key={arrow.id}
            className={`arrows__label${selection.has(arrow.id) ? ' is-selected' : ''}`}
            style={{ left: at.x, top: at.y }}
            data-el={arrow.id}
            data-type="arrow"
          >
            {editing === arrow.id ? (
              <input
                className="card__inline-input"
                defaultValue={arrow.label ?? ''}
                placeholder={t('board.arrow.placeholder')}
                aria-label={t('board.arrow.label')}
                size={Math.max(8, (arrow.label ?? '').length + 2)}
                // biome-ignore lint/a11y/noAutofocus: opened by a double click on the arrow
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  const label = e.target.value.trim().slice(0, 200) || undefined;
                  if (label !== arrow.label) updateElement(doc, arrow.id, { label }, LOCAL);
                  onDone();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
            ) : (
              arrow.label
            )}
          </div>
        );
      })}
    </>
  );
});

/** Selection bar buttons of arrows: label, line, ends and path. */
export function ArrowStyleButtons({
  doc,
  arrows,
  rectOf,
  onLabel,
}: {
  doc: Y.Doc;
  arrows: readonly ArrowElement[];
  rectOf: (id: string) => Rect | null;
  /** Edits the label of a single arrow; omitted for several arrows or a locked one. */
  onLabel: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const editable = arrows.filter((a) => !a.locked);
  if (editable.length === 0) return null;
  const dashed = editable.every((a) => a.line === 'dashed');
  const curved = editable.every((a) => a.path === 'curved');
  const heads = editable[0]?.heads ?? 'end';
  const patch = (p: Partial<Pick<ArrowElement, 'line' | 'heads'>>) =>
    updateElements(
      doc,
      editable.map((a) => ({ id: a.id, patch: p })),
      LOCAL,
    );
  return (
    <>
      {onLabel && (
        <BarButton
          icon="text"
          label={editable[0]?.label ? t('board.arrow.editLabel') : t('board.arrow.addLabel')}
          onClick={onLabel}
        />
      )}
      <BarButton
        icon="dashed"
        label={t('board.arrow.dashed')}
        active={dashed}
        onClick={() => patch({ line: dashed ? undefined : 'dashed' })}
      />
      <BarButton
        icon="curve"
        label={t('board.arrow.curved')}
        active={curved}
        onClick={() =>
          setArrowPath(doc, editable, curved ? undefined : 'curved', rectOf, LOCAL)
        }
      />
      <BarButton
        icon={heads === 'both' ? 'arrowBoth' : heads === 'none' ? 'line' : 'arrow'}
        label={t('board.arrow.heads', { current: t(`board.arrow.headsValue.${heads}`) })}
        onClick={() => {
          const next = NEXT_HEADS[heads];
          patch({ heads: next === 'end' ? undefined : next });
        }}
      />
    </>
  );
}
