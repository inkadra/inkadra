import { type RefObject, useEffect } from 'react';

/**
 * A modal: the app behind (#root) is inert while it is mounted, `ref` takes the focus and gives
 * it back on close.
 */
export function useModalInert(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const app = document.getElementById('root');
    const wasInert = app?.inert ?? false;
    if (app) app.inert = true;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (app) app.inert = wasInert;
      before?.focus?.({ preventScroll: true });
    };
  }, [ref]);
}
