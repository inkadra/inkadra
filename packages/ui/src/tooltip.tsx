// SPDX-License-Identifier: MPL-2.0
import { cloneElement, type ReactElement, type ReactNode, useEffect } from 'react';

/** Hover waits this long before the chip shows; keyboard focus shows it at once. */
export const TOOLTIP_DELAY = 400;
const LONG_PRESS = 500;
const TOUCH_LINGER = 2500;

/** A label marked `data-ink-tooltip-label` that already shows the whole text makes the chip moot. */
function fullyVisible(control: HTMLElement, text: string) {
  const label = control.querySelector<HTMLElement>('[data-ink-tooltip-label]');
  return (
    !!label &&
    label.textContent === text &&
    label.getClientRects().length > 0 &&
    label.scrollWidth <= label.clientWidth
  );
}

let owners = 0;
let dispose: (() => void) | undefined;

/**
 * One delegated layer for the whole page: any element with `data-ink-tooltip` gets the chip, so
 * native controls in the app need no wrapper and no extra tab stop. The chip lives in the top layer
 * (a manual popover) to show over open dialogs.
 */
function attach() {
  if (owners++ === 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let linger: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLElement | null = null;
    let pending: HTMLElement | null = null;
    let described = false;
    let priorDescription: string | null = null;
    const chip = document.createElement('div');
    chip.id = 'ink-tooltip-layer';
    chip.className = 'ink-tooltip';
    chip.setAttribute('role', 'tooltip');
    chip.setAttribute('popover', 'manual');
    chip.hidden = true;
    document.body.append(chip);

    const hide = () => {
      clearTimeout(timer);
      clearTimeout(linger);
      pending = null;
      if (!target) return;
      if (described) {
        if (priorDescription === null) target.removeAttribute('aria-describedby');
        else target.setAttribute('aria-describedby', priorDescription);
      }
      target = null;
      chip.hidePopover?.();
      chip.hidden = true;
    };
    const show = (control: HTMLElement) => {
      const text = control.dataset.inkTooltip;
      if (!text || !control.isConnected || fullyVisible(control, text)) return;
      hide();
      target = control;
      // A tooltip that repeats the accessible name would be read twice.
      described = control.getAttribute('aria-label') !== text;
      if (described) {
        priorDescription = control.getAttribute('aria-describedby');
        control.setAttribute('aria-describedby', `${priorDescription ?? ''} ${chip.id}`.trim());
      }
      chip.textContent = text;
      chip.hidden = false;
      chip.showPopover?.();
      const anchor = control.getBoundingClientRect();
      const box = chip.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(anchor.left + (anchor.width - box.width) / 2, innerWidth - box.width - 8),
      );
      const above = anchor.top - box.height - 6;
      const top = above >= 8 ? above : Math.min(anchor.bottom + 6, innerHeight - box.height - 8);
      chip.style.setProperty('--ink-tooltip-left', `${left}px`);
      chip.style.setProperty('--ink-tooltip-top', `${Math.max(8, top)}px`);
    };
    const controlFor = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-ink-tooltip]')
        : null;
    const leaves = (control: HTMLElement, event: PointerEvent) =>
      !(event.relatedTarget instanceof Node && control.contains(event.relatedTarget));

    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const control = controlFor(event);
      if (!control || control === target || control === pending) return;
      hide();
      pending = control;
      timer = setTimeout(() => show(control), TOOLTIP_DELAY);
    };
    const out = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const control = controlFor(event);
      if (control && leaves(control, event)) hide();
    };
    const focus = (event: FocusEvent) => {
      const control = controlFor(event);
      if (control?.matches(':focus-visible')) show(control);
    };
    // Touch: a long press shows the chip for a moment; the tap itself still goes through.
    const down = (event: PointerEvent) => {
      hide();
      const control = controlFor(event);
      if (event.pointerType !== 'touch' || !control) return;
      timer = setTimeout(() => {
        show(control);
        linger = setTimeout(hide, TOUCH_LINGER);
      }, LONG_PRESS);
    };
    const up = () => clearTimeout(timer);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && target) hide();
    };

    const listeners: Array<[EventTarget, string, EventListener, boolean]> = [
      [document, 'pointerover', over as EventListener, false],
      [document, 'pointerout', out as EventListener, false],
      [document, 'focusin', focus as EventListener, false],
      [document, 'focusout', hide, false],
      [document, 'pointerdown', down as EventListener, true],
      [document, 'pointerup', up, true],
      [document, 'pointercancel', hide, true],
      [document, 'keydown', key as EventListener, true],
      [document, 'scroll', hide, true],
      [window, 'resize', hide, false],
      [window, 'blur', hide, false],
    ];
    for (const [on, type, fn, capture] of listeners) on.addEventListener(type, fn, capture);
    dispose = () => {
      hide();
      chip.remove();
      for (const [on, type, fn, capture] of listeners) on.removeEventListener(type, fn, capture);
    };
  }
  return () => {
    if (--owners === 0) {
      dispose?.();
      dispose = undefined;
    }
  };
}

/** Mount once near the root so `data-ink-tooltip` works on plain elements across the app. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  useEffect(attach, []);
  return children;
}

/** Adds the shared tooltip to one element, without a wrapper or an extra keyboard stop. */
export function Tooltip({
  content,
  children,
}: {
  content: string | undefined;
  children: ReactElement<{ 'data-ink-tooltip'?: string }>;
}) {
  useEffect(attach, []);
  return cloneElement(children, { 'data-ink-tooltip': content });
}
