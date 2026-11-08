import type { DemoSandbox } from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

/** Where "Install Inkadra" leads: the self-hosting guide. */
export const INSTALL_URL =
  'https://github.com/inkadra/inkadra/blob/main/docs/self-hosting/README.md';
/** The rules of the demo, for visitors. */
export const RULES_URL = 'https://github.com/inkadra/inkadra/blob/main/docs/demo.md';

/** When this browser's sandbox ends, so the sign-in page can say it ended (decision 0084). */
const ENDS_KEY = 'inkadra.demo.endsAt';
const WARNED_KEY = 'inkadra.demo.warned';
/** The warning before the end, once per sandbox. */
export const WARN_MS = 5 * 60 * 1000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export const rememberSandbox = (sandbox: Pick<DemoSandbox, 'expiresAt'>) =>
  write(ENDS_KEY, sandbox.expiresAt);
export const forgetSandbox = () => write(ENDS_KEY, null);
/** This browser had a sandbox and its time is up. */
export const sandboxEnded = (now = Date.now()) => {
  const ends = Date.parse(read(ENDS_KEY) ?? '');
  return Number.isFinite(ends) && ends <= now;
};
export const warnedFor = (sandbox: DemoSandbox) => read(WARNED_KEY) === sandbox.expiresAt;
export const markWarned = (sandbox: DemoSandbox) => write(WARNED_KEY, sandbox.expiresAt);

/** The signed-in visitor's sandbox, or null outside the demo or before it answers. */
export function useDemoSandbox(enabled: boolean) {
  const [sandbox, setSandbox] = useState<DemoSandbox | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      api
        .get<DemoSandbox>('/demo/sandbox')
        .then((s) => {
          if (!alive) return;
          rememberSandbox(s);
          setSandbox(s);
        })
        .catch(() => {});
    void load();
    // The export spent elsewhere (the project menu) shows here too.
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);
  return sandbox;
}

/** The clock of the pill: every second in the last minute, else every ten. */
export function useNow(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  const left = until === null ? Infinity : until - now;
  useEffect(() => {
    if (until === null) return;
    const timer = setTimeout(() => setNow(Date.now()), left <= 61_000 ? 1000 : 10_000);
    return () => clearTimeout(timer);
  }, [until, left]);
  return now;
}

/** Minutes left, rounded up; seconds in the last minute. */
export function timeLeft(ms: number): { unit: 'min' | 's'; value: number } {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s > 60 ? { unit: 'min', value: Math.ceil(s / 60) } : { unit: 's', value: s };
}
