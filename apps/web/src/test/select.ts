import { flushSync } from 'react-dom';
/** Real button/listbox interaction for component tests in happy-dom. */
export function chooseSelect(trigger: Element | null | undefined, value: string) {
  if (!(trigger instanceof HTMLElement)) throw new Error('Select trigger missing');
  HTMLElement.prototype.showPopover ??= function () {};
  HTMLElement.prototype.hidePopover ??= function () {};
  HTMLElement.prototype.scrollIntoView ??= function () {};
  flushSync(() => trigger.click());
  const option = [...(trigger.getRootNode() as ParentNode).querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.dataset.value === value);
  if (!option) throw new Error(`Select option missing: ${value}`);
  flushSync(() => option.click());
}
