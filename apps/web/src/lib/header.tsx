import { createContext, type ReactNode, useContext, useEffect } from 'react';

/**
 * What a page puts in the shell header. On desktop the two parts are floating panels (#333):
 * `start` sits next to the sidebar (where am I, the views), `end` at the top right (people,
 * the board's actions); the shell adds the notification bell at the end of `end`.
 */
export interface HeaderParts {
  start: ReactNode;
  end?: ReactNode;
}

/** Lets a page put its own breadcrumb and status in the shell header. */
export const HeaderContext = createContext<(content: HeaderParts | null) => void>(() => {});

export function useHeaderContent(content: HeaderParts | null) {
  const set = useContext(HeaderContext);
  useEffect(() => {
    set(content);
  }, [set, content]);
  useEffect(() => () => set(null), [set]);
}
