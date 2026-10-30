import { flushSync } from 'react-dom';
/** Real button/listbox interaction for component tests in happy-dom. */
export function chooseSelect(trigger: HTMLElement | null | undefined, value: string) {
  if (!trigger) throw new Error('Select trigger missing');
  HTMLElement.prototype.showPopover ??= function () {};
  HTMLElement.prototype.hidePopover ??= function () {};
  HTMLElement.prototype.scrollIntoView ??= function () {};
  flushSync(() => trigger.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.dataset.value === value);
  if (!option) throw new Error(`Select option missing: ${value}`);
  flushSync(() => option.click());
}
