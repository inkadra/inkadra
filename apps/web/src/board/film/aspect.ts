import { type AspectRatio, aspectValue, getBoardAspect, roots } from '@inkadra/doc-schema';
import { useSyncExternalStore } from 'react';
import type * as Y from 'yjs';

/** Aspect ratio of frames that do not set their own, when the board has none either. */
export const DEFAULT_ASPECT: AspectRatio = '16:9';

/** The aspect ratio of the board, kept in the document so everyone sees the same frames. */
export function useBoardAspect(doc: Y.Doc): AspectRatio {
  return useSyncExternalStore(
    (listener) => {
      const { meta } = roots(doc);
      meta.observe(listener);
      return () => meta.unobserve(listener);
    },
    () => getBoardAspect(doc) ?? DEFAULT_ASPECT,
  );
}

/** Width over height of a frame. */
export function frameRatio(frameAspect: AspectRatio | undefined, boardAspect: AspectRatio) {
  return aspectValue(frameAspect ?? boardAspect);
}

/** "2.39 : 1" or "16 : 9", as shown in the format picker. */
export function aspectLabel(ratio: AspectRatio): string {
  return ratio.includes(':') ? ratio.replace(':', ' : ') : `${ratio} : 1`;
}
