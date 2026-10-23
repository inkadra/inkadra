import { createContext, type ReactNode, useContext, useEffect } from 'react';

/** Lets a page put its own breadcrumb and status in the shell header. */
export const HeaderContext = createContext<(content: ReactNode | null) => void>(() => {});

export function useHeaderContent(content: ReactNode | null) {
  const set = useContext(HeaderContext);
  useEffect(() => {
    set(content);
  }, [set, content]);
  useEffect(() => () => set(null), [set]);
}
