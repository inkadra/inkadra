/** Keyboard commands of the canvas. Kept apart from the component so they can be tested. */
export type Command =
  | { kind: 'tool'; tool: 'select' | 'hand' | 'arrow' }
  | {
      kind: 'add';
      type:
        | 'note'
        | 'todo'
        | 'link'
        | 'column'
        | 'board'
        | 'color'
        | 'image'
        | 'frame'
        | 'storyboard';
    }
  | { kind: 'palette' }
  | { kind: 'delete' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'duplicate' }
  | { kind: 'selectAll' }
  | { kind: 'escape' }
  | { kind: 'edit' }
  | { kind: 'rename' }
  | { kind: 'lock' }
  | { kind: 'front' }
  | { kind: 'back' }
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'zoom'; to: 'in' | 'out' | 'reset' | 'fit' | 'selection' }
  | { kind: 'help' };

export interface KeyInput {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function commandFor(e: KeyInput, mac = isMac()): Command | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    if (key === 'z') return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (key === 'y') return { kind: 'redo' };
    if (key === 'd') return { kind: 'duplicate' };
    if (key === 'a') return { kind: 'selectAll' };
    if (key === 'l') return { kind: 'lock' };
    if (key === ']') return { kind: 'front' };
    if (key === '[') return { kind: 'back' };
    if (key === '=' || key === '+') return { kind: 'zoom', to: 'in' };
    if (key === '-') return { kind: 'zoom', to: 'out' };
    if (key === '0') return { kind: 'zoom', to: 'reset' };
    return null;
  }
  if (e.altKey) return null;
  // Shift + digit: the code is layout independent, the key is not (Shift+1 is "!").
  if (e.shiftKey && e.code === 'Digit0') return { kind: 'zoom', to: 'reset' };
  if (e.shiftKey && e.code === 'Digit1') return { kind: 'zoom', to: 'fit' };
  if (e.shiftKey && e.code === 'Digit2') return { kind: 'zoom', to: 'selection' };
  const step = e.shiftKey ? 10 : 1;
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'nudge', dx: -step, dy: 0 };
    case 'ArrowRight':
      return { kind: 'nudge', dx: step, dy: 0 };
    case 'ArrowUp':
      return { kind: 'nudge', dx: 0, dy: -step };
    case 'ArrowDown':
      return { kind: 'nudge', dx: 0, dy: step };
    case 'Delete':
    case 'Backspace':
      return { kind: 'delete' };
    case 'Escape':
      return { kind: 'escape' };
    case 'Enter':
      return { kind: 'edit' };
    case '/':
      return { kind: 'palette' };
    case '?':
      return { kind: 'help' };
  }
  if (e.shiftKey) return null;
  switch (key) {
    case 'F2':
      if (e.metaKey || e.ctrlKey) return null;
      return { kind: 'rename' };
    case 'v':
      return { kind: 'tool', tool: 'select' };
    case 'h':
      return { kind: 'tool', tool: 'hand' };
    case 'a':
      return { kind: 'tool', tool: 'arrow' };
    case 'f':
      return { kind: 'add', type: 'frame' };
    case 's':
      return { kind: 'add', type: 'storyboard' };
    case 'n':
      return { kind: 'add', type: 'note' };
    case 't':
      return { kind: 'add', type: 'todo' };
    case 'l':
      return { kind: 'add', type: 'link' };
    case 'c':
      return { kind: 'add', type: 'column' };
    case 'b':
      return { kind: 'add', type: 'board' };
    case 'i':
      return { kind: 'add', type: 'image' };
    case 'k':
      return { kind: 'add', type: 'color' };
    case '+':
    case '=':
      return { kind: 'zoom', to: 'in' };
    case '-':
      return { kind: 'zoom', to: 'out' };
  }
  return null;
}

/** True when the key belongs to an open dialog. */
export function insideDialog(target?: EventTarget | null): boolean {
  if (typeof document === 'undefined') return false;
  return (
    Boolean(document.activeElement?.closest('dialog[open], [role="dialog"]')) ||
    Boolean(document.querySelector('dialog:modal')) ||
    (target instanceof HTMLElement && Boolean(target.closest('dialog[open], [role="dialog"]')))
  );
}

/** True when the key belongs to a text field, not to the canvas. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement &&
    (target.type === 'checkbox' ||
      target.type === 'radio' ||
      target.type === 'button' ||
      target.type === 'submit' ||
      target.type === 'reset')
  ) {
    return false;
  }
  return (
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]')) ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}
