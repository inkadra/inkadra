import { useEffect, useReducer } from 'react';
import * as Y from 'yjs';

// Reading a note's text without the editor: the inbox shows it before the board loads (#774).

export function useFragment(fragment: Y.XmlFragment | null) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!fragment) return;
    fragment.observeDeep(bump);
    return () => fragment.unobserveDeep(bump);
  }, [fragment]);
}

export function plainText(node: Y.XmlElement | Y.XmlFragment | Y.XmlText): string {
  if (node instanceof Y.XmlText) return node.toString().replace(/<[^>]+>/g, '');
  if (node instanceof Y.XmlElement && node.nodeName === 'mention')
    return `@${node.getAttribute('label') ?? ''}`;
  return node
    .toArray()
    .map((c) => plainText(c as Y.XmlElement | Y.XmlText))
    .join(node instanceof Y.XmlElement && node.nodeName === 'paragraph' ? '' : '\n');
}
