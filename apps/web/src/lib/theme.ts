import { dark, light } from '@inkadra/ui/tokens';
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
export type ThemePreference = Theme | 'system';
const KEY = 'inkadra.theme';
const EVENT = 'inkadra-theme-change';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function storedTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Browser preference shared by the rail and Settings; system follows live OS changes. */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(storedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = preference === 'system' ? system : preference;
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark');
    const onStorage = () => setPreference(storedTheme());
    mq.addEventListener('change', onChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, onStorage);
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT, onStorage);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const colour = (theme === 'dark' ? dark : light)['bg-rail'];
    for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
      meta.setAttribute('content', colour);
  }, [theme]);
  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    try {
      localStorage.setItem(KEY, next);
      window.dispatchEvent(new Event(EVENT));
    } catch {}
  }, []);
  const toggle = useCallback(() => choose(theme === 'dark' ? 'light' : 'dark'), [theme, choose]);
  return { theme, preference, choose, toggle };
}
