// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactionEmoji } from '@inkadra/shared';
import { Button, Icon, IconButton } from '@inkadra/ui';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { Thread, useCardLabel } from './CommentsPanel.tsx';
import { bubbleLayout, popoverPosition, type Rect } from './comments-on-board-model.ts';
import { ReactionBar } from './ReactionBar.tsx';
import {
  canComment,
  closePopover,
  getReviews,
  openComments,
  openPopover,
  refreshReviews,
  setThreadRead,
  useReviews,
} from './review-store.ts';
import './review.css';

/**
 * The threads of the board next to their cards (#311): a bubble with the number of open threads
 * on the top-right edge of each card, and, once clicked, a popover beside the card joined to the
 * bubble by a thin line. It lives in a layer above the canvas and reads the rendered cards, so
 * it follows pan and zoom without being part of any card. The panel stays the full list.
 */
export function CommentsOnBoard() {
  const onBoard = useReviews((s) => s.onBoard);
  const counts = useReviews((s) => s.counts);
  const popover = useReviews((s) => s.popover);
  const ids = useMemo(
    () => [...counts].flatMap(([id, c]) => (id !== null && c.open > 0 ? [id] : [])),
    [counts],
  );
  const reactions = useReviews((s) => s.elementReactions);
  const writable = canComment(useReviews((s) => s.role));
  const layer = useRef<HTMLDivElement>(null);

  // A card under the pointer shows its reaction picker, and keeps it while the pointer moves
  // onto the chips (they sit below the card, outside it).
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    if (!onBoard || !writable) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const over = (e: PointerEvent) => {
      const el = (e.target as Element).closest?.('.card[data-el], [data-reactions]');
      const id = el?.getAttribute('data-el') ?? el?.getAttribute('data-reactions') ?? null;
      clearTimeout(timer);
      if (id) setHover(id);
      else timer = setTimeout(() => setHover(null), 250);
    };
    document.addEventListener('pointerover', over);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over);
    };
  }, [onBoard, writable]);
  const reacted = useMemo(
    () => [...new Set([...reactions.keys(), ...(hover && writable ? [hover] : [])])],
    [reactions, hover, writable],
  );
  const shown = onBoard && (ids.length > 0 || reacted.length > 0);

  // The popover goes with its bubble: a card whose threads were all resolved has neither.
  useEffect(() => {
    if (popover && !ids.includes(popover)) closePopover();
  }, [popover, ids]);

  // Place everything every frame from the cards as drawn: no coordinates are stored.
  useEffect(() => {
    if (!shown) return;
    let frame = 0;
    const place = () => {
      const root = layer.current;
      const canvas = document.querySelector<HTMLElement>('[data-testid="canvas"]');
      if (root && canvas) {
        const area = canvas.getBoundingClientRect();
        root.style.left = `${area.left}px`;
        root.style.top = `${area.top}px`;
        root.style.width = `${area.width}px`;
        root.style.height = `${area.height}px`;
        for (const node of root.querySelectorAll<HTMLElement>('[data-reactions]')) {
          const card = document.querySelector<HTMLElement>(
            `.card[data-el="${CSS.escape(node.dataset.reactions ?? '')}"]`,
          );
          const rect = card?.getBoundingClientRect();
          const layout =
            card && rect
              ? bubbleLayout(toRect(rect, area), card.offsetWidth, {
                  w: area.width,
                  h: area.height,
                })
              : null;
          node.hidden = !layout;
          if (layout && rect)
            node.style.transform = `translate(${rect.left - area.left}px, ${rect.bottom - area.top + 6}px) scale(${layout.scale})`;
        }
        const line = root.querySelector<SVGLineElement>('[data-link]');
        line?.setAttribute('visibility', 'hidden');
        for (const bubble of root.querySelectorAll<HTMLElement>('[data-bubble]')) {
          const card = document.querySelector<HTMLElement>(
            `.card[data-el="${CSS.escape(bubble.dataset.bubble ?? '')}"]`,
          );
          const rect = card?.getBoundingClientRect();
          const layout =
            card && rect
              ? bubbleLayout(toRect(rect, area), card.offsetWidth, {
                  w: area.width,
                  h: area.height,
                })
              : null;
          bubble.hidden = !layout;
          if (!layout) continue;
          bubble.style.transform = `translate(${layout.x}px, ${layout.y}px) translate(-20%, -50%) scale(${layout.scale})`;
          if (bubble.dataset.bubble !== getReviews().popover) continue;
          const pop = root.querySelector<HTMLElement>('[data-popover]');
          if (!pop || !rect) continue;
          const at = popoverPosition(
            toRect(rect, area),
            { w: pop.offsetWidth, h: pop.offsetHeight },
            { w: area.width, h: area.height },
          );
          pop.style.transform = `translate(${at.x}px, ${at.y}px)`;
          if (line) {
            line.setAttribute('x1', String(layout.x));
            line.setAttribute('y1', String(layout.y));
            line.setAttribute('x2', String(at.side === 'right' ? at.x : at.x + pop.offsetWidth));
            line.setAttribute('y2', String(at.y + Math.min(24, pop.offsetHeight / 2)));
            line.setAttribute('visibility', 'visible');
          }
        }
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  // The CSS hides the count badge of the cards while the bubbles stand in for it, and every
  // marker (badges and pins) while "Show on board" is off (review.css).
  useEffect(() => {
    document.body.dataset.commentsOnBoard = onBoard ? 'on' : 'off';
    return () => {
      delete document.body.dataset.commentsOnBoard;
    };
  }, [onBoard]);

  // Click away or Escape closes the popover.
  useEffect(() => {
    if (!popover) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Element;
      if (target.closest('[data-popover], [data-bubble], .comments-panel, dialog, [role="menu"]'))
        return;
      closePopover();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [popover]);

  if (!shown) return null;
  return createPortal(
    <div ref={layer} className="comments-on-board" data-chrome>
      <svg className="comments-on-board__link" aria-hidden="true">
        <line data-link visibility="hidden" />
      </svg>
      {ids.map((id) => (
        <BubbleButton key={id} elementId={id} open={counts.get(id)?.open ?? 0} />
      ))}
      {reacted.map((id) => (
        <CardReactions key={id} elementId={id} active={id === hover} />
      ))}
      {popover && ids.includes(popover) && <Popover key={popover} elementId={popover} />}
    </div>,
    document.body,
  );
}

const toRect = (r: DOMRect, area: DOMRect): Rect => ({
  left: r.left - area.left,
  right: r.right - area.left,
  top: r.top - area.top,
  bottom: r.bottom - area.top,
  width: r.width,
});

function BubbleButton({ elementId, open }: { elementId: string; open: number }) {
  const { t } = useTranslation();
  const isOpen = useReviews((s) => s.popover === elementId);
  return (
    <button
      type="button"
      className="comment-bubble"
      data-bubble={elementId}
      hidden
      aria-label={t('comments.cardCount', { count: open })}
      aria-expanded={isOpen}
      onClick={() => {
        // On a phone there is no room beside the card: the panel opens on it instead.
        if (window.innerWidth < 768) return openComments({ elementId });
        if (isOpen) closePopover();
        else openPopover(elementId);
      }}
    >
      <Icon name="comment" size={11} />
      {open}
    </button>
  );
}

/** The open threads of a card, in a floating card beside it. */
function Popover({ elementId }: { elementId: string }) {
  const { t } = useTranslation();
  const threads = useReviews((s) => s.threads);
  const pins = useReviews((s) => s.pins);
  const role = useReviews((s) => s.role);
  const conn = useReviews((s) => s.conn);
  const cards = useCardLabel(conn?.store);
  const ref = useRef<HTMLElement>(null);
  const writable = canComment(role);
  const label = cards.label(elementId);
  const open = threads.filter((th) => th.elementId === elementId && !th.resolvedAt);

  // Focus goes in, and back to the bubble when the popover closes.
  useEffect(() => {
    const bubble = document.querySelector<HTMLElement>(`[data-bubble="${CSS.escape(elementId)}"]`);
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (bubble?.isConnected && document.activeElement === document.body) bubble.focus();
    };
  }, [elementId]);

  // Opening the threads reads them. A thread already seen stays as the person left it (marked
  // unread by hand, or with a reply that arrived since), so only new ones are read here.
  const unread = open.filter((th) => th.unread).map((th) => th.id);
  const arrived = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = unread.filter((id) => !arrived.current.has(id));
    for (const id of fresh) setThreadRead(id, true);
    arrived.current = new Set([...arrived.current, ...open.map((th) => th.id)]);
  }, [open, unread]);

  const onKeyDown = (e: KeyboardEvent) => {
    // Keys typed here are not board shortcuts.
    e.stopPropagation();
    if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as HTMLElement).closest('dialog'))
      closePopover();
  };

  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="comment-popover"
      data-popover
      aria-label={t('comments.popoverLabel', { card: label })}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <header className="comment-popover__head">
        <strong>{t('comments.popoverTitle', { count: open.length })}</strong>
        <Button variant="ghost" onClick={() => openComments({ elementId })}>
          {t('comments.openInPanel')}
        </Button>
        <IconButton icon="close" label={t('comments.closePopover')} onClick={closePopover} />
      </header>
      <div className="comment-popover__body">
        {open.map((thread) => (
          <Thread
            key={thread.id}
            thread={thread}
            writable={writable}
            targetLabel={label}
            pinNumber={(pins.get(elementId)?.findIndex((p) => p.id === thread.id) ?? -1) + 1}
            showTarget={false}
            canJump={false}
            onJump={() => {}}
          />
        ))}
      </div>
    </section>
  );
}

/** Reaction chips under a card; the "+" shows while the card is under the pointer. */
function CardReactions({ elementId, active }: { elementId: string; active: boolean }) {
  const boardId = useReviews((s) => s.boardId);
  const reactions = useReviews((s) => s.elementReactions.get(elementId));
  const writable = canComment(useReviews((s) => s.role));
  const toggle = async (emoji: ReactionEmoji, on: boolean) => {
    const path = `/boards/${boardId}/elements/${elementId}/reactions/${encodeURIComponent(emoji)}`;
    await (on ? api.put(path, {}) : api.delete(path));
    refreshReviews('reviews');
  };
  return (
    <div
      className={active ? 'card-reactions is-active' : 'card-reactions'}
      data-reactions={elementId}
      hidden
    >
      <ReactionBar reactions={reactions ?? []} {...(writable ? { onToggle: toggle } : {})} />
    </div>
  );
}
